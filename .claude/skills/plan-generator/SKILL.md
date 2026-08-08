---
name: plan-generator
description: Génération et adaptation des plans d'entraînement par IA (API Anthropic) — construction du prompt, schéma JSON du plan, validation programmatique, régénération et adaptation dynamique. Utiliser ce skill pour tout code touchant à la création d'un plan, aux appels à l'API Anthropic, au schéma des séances, à la validation d'un plan, ou à l'ajustement d'un plan existant (séance manquée, mauvaise récupération, changement d'objectif).
---

# Plan Generator

## Architecture de génération

Pipeline en 3 étapes, côté backend uniquement (`plan_service`) :

```
1. build_context()    → assemble les données (objectif, contraintes, historique Garmin, CTL actuel)
2. generate_plan()    → appel API Anthropic, sortie JSON structurée
3. validate_plan()    → validation programmatique ; si échec → régénérer (max 3 tentatives) avec les erreurs en feedback
```

**Jamais** de plan persisté sans passer `validate_plan()`. L'IA propose, le code garantit.

## Entrées du générateur (build_context)

```python
class PlanRequest(BaseModel):
    goal_type: Literal["race", "distance", "fitness"]
    race_date: date | None
    distance_km: float | None
    target_time_min: int | None        # optionnel : "finir" est un objectif valide
    available_days: list[Weekday]
    min_run_sessions_per_week: int      # séances "key" garanties
    max_run_sessions_per_week: int      # plafond
    fixed_sports: list[FixedSport]      # {sport, day, flexible} — flexible = un des jours suffit
    include_cross_training: bool        # PRESCRIT du cross-training (n'affecte JAMAIS la charge)
    strength: StrengthPref              # {enabled, sessions_per_week 1-2, duration_min}
```

Contexte calculé ajouté au prompt (`build_context`) : CTL/ATL/TSB actuels, zones FC personnelles, flag `low_confidence` si historique < 90 j, et un profil de récence course :

- `days_since_last_run` (None si aucune course) — déclenche une directive de reprise si > 21 j.
- `weekly_run_minutes_8w` — 8 entiers (semaine la plus ancienne → la plus récente), pour voir la tendance et non une moyenne qui écrase l'info.
- `last_run` : `{date, duration_min, distance_km, avg_pace_min_per_km}`.
- `longest_run_8w_min`.
- `avg_weekly_load_4w` : **charge hebdo réelle en TRIMP** sur 4 semaines — la même unité que `Week.target_load`, pour caler la semaine 1 sur la réalité (utilisée par `_check_initial_load` au lot 2).

La forme (`compute_fitness`) est calculée une seule fois par génération et injectée dans `build_context` et `plan_progress.compute_progress` (pas de double scan des activités).

**Estimation de chrono (`performance_service`, module pur)** : à partir de `best_recent_effort` (meilleure course ≥ 3 km de la fenêtre) et de la distance objectif, on estime le **chrono actuel** (Riegel, formule et exposant dans `training-science`) — injecté au prompt sous `chrono_actuel_estime` pour que les allures soient adossées à la forme réelle, pas à l'objectif. Le **chrono projeté** en fin de plan applique la même estimation au CTL projeté (`_project_ctl`). Les deux sont persistés (`estimated_time_min`/`projected_time_min`, exposés par `GET /plans/versions`). Si `target_time_min` implique une progression irréaliste, `feasibility_warning` (avertissement UI, **jamais** un blocage). VDOT de Daniels dispo (`daniels_vdot`) mais pas de recoupement VO2max (donnée Garmin non stockée).

## Appel API Anthropic

- Modèle : `claude-sonnet-5` (aligné sur `config.plan_model`). Clé en variable d'env `ANTHROPIC_API_KEY`, jamais côté client. Un client par génération (pas un par tentative), deadline globale 900.0 s pour 420.0 s par tentative (`_TOTAL_DEADLINE_S` / `_ANTHROPIC_TIMEOUT_S`). Les deux doivent rester distincts — à valeurs égales, une première tentative lente consomme tout le budget et le retry n'a jamais lieu ; chaque tentative est en plus bornée par ce qui reste. `test_skill_documents_the_real_timeouts` échoue si cette ligne diverge du code. Génération en **job de fond** (`start_generation` → `run_generation_job`), plus dans la requête HTTP : un plan de 17 semaines coûte ~12,5k tokens de sortie, soit 200-350 s, ce qu'aucune requête synchrone ne peut porter. `POST /plans` renvoie 202 + un job ; le client interroge `GET /jobs/{id}`.
- **Tool use** : le plan est émis via l'outil `submit_plan` dont l'`input_schema` = `Plan.model_json_schema()` + `tool_choice` forcé. Ça supprime la classe d'erreurs « JSON non conforme » ; `tool_block.input` est déjà un dict → `Plan.model_validate(...)`.
- System prompt : rôle de coach, règles training-science, priority/min-max, renfo et cross-training **conditionnels** au `PlanRequest`, streaming, thinking off.
- Retry conversationnel : chaque échec est rejoué en `assistant`=tool_use + `user`=tool_result(violations). Max 3 tentatives.
- **Retries du SDK désactivés** (`max_retries=0`) : le SDK Anthropic retente 2 fois par défaut et `timeout` s'applique **par requête**, pas à l'appel entier — un `messages.create(timeout=75)` pouvait donc consommer 225 s plus le backoff, à l'insu du budget global. C'est ce qui faisait qu'une seule « tentative » mangeait 125 s des 150 s et affamait la réparation ciblée. Les incidents transitoires (429, 5xx, réseau) remontent désormais en `TransientApiError` et c'est la boucle — seule à connaître la deadline — qui décide de réessayer.
- **Correction mécanique avant tout appel modèle** (`_auto_fix_strength_placement`) : un renfo placé la veille d'un jour dur a une solution déterministe — le déplacer sur un jour dont le lendemain est facile. Le code fait ce déplacement lui-même (gratuit, instantané, revalidé comme n'importe quel plan) au lieu de payer un aller-retour modèle qui, en pratique, remettait le bloc au même endroit chaque semaine. Adopté seulement si le nombre de violations baisse.
- **Réparation ciblée avant régénération** (`_repair_rounds`) : quand les violations désignent toutes des semaines précises, on ne régénère pas le plan — on renvoie au modèle *uniquement* ces semaines (outil `submit_weeks`), plus un résumé d'une ligne par semaine pour la cohérence d'ensemble, et on recolle les semaines corrigées par `index` avant de revalider le plan entier. Motif : sur un plan de 16 semaines une régénération complète dépasse à elle seule le budget total, donc le retry n'avait plus lieu d'être ; une réparation coûte quelques secondes. Trois garde-fous : une violation non rattachée à une semaine (nombre de semaines, taper, plan tout-deload) désactive le chemin et force la régénération ; un résultat qui augmente le nombre de violations est jeté ; une semaine d'`index` inconnu est ignorée, jamais ajoutée. Les rondes sont **par lots** (`_MAX_REPAIR_WEEKS`) : une violation systématique marque toutes les semaines, et les renvoyer toutes serait une régénération déguisée.

