# Refonte du pipeline de génération de plan — spécification d'exécution

> **À placer dans le repo à** `docs/refonte-plan-generator.md`
> **Cible** : Claude Code, sur `lucasmilcamps-collab/runcoach`, branche `master`.
> **Version du code auditée** : `master` au 28/07/2026.

---

## 0. Comment utiliser ce document

Ce document décrit **7 lots de travail séquentiels**. Chaque lot est autonome, testable, et
mergeable indépendamment. Les lots 0 à 2 ne changent aucun contrat d'API : ils peuvent partir
tout de suite. Le lot 3 est une migration de schéma qui touche backend **et** frontend en une
seule passe — c'est le morceau critique, il ne doit pas être découpé.

**Règle de travail** : un lot = une branche = une PR. Ne pas entamer le lot suivant tant que
`uv run pytest` n'est pas vert sur le précédent.

### Conventions du projet à respecter (rappel de `CLAUDE.md`)

- Code, identifiants et commits en **anglais** ; documentation dans `docs/` en **français**.
- Commits conventionnels : `feat:`, `fix:`, `refactor:`, `docs:`, `test:`.
- Backend : async partout (Motor, httpx), Pydantic v2, modèles requête/réponse séparés des
  documents Mongo.
- Frontend : TypeScript strict, TanStack Query pour l'état serveur, Zustand pour le local.
- Tout service métier a des tests unitaires ; les calculs physiologiques ont des tests à
  valeurs de référence.
- Lint : `uv run ruff check --fix && uv run ruff format`.

### Règles métier non négociables (rappel)

Ces règles sont dans `CLAUDE.md` et ne doivent jamais être affaiblies par cette refonte :

- Zones cardiaques par Karvonen à partir des FC max/repos réelles — jamais 220 − âge.
- La charge hebdomadaire ne progresse jamais de plus de 10 %, cross-training inclus.
- Une semaine de deload toutes les 3 à 4 semaines.
- Les séances des autres sports comptent toujours dans le calcul ATL/CTL.
- Aucun plan généré par IA n'est persisté sans passer `validate_plan`.
- Aucune recommandation médicale.

### Note sur les chemins

`CLAUDE.md` documente `mobile/app/` mais l'arborescence réelle est `mobile/src/app/`.
Corriger `CLAUDE.md` dans le lot 0.

---

## Lot 0 — Corrections de bugs (aucun changement de contrat)

Objectif : réparer ce qui est cassé aujourd'hui, sans toucher au schéma. Gain immédiat sur le
taux de convergence de la génération et sur la solidité du filet de validation.

### 0.1 — Le retry ne montre pas au modèle le plan qu'il doit corriger

**Fichier** : `backend/app/services/plan_service.py`, `_call_anthropic` (L188) et
`_generate_valid_plan` (L243).

**Problème** : la liste de messages est construite ainsi (L192-194) :

```python
messages = [{"role": "user", "content": user}]
if feedback is not None:
    messages.append({"role": "user", "content": feedback})
```

Deux messages `user` consécutifs, sans tour `assistant` entre les deux. Le modèle reçoit la
consigne « corrige uniquement ces points, garde le reste » **sans avoir sous les yeux le plan
qu'il a produit**. Il régénère donc intégralement à chaque tentative, et l'instruction est
inexécutable. De plus `feedback` est écrasé à chaque itération au lieu d'être accumulé : à la
3ᵉ tentative, le modèle ignore toujours les deux échecs précédents.

**Correctif attendu** : maintenir un véritable historique conversationnel.

```python
# _generate_valid_plan
history: list[tuple[str, str]] = []  # (raw_response, feedback)
for _ in range(_MAX_ATTEMPTS):
    raw = await _call_anthropic(system, user, history)
    ...
    history.append((raw, feedback))

# _call_anthropic
messages = [{"role": "user", "content": user}]
for prev_raw, prev_feedback in history:
    messages.append({"role": "assistant", "content": prev_raw})
    messages.append({"role": "user", "content": prev_feedback})
```

**Effet de bord bénéfique** : le préfixe devient stable entre tentatives, donc le cache de
prompt s'applique — les tentatives 2 et 3 coûtent moins cher au lieu de coûter plein tarif.

