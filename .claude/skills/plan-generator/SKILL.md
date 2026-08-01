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

- Modèle : `claude-sonnet-5` (aligné sur `config.plan_model`). Clé en variable d'env `ANTHROPIC_API_KEY`, jamais côté client. Un client par génération (pas un par tentative), deadline globale 150.0 s pour 75.0 s par tentative (`_TOTAL_DEADLINE_S` / `_ANTHROPIC_TIMEOUT_S`). Les deux doivent rester distincts — à valeurs égales, une première tentative lente consomme tout le budget et le retry n'a jamais lieu ; chaque tentative est en plus bornée par ce qui reste. `test_skill_documents_the_real_timeouts` échoue si cette ligne diverge du code. Génération **synchrone** dans la requête HTTP — voir ci-dessous, l'hypothèse sur laquelle ça repose n'est pas vérifiée.
- **Tool use** : le plan est émis via l'outil `submit_plan` dont l'`input_schema` = `Plan.model_json_schema()` + `tool_choice` forcé. Ça supprime la classe d'erreurs « JSON non conforme » ; `tool_block.input` est déjà un dict → `Plan.model_validate(...)`.
- System prompt : rôle de coach, règles training-science, priority/min-max, renfo et cross-training **conditionnels** au `PlanRequest`, streaming, thinking off.
- Retry conversationnel : chaque échec est rejoué en `assistant`=tool_use + `user`=tool_result(violations). Max 3 tentatives.
- **Retries du SDK désactivés** (`max_retries=0`) : le SDK Anthropic retente 2 fois par défaut et `timeout` s'applique **par requête**, pas à l'appel entier — un `messages.create(timeout=75)` pouvait donc consommer 225 s plus le backoff, à l'insu du budget global. C'est ce qui faisait qu'une seule « tentative » mangeait 125 s des 150 s et affamait la réparation ciblée. Les incidents transitoires (429, 5xx, réseau) remontent désormais en `TransientApiError` et c'est la boucle — seule à connaître la deadline — qui décide de réessayer.
- **Réparation ciblée avant régénération** (`_repair_rounds`) : quand les violations désignent toutes des semaines précises, on ne régénère pas le plan — on renvoie au modèle *uniquement* ces semaines (outil `submit_weeks`), plus un résumé d'une ligne par semaine pour la cohérence d'ensemble, et on recolle les semaines corrigées par `index` avant de revalider le plan entier. Motif : sur un plan de 16 semaines une régénération complète dépasse à elle seule le budget total, donc le retry n'avait plus lieu d'être ; une réparation coûte quelques secondes. Trois garde-fous : une violation non rattachée à une semaine (nombre de semaines, taper, plan tout-deload) désactive le chemin et force la régénération ; un résultat qui augmente le nombre de violations est jeté ; une semaine d'`index` inconnu est ignorée, jamais ajoutée.

### Limite de requête entrante — NON VÉRIFIÉE

Tout le design synchrone de `generate_plan` repose sur une hypothèse qui n'a **jamais été mesurée** : que la plateforme d'hébergement laisse une requête entrante rester ouverte 150 s sans qu'aucun octet ne soit émis. Ne pas la traiter comme acquise.

Piège à ne pas refaire : le streaming vers Anthropic protège l'appel **sortant**. La requête **entrante**, elle, reste totalement silencieuse pendant toute la génération — c'est une limite d'inactivité côté plateforme (load balancer, proxy) qui la coupera, pas un timeout applicatif. Si ça arrive, le client prend un 502 pendant que le backend continue de consommer des tokens pour un plan que personne ne recevra.

**Procédure de mesure** (à faire sur l'environnement déployé, pas en local — c'est le proxy de la plateforme qu'on teste, pas uvicorn) :

1. Poser `ENABLE_DEBUG_SLOW=true` dans les variables d'env du service, redéployer.
2. `curl -w '\n%{http_code} %{time_total}s\n' "https://<host>/debug/slow?seconds=150"`
3. Lire le **corps** de la réponse, pas seulement le code : un 502/504 ou une connexion coupée = la limite est sous 150 s. Le champ `elapsed_s` renvoyé permet de repérer un proxy qui répondrait tôt.
4. Si 150 s passe, remonter (`seconds=200`, `300`) pour connaître la marge réelle.
5. **Inscrire le résultat daté juste en dessous**, retirer `ENABLE_DEBUG_SLOW`, puis supprimer `app/api/debug.py`, le réglage `enable_debug_slow` et `tests/test_debug_slow.py`.

**Résultat de la mesure** : *(non mesuré — remplacer par : date, hébergeur, durée testée, verdict)*

**Si le test échoue à 150 s** : la génération doit passer en job, c'est l'option B de la section 7.2 de `docs/refonte-plan-generator-addendum.md`. `job_service` et `api/jobs.py` existent déjà et servent la synchro Garmin ; `generate_plan` devient un job persisté en base, l'endpoint répond immédiatement avec un `job_id`, et le mobile interroge son statut. Un job persisté ne souffre pas du problème qui a fait écarter les `BackgroundTask` (processus recyclé sur un hébergement mono-instance gratuit). Ne pas rafistoler avec un timeout plus court : réduire le budget en dessous d'une génération réelle rendrait juste l'échec plus fréquent.

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
- **Replanification** (avec IA) : déclenchée par un événement structurel (≥ 2 séances clés manquées, blessure déclarée, changement d'objectif, TSB chroniquement < −25, **ou séance de test réalisée**). On régénère les semaines restantes avec le même pipeline, en passant l'historique réel réalisé.

**Séance de test (Lot 5)** : quand `build_context.needs_test` est vrai (pas de perf mesurable récente, `low_confidence`, ou > 21 j sans courir), le prompt (`_test_directive`) demande une séance `type="test"` en semaine 1 (échauffement + 2 km max + retour au calme, lancée idéalement en activité Garmin propre). Une fois le test synchronisé, `compute_progress` détecte la séance test réalisée et **propose** (jamais n'impose) une replanification — la régénération recalcule le chrono estimé via `performance_service` à partir de la nouvelle perf.

Chaque adaptation crée une nouvelle version du plan (`plan_versions`) — jamais de mutation en place, l'utilisateur peut voir l'historique.

## Coûts et robustesse

- Cache : une génération = ~1 appel ; pas de régénération silencieuse en boucle (max 3 tentatives puis erreur explicite à l'utilisateur).
- Timeout httpx 60 s ; les générations passent par une tâche de fond (le mobile poll `GET /plans/{id}/status`).
- Logguer les prompts/réponses en dev uniquement, jamais en prod (données santé).