### Pourquoi la génération est un job, et pas une requête

La question « la plateforme laisse-t-elle une requête ouverte 150 s ? » ne se pose plus : **elle n'a jamais été la contrainte**. Un plan de 17 semaines pèse ~12,5k tokens de sortie, soit 200 à 350 s de génération pure. Aucun réglage de timeout ne fait tenir ça dans une requête HTTP — c'est de l'arithmétique, pas du tuning.

Mesures (`backend/scripts/bench_generation.py`, qui lance une vraie génération et rapporte tokens/durée/débit) :

| Plan | Tokens de sortie | Durée estimée |
|---|---|---|
| 8 semaines | ~5 900 | ~107 s |
| 12 semaines | ~8 800 | ~161 s |
| 17 semaines | ~12 500 | ~227 s |

Alléger la sortie ne sauve pas les plans longs : sans `structure` on tombe à ~147 s, sans `structure` ni `rationale` à ~118 s — au prix du détail des fractionnés, et toujours trop pour un plan de 17 semaines.

**Conséquence** : `POST /plans` et `POST /plans/replan-injury` renvoient **202 + un job** (`start_generation`), le travail tourne en tâche de fond (`run_generation_job`), et le client interroge `GET /jobs/{id}` puis relit `GET /plans/current`. Le budget est dimensionné sur les mesures ci-dessus, plus sur ce qu'une requête peut survivre.

Deux garde-fous que le passage en job impose :

- **Une génération déjà en cours est renvoyée telle quelle** plutôt que relancée — un double tap sur « générer » ne doit pas acheter deux plans.
- **Un job laissé `running`** au-delà de `job_service._STALE_AFTER` est rapporté `failed` : si le process est recyclé en cours de route, la ligne dirait `running` pour toujours et le client interrogerait un statut qui ne changera jamais. Rapporté à la lecture, jamais réécrit — le worker peut encore finir.