**Tests** : adapter `test_generate_plan_retries_on_violation` pour asserter que le second appel
contient bien 3 messages, dont un `assistant` portant le JSON du premier essai.

### 0.2 — `is_deload` n'est borné par rien : bypass complet de deux règles

**Fichier** : `backend/app/services/plan_validation.py`, `_check_ramp` (L49) et `_check_deload` (L65).

**Problème** : `_check_ramp` fait `if week.is_deload: continue`, et `_check_deload` remet
`consecutive = 0` sur chaque semaine de deload. Aucun contrôle n'existe sur la charge d'une
semaine marquée deload. Un plan dont **toutes** les semaines portent `is_deload: true` passe
donc les deux règles intégralement, quelle que soit la charge. C'est un chemin d'échappement
que la boucle de régénération sous contrainte peut trouver naturellement.

**Correctif attendu** : ajouter une constante et une vérification.

```python
DELOAD_MAX_RATIO = 0.85  # une semaine de deload est au plus à 85% de la dernière semaine normale
```

Dans `_check_deload`, pour chaque semaine `is_deload`, comparer `target_load` à la dernière
semaine normale rencontrée. Si `> last_normal_load * DELOAD_MAX_RATIO`, émettre une violation
du type : `Semaine {index} : marquée deload mais charge à {pct}% de la dernière semaine normale
(≤ 85% attendu).`

**Tests** : `test_deload_without_load_reduction_flagged`, et un cas
`test_all_weeks_marked_deload_flagged`.

### 0.3 — Faux positif sur la sortie longue après un deload

**Fichier** : `backend/app/services/plan_validation.py`, `_check_long_run` (L132, garde-fou L146).

**Problème** : `prev_long` est mis à jour sur toutes les semaines, deload compris. Séquence
parfaitement saine et pourtant refusée :

| Semaine | Sortie longue | Résultat actuel |
|---|---|---|
| 4 (normale) | 90 min | ok, `prev_long = 90` |
| 5 (deload) | 60 min | non flaggée, mais `prev_long = 60` |
| 6 (normale) | 95 min | **flaggée : +35 min** |

Le retour au niveau d'avant deload est légitime. Ce faux positif consomme des tentatives de
régénération et peut faire échouer une génération valide.

**Correctif attendu** : suivre `prev_long_normal`, ignoré sur les semaines de deload — même
motif que `_check_ramp`. Le plafond absolu `_long_run_cap_min` reste appliqué à toutes les
semaines.

**Tests** : `test_long_run_returns_to_prior_level_after_deload_is_ok`.

### 0.4 — Séances de qualité consécutives à cheval sur deux semaines

**Fichier** : `backend/app/services/plan_validation.py`, `_check_quality_spacing` (L160, zip L172).

**Problème** : le tri et le `zip` se font **à l'intérieur d'une semaine**. Une séance de qualité
le dimanche suivie d'une séance de qualité le lundi n'est pas détectée.
`_check_no_quality_after_impact` gère correctement cette frontière (L109) — appliquer le même
motif ici.

**Tests** : `test_quality_sunday_then_monday_flagged`.

### 0.5 — Les sports fixes : absence non détectée, multi-jours cassé

**Fichier** : `backend/app/services/plan_validation.py`, `_check_fixed_sports` (L79, dict L81).

**Deux problèmes distincts** :

1. `fixed_days = {fs.sport: fs.day for fs in request.fixed_sports}` est un dict clé par sport.
   Si l'utilisateur déclare basket mercredi **et** basket samedi, la seconde entrée **écrase**
   la première silencieusement, et le validateur flagge ensuite le mercredi comme jour
   inattendu. Le modèle Pydantic (`list[FixedSport]`) autorise pourtant déjà le multi-jours.
2. Le check vérifie qu'un sport fixe présent est au bon jour, jamais qu'il est **présent**. Si
   le modèle oublie le padel du mercredi, aucune violation. Aggravé par
   `Session._coerce_sport` (`models/plan.py:110`) qui transforme tout sport inconnu en `OTHER` :
   une valeur mal orthographiée disparaît sans bruit.