Reste vrai malgré tout : le streaming vers Anthropic protège l'appel **sortant**, pas la requête entrante. C'est justement pour ça que plus rien de long ne vit dans une requête entrante.

## Schéma JSON du plan (contrat de sortie)

```python
class Plan(BaseModel):
    goal: PlanGoal
    phases: list[Phase]                # base / build / peak / taper

class Phase(BaseModel):
    name: Literal["base", "build", "peak", "taper"]
    weeks: list[Week]

class Week(BaseModel):
    index: int                         # 1-based
    is_deload: bool
    target_load: float                 # TRIMP hebdo visé
    sessions: list[Session]

class Session(BaseModel):
    day: Weekday
    sport: SportType                   # RUN ; STRENGTH pour un renfo ; sport fixe sinon
    type: Literal["easy", "long_run", "tempo", "threshold", "intervals",
                  "recovery", "cross_training", "strength", "test", "race", "rest"]
    duration_min: int
    structure: list[Block]             # ex. échauffement / 6×800m / retour au calme
    pace_range: PaceRange | None
    hr_zone: int | None
    priority: Literal["key", "optional"]   # "key" = à ne pas sauter (exactement min/sem)
    slot: Literal["primary", "addon"]      # "addon" = renfo court partageant la journée
    rationale: str                     # 1 phrase ; obligatoire pour les 'key'
```

Types spéciaux : `strength` (renfo addon, sport=STRENGTH, on prescrit le créneau + l'intention, jamais les exercices), `test` (évaluation, alimente l'estimation de chrono — lot 4/5), `race` (le jour J, rend vérifiable « course le jour J »).

Le champ `rationale` est obligatoire : il alimente la transparence côté UI.

## validate_plan() — règles programmatiques

Retourne la liste des violations (vide = valide) :

> Les **valeurs** de ces règles (ratios, plafonds, nombres de séances) vivent dans le skill `training-science`, avec leur justification physiologique — elles ne sont pas répétées ici, pour qu'il n'y ait qu'un seul endroit à corriger. Ci-dessous : ce que le validateur vérifie et les constantes correspondantes.

1. Rampe : `target_load` hebdo n'augmente jamais au-delà de `RAMP_MAX_RATIO` (deload exclu de la comparaison ; après deload, on compare à la dernière semaine **normale**).
2. Charge initiale (si `context.avg_weekly_load_4w` dispo et non nul) : `weeks[0].target_load` ≤ charge réelle récente × `INITIAL_RAMP_MAX_RATIO` — plafond seulement, jamais plancher (une reprise démarre plus bas, c'est conforme).
3. Deload : ≥ 1 `is_deload` par bloc de `MAX_CONSECUTIVE_NORMAL_WEEKS` + 1 semaines ; une semaine deload doit réellement réduire la charge (`DELOAD_MAX_RATIO` de la dernière normale) ; un plan tout-deload est refusé.
4. Contraintes dures : chaque `FixedSport` apparaît **chaque semaine** sur l'un de ses jours déclarés (multi-jours géré ; si `flexible`, un seul des jours suffit) ; aucune séance course qualitative le lendemain d'un sport à impacts (frontière dimanche→lundi incluse).
5. Nombre de séances course : ≤ `max_run_sessions_per_week` au total, et **exactement** `min_run_sessions_per_week` marquées `priority="key"` chaque semaine normale (deload exempté). Renfo (`slot="addon"`) ne compte pas.
5b. Placement du renfo (`_check_strength_placement`) : jamais la veille d'une sortie longue ou d'une séance de qualité ; deux renfos d'une même semaine suffisamment espacés.
6. Taper : dernière(s) semaine(s) avec charge décroissante, course le jour J.
7. Sortie longue : progression ≤ `LONG_RUN_WEEKLY_STEP_MAX_MIN` vs la dernière semaine **normale**, plafond absolu selon la distance objectif (appliqué à toutes les semaines).
8. Séances de qualité course plafonnées par semaine (`MAX_QUALITY_PER_WEEK`) ; jamais 2 jours de qualité consécutifs (frontière dimanche→lundi incluse).
9. Cohérence calendrier : nombre de semaines = temps jusqu'à `race_date` ; jours dans `available_days`.

`validate_plan(plan, request, today, context=None)` : `context` (le dict `build_context`) est optionnel ; il active la règle 2.

En cas d'échec : renvoyer les violations dans le message de retry ("Le plan viole : …, corrige uniquement ces points").

## Adaptation dynamique (Phase 4)

Deux niveaux, à ne pas confondre :

- **Ajustement quotidien** (sans IA) : règles du skill training-science (HRV/sommeil/TSB) appliquées par le code → dégrade ou confirme la séance du jour. Rapide, déterministe, gratuit.
- **Replanification** (avec IA) : déclenchée par un événement structurel (≥ 2 séances clés manquées, blessure déclarée, TSB chroniquement < −25, **ou séance de test réalisée**). On régénère les semaines restantes avec le même pipeline, en passant l'historique réel réalisé.

### Replanification partielle — le comportement par défaut

**Implémenté.** Une replanification ne reconstruit jamais le plan entier. `build_replan_base`
(`plan_service.py`) gèle les semaines **1 à N incluses**, N étant la semaine en cours :

- la coupe est la **fin de la semaine en cours**, pas aujourd'hui — une semaine commencée est
  une semaine qu'on court, et une séance déjà faite et liée s'y trouve ;
- le `start_date` d'origine est **conservé**, donc la grille des semaines ne bouge pas et les
  liens `session_completions` continuent de désigner les séances qu'ils décrivaient ;
- les semaines gelées portent les **overrides** de l'athlète (`apply_overrides`) — geler le plan
  brut annulerait silencieusement chaque déplacement de séance ;
- le modèle ne produit que la **queue** (`_remaining_weeks_directive`, en indices absolus), puis
  `_splice` renumérote, fusionne une phase coupée par la couture et **garde l'objectif de
  l'athlète** ;
- le plan **recollé** est validé en entier avec `frozen_through=N` : les semaines gelées sont du
  **contexte, pas des accusées** — les règles de continuité (rampe, deload, raccord au réel, durée
  totale vs date de course) les voient toutes, les règles par semaine ne jugent que l'ouvert. Une
  violation dans une semaine que personne ne peut plus changer brûlerait les 3 tentatives.

`POST /plans/replan` (sans corps, réutilise l'objectif du plan actif) et `POST
/plans/replan-injury` passent tous les deux par cette base. Pour la blessure,
`_injury_directive` **retranche les jours d'arrêt qui tombent déjà dans la semaine gelée** : sinon
on prescrit jusqu'à une semaine de repos de plus que ce que l'athlète a déclaré.

Le **seul** chemin qui reconstruit tout depuis la semaine 1 est `POST /plans` (écran plan-setup) :
changer d'objectif, c'est un autre plan. Si le plan se termine dans la semaine en cours il n'y a
rien à replanifier → `409 NOTHING_TO_REPLAN`.

**Séance de test (Lot 5)** : quand `build_context.needs_test` est vrai (pas de perf mesurable récente, `low_confidence`, ou > 21 j sans courir), le prompt (`_test_directive`) demande une séance `type="test"` (échauffement + 2 km max + retour au calme, lancée idéalement en activité Garmin propre). Elle est placée dans la **première semaine réellement écrite** : semaine 1 sur un plan neuf, `base.last_week + 1` sur une replanification partielle — demander la semaine 1 là-bas, c'est demander une semaine gelée, donc ne jamais programmer le test. Une fois le test synchronisé, `compute_progress` détecte la séance réalisée et **propose** (jamais n'impose) une replanification — la génération recalcule le chrono estimé via `performance_service` à partir de la nouvelle perf.

**La suggestion doit s'éteindre, et ça ne va pas de soi.** La replanification partielle gèle la semaine qui porte le test : la séance ET son lien survivent à chaque replanification, alors qu'une reconstruction complète les supprimait (`needs_test` devenu faux). Sans garde, le bandeau se rallumait indéfiniment. La règle : **la suggestion ne vaut que si la performance est arrivée après l'écriture du plan actif.**

- Le plan porte `generated_at` — l'instant où son contenu a été **écrit par le modèle**. `restore_plan_version` le **recopie** de la source au lieu de le remettre à `now` : une restauration ne régénère rien, elle ne peut donc pas prétendre connaître une séance courue depuis. Les documents antérieurs au champ sont résolus en remontant la chaîne `restored_from` (`_plan_generated_at`), sans migration.
- La performance porte `linked_at` (lien explicite) ou le `start_time` de la course du jour (`_performance_instant`).
- On compare des **instants, pas des dates** : replanifier l'après-midi même du test doit l'éteindre.

Chaque adaptation crée une nouvelle version du plan (`plan_versions`) — jamais de mutation en place, l'utilisateur peut voir l'historique.

### Écrire une violation que le modèle peut corriger

Une violation est un **message d'erreur adressé à un modèle**, pas un log. Trois règles, payées cher :

- **Ne jamais arrondir le nombre dont dépend la correction.** `+{pct:.0f}%` a transformé un dépassement réel de 10,4 % en « charge +10% (> 10% autorisé) » — un message qui se contredit et ne laisse rien à corriger. Trois tentatives, trois réparations et tout le budget, sans plan. Une décimale partout.
- **Donner le plafond, pas seulement l'écart.** « charge 110.4, maximum autorisé 110.0 (+10% sur la dernière semaine normale à 100.0) » : le modèle n'a plus qu'un nombre à écrire, au lieu d'un ratio à re-dériver.
- **Ce qu'on reproche doit être visible dans ce qu'on envoie.** `_plan_outline` affichait `charge={:.0f}` : deux semaines à 100,4 et 110,4 arrivaient en « 100 » et « 110 », un couple d'apparence conforme. On demandait de réparer l'invisible.
- ⚠️ **`_violation_weeks` parse ces messages** (`_WEEK_IN_VIOLATION`, `r"Semaine (\d+)\s*:"`). Reformuler une violation sans garder le préfixe `Semaine N :` fait rendre `None`, et **tout bascule en régénération complète** — l'inverse du but. Un test verrouille ça.

### Champs « runtime » de `Session` : `skipped`, `completed`

Ils ne sont **jamais** produits par le générateur : ils sont posés à la lecture par `plan_moves_service.apply_overrides` et **retirés des deux schémas d'outil** (`_plan_tool_schema` et `_repair_tool_schema` — en oublier un laisserait le modèle annoncer à l'athlète qu'il a sauté ou couru une séance qu'il n'a jamais faite). Ils voyagent sur la session parce que la liste de semaine affiche déjà cet objet : demander « celle-ci est-elle faite ? » par ligne serait une requête par ligne pour une information que la lecture du plan connaît déjà.

**L'ordre d'application est porteur, dans les deux sens :**

```python
apply_edits(...)        # indexées sur le jour d'ORIGINE — avant tout déplacement
apply_moves(...)        # réécrit les jours
apply_completions(...)  # indexées sur le jour AFFICHÉ — donc après
```

Une liaison est enregistrée avec le jour que la séance affichait au moment du tap. Appliquée avant `apply_moves`, une séance déplacée du mardi au jeudi puis validée ne serait jamais retrouvée.

`get_completions` interroge `session_completions` **directement** : `plan_completion_service` importe déjà `plan_moves_service`, l'inverse fermerait un cycle. Et contrairement aux moves et aux edits, les liaisons ne sont **pas scopées par version de plan** — c'est précisément ce qui leur fait survivre à une replanification partielle, les semaines gelées gardant leur identité `(semaine, jour, slot)`.

⚠️ **Côté mobile, toute mutation de liaison doit invalider `qk.plan()`**, pas seulement `qk.sessionLink(...)` : le ✓ de la liste vient désormais de la lecture du plan.

### Solder une semaine écoulée (`plan_reconcile_service`)

Une séance passée que personne n'a tranchée **n'est pas neutre** : `_make_run_done` rend `False`, elle compte donc comme manquée, ce qui alimente `_MISSED_KEY_TRIGGER` et le verdict du bilan. Le plan réagit à quelque chose que l'athlète n'a jamais dit. L'écran de règlement (bloquant, `week-reconcile`) est l'endroit où il le dit — lié, ou non fait.

- **Réglée = `completed` ou `skipped`.** Une course détectée par l'heuristique (≥ 60 % de la durée prévue le bon jour) reste **en suspens**, mais pré-remplie avec son activité : un tap transforme une supposition en fait. Seul un lien explicite donne accès aux splits, à l'allure réelle et à la dérive.
- **Borné à `_WINDOW_DAYS` (14 j).** Au-delà, `_counts_in_window` ignore déjà la séance : trancher n'y changerait rien. C'est ce qui empêche trois semaines d'absence de coûter quinze décisions.
- **Deux actions de masse obligatoires** (`confirm_all_suggested`, `resolve_all_missed`). Sans elles un écran bloquant devient un mur : une semaine suivie doit se solder en un tap, une semaine ratée aussi.
- ⚠️ **Le piège qui enfermerait l'athlète** : `pending` renvoie le jour **affiché** d'une séance, alors qu'un skip est stocké sur le jour **d'origine** du plan (`_edit_session` résout via `_find_session`). Si ces deux-là divergeaient, le skip ne prendrait pas, la séance resterait en suspens et l'app bloquerait indéfiniment. Vérifié par test, jamais supposé.
- Côté mobile, **seuls les onglets sont bloqués**, pas les routes racine : Réglages doit rester atteignable pour qu'une file qui ne se vide pas n'enferme personne. Et l'écran redirige lui-même vers l'Accueil quand la file se vide, puisque le layout qui l'a déclenché est démonté.

### Un échec n'est pas un plan

`generate_plan` **lève** `PlanGenerationError` et n'écrit rien. `run_generation_job` la rattrape, marque le job échoué avec le message et envoie la notification — le job est le registre d'une tentative, la collection `plans` celui des plans.

Ce qui a coûté cher avant ça : un échec était persisté en document `status: "failed"` à la version suivante. Or **`get_current_plan` était la seule lecture du service à ne pas filtrer sur le statut** (toutes les autres demandent `"ready"`). Le document échoué devenait donc « le plan actuel » sur le seul écran qui permet d'agir, pendant que progression, séance du jour et bilan continuaient de lire le vrai plan. Le plan de l'athlète semblait perdu alors qu'il était intact, et l'écran d'erreur n'offrait **aucune action** — tout y était conditionné à `ready`.

Deux règles qui en sortent :

- **Toute lecture de plan filtre sur le statut.** `get_current_plan` exclut explicitement `failed` (des documents antérieurs existent en base) et rend `None` sur `cancelled`.
- **Ne jamais conditionner la seule porte de sortie à l'état heureux.** Le lien « Mes plans » — chemin vers la restauration — était masqué hors `ready`, c'est-à-dire précisément quand on en a besoin.

`last_generation_error` sur `PlanResponse` porte la raison du dernier échec quand il est **postérieur** au plan rendu (`job_service.last_failure_since`). Auto-effaçant : une génération réussie est plus récente que l'échec, donc le champ redevient nul sans bouton ni état à purger.

### Correctifs mécaniques : ce que le code doit réparer lui-même

Quand une violation a une correction déterministe, la faire en code — c'est gratuit, instantané, et le modèle a prouvé qu'il refaisait la même erreur à chaque tour. Deux en place, appliqués avant toute réparation modèle dans `_generate_valid_plan` :

- `_auto_fix_strength_placement` : déplace un renfo mal placé.
- `_auto_fix_ramp` : rabat une charge marginalement au-dessus du plafond de rampe. **Borné à `_RAMP_AUTOFIX_MAX_OVERSHOOT` (2 %)** : `target_load` est une estimation que le modèle produit à l'œil, une précision meilleure que ~1 % y est du bruit, donc rabattre 110,4 à 110,0 aligne l'étiquette. Au-delà, le plan est réellement trop lourd et réécrire l'étiquette laisserait des séances trop dures sous un nombre conforme — falsifier le plan pour satisfaire son propre validateur. Le correctif ne fait **jamais monter** une charge : la règle des 10 % ne peut pas être affaiblie par ce chemin.

**Toute re-validation d'un candidat réparé doit passer `frozen_through`.** Omis, les semaines gelées sont rejugées, le compte de violations gonfle, la condition « moins qu'avant » échoue et une réparation qui marchait est jetée — silencieusement, sur chaque replanification.

## Coûts et robustesse

- Cache : une génération = ~1 appel ; pas de régénération silencieuse en boucle (max 3 tentatives puis erreur explicite à l'utilisateur).
- **Bilan hebdo : la narration s'écrit une fois par semaine et se relit ensuite** (`weekly_reviews`, clé `(user_id, week_start)`, index unique). Le piège qu'on a payé : `GET /reviews/weekly` est refetché au focus de l'onglet (`staleTime` 5 min), donc régénérer la phrase à chaque lecture dépensait un appel par ouverture d'app — pour décrire une semaine déjà terminée, qui ne changera plus. Les **chiffres** restent recalculés à chaque lecture (le TSB affiché doit être vivant) ; seule la phrase est en cache. Le cron du dimanche n'écrit rien d'autre : il ne fait que pré-écrire cette phrase avant que l'athlète n'ouvre l'app. Règle générale : **avant de mettre un appel modèle derrière un GET, regarder à quelle fréquence le client le refetche.**
- Timeout httpx 60 s ; les générations passent par une tâche de fond (le mobile poll `GET /plans/{id}/status`).
- Logguer les prompts/réponses en dev uniquement, jamais en prod (données santé).