**Correctif attendu** :

```python
fixed_days: dict[SportType, set[Weekday]] = defaultdict(set)
for fs in request.fixed_sports:
    fixed_days[fs.sport].add(fs.day)
```

Plus un contrôle de présence : chaque `(sport, day)` déclaré doit apparaître dans **chaque**
semaine du plan (hors semaines où l'athlète est déclaré indisponible — cas non géré
aujourd'hui, donc : chaque semaine, sans exception).

**Tests** : `test_fixed_sport_two_days_both_accepted`,
`test_missing_fixed_sport_flagged`.

### 0.6 — Robustesse de l'appel Anthropic

**Fichier** : `backend/app/services/plan_service.py`.

- **Client recréé à chaque appel** (L189) et jamais fermé. Le sortir au niveau module, ou
  utiliser un singleton paresseux, et le fermer au `shutdown` de l'app (`app/main.py`).
- **Budget temps non borné** : `_ANTHROPIC_TIMEOUT_S = 120` × `_MAX_ATTEMPTS = 3` = jusqu'à
  6 minutes sur une requête HTTP synchrone. La plateforme d'hébergement coupe bien avant : le
  client reçoit un 502 pendant que le backend continue de consommer des tokens pour un plan
  que personne ne recevra. Introduire une **deadline globale** (`_TOTAL_DEADLINE_S = 90.0`)
  partagée entre les tentatives : avant chaque tentative, si le temps restant est insuffisant,
  sortir avec une `PlanGenerationError` explicite plutôt que de lancer un appel condamné.

**Tests** : `test_generation_stops_when_deadline_exceeded` (monkeypatch de l'horloge).

### 0.7 — Dérive documentaire

- `backend/app/core/config.py:23` : `plan_model = "claude-sonnet-5"`, alors que
  `.claude/skills/plan-generator/SKILL.md` annonce `claude-sonnet-4-6`. Aligner le skill sur le
  code.
- `PRODUCT.md` affirme toujours « no backend or mobile code exists ». Le mettre à jour.
- `CLAUDE.md` : corriger `mobile/app/` → `mobile/src/app/`.

### Critères d'acceptation du lot 0

- [ ] `uv run pytest` vert, avec les 7 nouveaux tests listés ci-dessus.
- [ ] Aucun changement dans `models/plan.py` ni dans `mobile/src/lib/api/plans.ts`.
- [ ] Une génération réelle qui échoue à la première tentative converge à la seconde.

---

## Lot 1 — Enrichir le contexte de génération

Objectif : donner au modèle une image fidèle de l'état réel de l'athlète. Aucun changement de
schéma, tout se joue dans `build_context` et les prompts.

**Fichier principal** : `backend/app/services/plan_service.py`, `build_context` (L70),
`_system_prompt` (L104), `_user_prompt` (L169).

### 1.1 — La moyenne sur 8 semaines écrase l'information utile

`build_context` renvoie aujourd'hui `avg_weekly_run_minutes`, moyenne sur 56 jours. Or
« 8 semaines à 40 min/semaine » et « 6 semaines à zéro puis 2 semaines à 160 min » donnent le
même chiffre et décrivent deux athlètes radicalement différents. La récence est précisément ce
qui manque.

**Ajouter au contexte** :

| Clé | Contenu |
|---|---|
| `days_since_last_run` | jours depuis la dernière activité `RUN` (`None` si aucune) |
| `weekly_run_minutes_8w` | liste de 8 entiers, de la semaine la plus ancienne à la plus récente |
| `last_run` | `{date, duration_min, distance_km, avg_pace_min_per_km}` de la dernière course |
| `longest_run_8w_min` | plus longue sortie de la fenêtre |
| `avg_weekly_load_4w` | **charge hebdomadaire réelle en TRIMP** sur 4 semaines |

`avg_weekly_load_4w` est le plus important des cinq : `Week.target_load` est exprimé en TRIMP,
alors que le contexte actuel ne fournit que des **minutes**. Les deux unités ne sont pas
commensurables — le modèle n'a aujourd'hui littéralement aucun moyen de calibrer la charge de
la semaine 1. Cette clé prépare le lot 2.

Conserver `avg_weekly_run_minutes` pour ne rien casser, mais ne plus s'appuyer dessus.

### 1.2 — Exploiter `low_confidence`

Le flag est calculé (`load_service.has_low_confidence`, seuil 90 jours) et transmis au prompt,
mais **aucune ligne du system prompt ne dit quoi en faire**. Ajouter une consigne explicite :
quand `low_confidence` est vrai, démarrer volontairement bas et privilégier une première phase
d'observation plutôt qu'une progression agressive.

### 1.3 — Règle de reprise après interruption

Ajouter au `_user_prompt` : si `days_since_last_run > 21`, construire une **reprise** —
volume initial nettement réduit, aucune séance de qualité les deux premières semaines,
progression prudente. Réutiliser le motif de `_injury_directive` (L153) : une fonction
`_detraining_directive(context)` qui renvoie un bloc de texte ou une chaîne vide.

### 1.4 — Double calcul de la forme

`generate_plan` (L285) appelle `build_context` (→ `compute_fitness`) **puis**
`plan_progress.compute_progress` (→ `compute_fitness` à nouveau). `compute_fitness` lit
**toutes** les activités de l'utilisateur sans filtre de date : deux scans complets par
génération.

Factoriser : calculer `FitnessResponse` une fois dans `generate_plan` et l'injecter en
paramètre optionnel dans `build_context` et `compute_progress`.

### Critères d'acceptation du lot 1

- [ ] Tests sur `build_context` avec un jeu d'activités contrôlé : vérifier
      `days_since_last_run`, la ventilation `weekly_run_minutes_8w`, et `avg_weekly_load_4w`.
- [ ] Test : un utilisateur sans course depuis 30 jours déclenche bien la directive de reprise
      dans le prompt.
- [ ] `compute_fitness` n'est appelé qu'une fois par génération (assert sur un mock).

---

## Lot 2 — Ancrer la charge initiale sur la réalité

Objectif : combler le trou de sécurité le plus important du validateur.

**Problème** : `_check_ramp` ne contraint que la progression **relative à l'intérieur du plan**.
Le modèle peut poser `target_load: 600` en semaine 1 alors que la charge réelle de l'athlète est
à 250, puis progresser sagement de 8 %/semaine : validation verte. La règle produit « jamais
+10 % » est donc garantie à l'intérieur du plan, mais **pas au raccord entre la vie actuelle de
l'athlète et la semaine 1** — qui est précisément le saut le plus dangereux du plan.

**Correctif attendu** :

1. Changer la signature : `validate_plan(plan, request, today, context: dict | None = None)`.
   `context` optionnel pour ne pas casser les appels existants ni les tests.
2. Nouveau check `_check_initial_load(weeks, context)` : si `avg_weekly_load_4w` est disponible
   et non nul, `weeks[0].target_load` ne dépasse pas `avg_weekly_load_4w * INITIAL_RAMP_MAX_RATIO`
   (constante à `1.10`, cohérente avec `RAMP_MAX_RATIO`).
3. Cas particuliers à traiter explicitement :
   - `avg_weekly_load_4w == 0` (aucune activité) → pas de violation, mais le prompt doit imposer
     un démarrage bas (couvert par 1.2/1.3).
   - Reprise après blessure → le plan démarre plus bas que la charge réelle, ce qui est
     conforme ; le check n'est qu'un **plafond**, jamais un plancher.
4. Faire remonter `_check_initial_load` dans le message de feedback de la boucle de retry, comme
   les autres violations.

**Second point du lot** : `max_run_sessions_per_week` existe dans `PlanRequest` (`models/plan.py:61`),
est saisi dans `plan-setup.tsx`, est envoyé au modèle dans le dump JSON — et n'est **ni mentionné
dans le system prompt, ni vérifié par aucun check**. Contrainte utilisateur purement décorative
aujourd'hui. Ajouter la ligne dans `_system_prompt` et le check correspondant (le comptage
définitif arrive au lot 3 avec `min_`/`max_`, mais le plafond peut être posé dès maintenant).

### Critères d'acceptation du lot 2

- [ ] `test_initial_load_above_real_load_flagged`
- [ ] `test_initial_load_check_skipped_without_context`
- [ ] `test_too_many_run_sessions_flagged`

---

## Lot 3 — Refonte du schéma (le morceau critique)

Objectif : porter en une seule migration l'ensemble des besoins produit. Backend et frontend
changent ensemble. **Ne pas découper ce lot.**

### 3.1 — Blocage structurel préalable : une seule séance par jour

**Fichier** : `backend/app/services/plan_service.py`, `get_today_session` (L481).

```python
session = next((s for s in week.sessions if s.day == weekday), None)
```

`next(...)` prend la **première** séance du jour et ignore les suivantes. Dès qu'une journée
porte une course **et** un renforcement, l'écran du jour n'en affiche qu'une. Le rendu du plan
complet (`mobile/src/components/plan-view.tsx`, itération plate L167) affiche bien les deux,
mais pas le dashboard — c'est-à-dire précisément l'écran consulté quotidiennement.

**Correctif attendu** : `TodaySession` porte une **liste** de séances.

- `TodaySession.session: Session | None` → `TodaySession.sessions: list[Session]`.
- L'ajustement quotidien (`DailyAdjustment`) s'applique à la séance **principale**
  (`slot == "primary"`). Les séances `addon` suivent la règle : si la principale est dégradée,
  l'addon est supprimé de la journée (avec la raison affichée).
- Répercuter sur `mobile/src/lib/api/plans.ts` et sur le dashboard.

C'est le prérequis de 3.4 — le faire en premier dans le lot.

### 3.2 — Nouvelles valeurs de `Session.type`

**Fichier** : `backend/app/models/plan.py`, `Session.type` (L94).

Ajouter trois littéraux, dans la même migration :

| Valeur | Usage |
|---|---|
| `strength` | renforcement musculaire (voir 3.4) |
| `test` | séance d'évaluation du niveau (voir lot 5) |
| `race` | le jour J — aujourd'hui **non représentable**, ce qui rend la règle « course le jour J » du skill invérifiable |

Répercuter dans `mobile/src/lib/api/plans.ts` (`SessionType`) et dans les mappings d'affichage
(libellés, icônes, couleurs) de `plan-view.tsx`.

### 3.3 — Séances clés : `priority`

**Besoin** : l'athlète planifie 3 séances par semaine mais n'en fait parfois que 2. Il doit
savoir **laquelle il peut sauter**.

- Ajouter `Session.priority: Literal["key", "optional"]`.
- Le `rationale` de chaque séance `key` doit expliquer pourquoi elle est prioritaire.
- `PlanRequest` : remplacer `max_run_sessions_per_week: int` par
  `min_run_sessions_per_week: int` **et** `max_run_sessions_per_week: int`.
- Nouveau check `_check_session_counts` : chaque semaine compte exactement
  `min_run_sessions_per_week` séances de course marquées `key`, et au plus
  `max_run_sessions_per_week` séances de course au total.

**Bénéfice collatéral important** : `plan_progress.py` **devine** aujourd'hui ce qu'est une
séance clé (`_KEY_TYPES = QUALITY_SESSION_TYPES | {"long_run"}`, L24). Une fois `priority`
disponible, remplacer l'inférence par la lecture du champ. Le calcul d'adhérence et le
déclencheur de replanification deviennent alors exacts au lieu d'être approximatifs.

### 3.4 — Renforcement musculaire : le `slot`

**Besoin** : 1 à 2 séances de 15-20 min par semaine, faites via Freeletics.

Un renfo de 15-20 min n'occupe pas une journée : il se greffe sur un jour déjà pris. D'où :

- Ajouter `Session.slot: Literal["primary", "addon"]`, défaut `"primary"`.
- Une séance `addon` : ne compte pas dans `max_run_sessions_per_week`, n'exige pas que son jour
  soit libre, partage la journée avec une séance principale.
- `SportType.STRENGTH` existe déjà dans l'enum — aucun nouveau sport à créer.

**Contenu de la séance** : le plan ne prescrit **pas** d'exercices. Freeletics s'en charge, et
mieux. Le plan prescrit un **créneau et une intention** : « après la sortie du mardi, 15-20 min,
bas du corps + gainage, RPE 6-7 ». À écrire explicitement dans le `_system_prompt`, sinon le
modèle va inventer des programmes de musculation.

**Placement — nouveau check `_check_strength_placement`** (principe *hard days hard, easy days
easy* : on regroupe le stress plutôt que de le disperser) :

- Aucune séance `strength` la veille d'une sortie longue ou d'une séance de qualité.
- Placement préférentiel : même jour qu'une séance de qualité (après la course), ou jour facile.
- Si deux séances par semaine : au moins 48 h d'écart.

### 3.5 — Préférences : séparer renfo et cross-training

L'athlète veut du renforcement mais **pas** de cross-training prescrit. Un booléen unique ne
peut pas exprimer les deux.

```python
class StrengthPref(BaseModel):
    enabled: bool = False
    sessions_per_week: int = Field(default=1, ge=1, le=2)
    duration_min: int = Field(default=20, ge=10, le=45)

# dans PlanRequest
include_cross_training: bool = False
strength: StrengthPref = Field(default_factory=StrengthPref)
```

**Point de vigilance à documenter dans le code** : `include_cross_training` ne concerne que la
**prescription**. Les sports pratiqués par l'athlète (padel, basket) continuent d'alimenter le
TRIMP et le CTL/ATL via `fitness_service` quoi qu'il arrive. Ce flag touche `_system_prompt`,
**jamais** `load_service` ni `fitness_service` — sinon on casse le principe fondateur du projet
(« le cross-training est de la charge, pas du bruit »). Mettre un commentaire au-dessus du champ.

### 3.6 — Sports fixes multi-jours (côté modèle et UI)

Le correctif validateur est fait au lot 0.5. Reste le modèle et le front :

- `mobile/src/app/plan-setup.tsx:87` stocke `useState<Map<SportType, Weekday>>` — un seul jour
  par sport, structurellement impossible à contourner depuis l'UI. Passer à une liste de paires
  `{sport, day}[]`, avec un bouton « ajouter un créneau » par sport.
- Cas réel à couvrir : le match du week-end n'est pas toujours le même jour. Ajouter
  `FixedSport.flexible: bool = False` — quand `flexible` est vrai, le validateur accepte le
  sport sur **l'un** des jours déclarés au lieu de tous. Sans ça, on contraint le plan sur un
  jour qui bouge.

### 3.7 — Passage en tool use pour le schéma

Tant qu'on touche au schéma, en profiter. `_user_prompt` (L172) colle
`Plan.model_json_schema()` dans le texte du prompt — rien ne l'impose au modèle. Passer le même
schéma en `input_schema` d'un tool supprime toute la classe d'erreurs « JSON non conforme au
schéma » et rend `_extract_json` (L52) quasiment inutile.

Si le passage en tool use est jugé trop risqué à ce stade, l'alternative gratuite est un
**prefill** assistant `{` qui force le démarrage en JSON.

### Récapitulatif des fichiers touchés par le lot 3

**Backend**
- `app/models/plan.py` — `Session` (+`priority`, +`slot`, 3 nouveaux `type`), `PlanRequest`
  (`min_`/`max_run_sessions_per_week`, `include_cross_training`, `strength`), `FixedSport`
  (+`flexible`), `TodaySession` (`sessions: list`), `StrengthPref` (nouveau).
- `app/services/plan_validation.py` — `_check_session_counts`, `_check_strength_placement`,
  ajustement de `_check_fixed_sports` pour `flexible`.
- `app/services/plan_service.py` — `_system_prompt` (règles renfo, priority, cross-training
  conditionnel), `get_today_session` (liste), passage en tool use.
- `app/services/plan_progress.py` — lire `priority` au lieu d'inférer `_KEY_TYPES`.

**Frontend**
- `src/lib/api/plans.ts` — tous les types miroir.
- `src/app/plan-setup.tsx` — liste de créneaux, min/max séances, toggles renfo et
  cross-training.
- `src/components/plan-view.tsx` — badge « séance clé », rendu des `addon`, libellés des
  nouveaux types.
- Dashboard — affichage de plusieurs séances pour aujourd'hui.

### Critères d'acceptation du lot 3

- [ ] Tests validateur : comptage min/max de séances clés, placement du renfo (veille de séance
      clé refusée, même jour accepté, 48 h d'écart), sport fixe `flexible`.
- [ ] Test : une journée portant une course + un renfo renvoie bien **deux** séances sur
      `GET /plans/today`.
- [ ] Test : `include_cross_training=False` ne retire aucune activité du calcul CTL/ATL.
- [ ] `plan_progress` lit `priority` ; test d'adhérence sur un plan où une séance `optional` est
      manquée → pas de replanification suggérée.
- [ ] `npx tsc --noEmit` propre côté mobile.

---

## Lot 4 — Estimation et prévision de chrono

Objectif : savoir où en est l'athlète, et où le plan est censé le mener.

**Nouveau fichier** : `backend/app/services/performance_service.py` — module **pur** (aucun accès
DB, HTTP ou Garmin), testé à valeurs de référence, sur le modèle exact de `load_service.py`.

### 4.1 — Contenu du module

Deux calculs déterministes, aucune IA :

- **Chrono actuel estimé** : formule de Riegel pour extrapoler d'une performance récente vers la
  distance cible ; recoupement avec la VO2max Garmin via les tables VDOT. Renvoyer aussi un
  indicateur de confiance (dépend de la fraîcheur et de la qualité de la performance source).
- **Chrono projeté à la date cible** : la même estimation appliquée au CTL projeté en fin de plan.

### 4.2 — Persistance et suivi de l'évolution

`PlanVersionSummary` (`models/plan.py:158`) existe déjà et est exposé par
`GET /plans/versions`. Y ajouter `estimated_time_min` et `projected_time_min`. On obtient
gratuitement la courbe d'évolution version après version, affichable dans `plan-history.tsx`.

### 4.3 — Réinjection dans la génération

Le bénéfice principal est en amont : une fois le chrono actuel estimé, l'ajouter à
`build_context`. Aujourd'hui les allures prescrites par le modèle sont adossées à **l'objectif**,
pas à la forme réelle — ce qui produit des allures inatteignables en début de plan.

### 4.4 — Contrôle de faisabilité

Si `target_time_min` implique une progression irréaliste sur le nombre de semaines disponibles,
le signaler. **Avertissement UI, pas violation de validation** : c'est l'objectif de
l'utilisateur, on ne le refuse pas, on l'informe.

### Critères d'acceptation du lot 4

- [ ] Tests à valeurs de référence sur Riegel et VDOT (au moins 5 cas connus).
- [ ] `GET /plans/versions` renvoie les deux estimations.
- [ ] Un objectif manifestement irréaliste produit un avertissement, pas un échec de génération.

---

## Lot 5 — Séance de test

Dépend du lot 4 : un test sans conversion en estimation ne sert à rien.

- **Déclencheur** : `low_confidence` vrai, **ou** aucune séance de qualité récente, **ou**
  `days_since_last_run` élevé.
- **Contenu** : semaine 1 du plan contient une séance `type: "test"` avec un protocole défini —
  échauffement, effort maximal sur 1500 m ou 2 km, retour au calme. Le `rationale` explique à
  quoi sert la mesure.
- **Boucle de retour** : une fois l'activité synchronisée depuis Garmin, recalculer l'estimation
  via `performance_service`, puis **proposer une replanification** (ne pas la déclencher
  automatiquement). Le mécanisme de versions existe déjà, il suffit de le brancher.

### Critères d'acceptation du lot 5

- [ ] Test : un profil sans historique produit un plan dont la semaine 1 contient une séance
      `test`.
- [ ] Test : un profil avec historique riche n'en contient pas.
- [ ] Après synchronisation du test, `GET /plans/progress` suggère une replanification avec le
      motif adéquat.

---

## Lot 6 — Fiabilité de la charge (chantier de fond)

Le plus lourd, le moins urgent, mais celui qui détermine la valeur de tout le reste.

### 6.1 — TRIMP par temps en zone

**Fichier** : `backend/app/services/load_service.py`, `compute_trimp`.

L'implémentation actuelle fait `durée_min × zone_de_la_FC_moyenne`. Le TRIMP d'Edwards somme le
temps **par zone**. Une séance de 6×800 m qui moyenne en Z3 ressort à facteur 3 alors qu'elle a
passé 20 min en Z5. Conséquence : le CTL/ATL **sous-estime systématiquement les séances les plus
fatigantes** — le biais va exactement dans le mauvais sens pour une application dont l'argument
est la sécurité.

Si Garmin remonte le temps par zone par activité (à vérifier côté
`garmin_sync_service` / `garmin_service`), l'utiliser et garder la FC moyenne en repli. C'est le
gain de justesse le plus rentable du projet.

Conserver la couverture de tests à valeurs de référence existante et l'étendre.

### 6.2 — Adhérence : « réalisé » est trop permissif

**Fichier** : `backend/app/services/plan_progress.py`.

`activity_dates` retient **toute activité, tous sports confondus** : une partie de padel le
dimanche valide la sortie longue prévue ce jour-là. Cela fausse à la fois le déclencheur de
replanification et le bloc `progression_recente` injecté dans le prompt.

Exiger au minimum, pour une séance clé de course : `sport == RUN` **et** durée ≥ ~60 % du prévu.

### 6.3 — Le renfo Freeletics est une charge invisible

Freeletics ne se synchronise pas avec Garmin Connect dans la plupart des configurations. Deux
séances de 20 min par semaine qui n'atterrissent jamais dans `db.activities`, c'est une charge
sous-comptée et un moteur d'adaptation qui dérive.

La plomberie existe déjà : `load_service.compute_session_rpe_load` gère le repli session-RPE, et
l'écran `mobile/src/app/add-activity.tsx` permet la saisie manuelle. Il manque le déclencheur :
après une séance `strength` planifiée et non retrouvée dans les activités, envoyer une
notification (`app/services/push_service.py`) proposant de la logger en deux taps avec le RPE.

Documenter également l'alternative sans friction : lancer une activité « Musculation » sur la
montre pendant la séance Freeletics — Garmin la remonte avec la FC et le TRIMP se calcule seul.

### Critères d'acceptation du lot 6

- [ ] `compute_trimp` accepte un temps par zone et retombe sur la FC moyenne en son absence ;
      tests à valeurs de référence pour les deux chemins.
- [ ] Une séance clé de course n'est comptée réalisée que par une activité `RUN` de durée
      suffisante.
- [ ] Une séance `strength` non loggée déclenche une notification.

---

## Ordre, dépendances, parallélisation

```
Lot 0 (bugs)  ──┬──> Lot 2 (ancrage charge) ──> Lot 3 (schéma) ──┬──> Lot 5 (séance de test)
                │                                    ^            │
Lot 1 (contexte)┴────────────────────────────────────┘            │
                                                                  │
Lot 4 (chrono) ───────────────────────────────────────────────────┘

Lot 6 (charge) ── indépendant, peut démarrer à tout moment
```

- **Lots 0 et 1** : parallélisables, aucun conflit de fichier majeur (0 touche surtout
  `plan_validation.py`, 1 surtout `build_context`).
- **Lot 2** dépend de `avg_weekly_load_4w` livré par le lot 1.
- **Lot 3** est le point de synchronisation : tout ce qui touche au schéma y converge.
- **Lot 4** est autonome (nouveau module) et peut être développé en parallèle du lot 3.
- **Lot 5** dépend des lots 3 (type `test`) et 4 (conversion en estimation).
- **Lot 6** est indépendant mais bénéficie du lot 3 (`priority` fiabilise 6.2).

## Definition of done, tous lots confondus

- `uv run pytest` vert.
- `uv run ruff check && uv run ruff format --check` propres.
- `npx tsc --noEmit` propre sur `mobile/`.
- Les types de `mobile/src/lib/api/plans.ts` reflètent exactement `backend/app/models/plan.py`.
- Les skills `.claude/skills/plan-generator/SKILL.md` et
  `.claude/skills/training-science/SKILL.md` sont mis à jour avec les nouvelles règles — un
  skill qui décrit un pipeline obsolète est pire que pas de skill.
- Aucune donnée de santé et aucune clé d'API dans les logs.
