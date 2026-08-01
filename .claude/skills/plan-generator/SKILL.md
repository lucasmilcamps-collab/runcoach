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
- **Replanification** (avec IA) : déclenchée par un événement structurel (≥ 2 séances clés manquées, blessure déclarée, changement d'objectif, TSB chroniquement < −25, **ou séance de test réalisée**). On régénère les semaines restantes avec le même pipeline, en passant l'historique réel réalisé.

**Séance de test (Lot 5)** : quand `build_context.needs_test` est vrai (pas de perf mesurable récente, `low_confidence`, ou > 21 j sans courir), le prompt (`_test_directive`) demande une séance `type="test"` en semaine 1 (échauffement + 2 km max + retour au calme, lancée idéalement en activité Garmin propre). Une fois le test synchronisé, `compute_progress` détecte la séance test réalisée et **propose** (jamais n'impose) une replanification — la régénération recalcule le chrono estimé via `performance_service` à partir de la nouvelle perf.

Chaque adaptation crée une nouvelle version du plan (`plan_versions`) — jamais de mutation en place, l'utilisateur peut voir l'historique.

## Coûts et robustesse

- Cache : une génération = ~1 appel ; pas de régénération silencieuse en boucle (max 3 tentatives puis erreur explicite à l'utilisateur).
- Timeout httpx 60 s ; les générations passent par une tâche de fond (le mobile poll `GET /plans/{id}/status`).
- Logguer les prompts/réponses en dev uniquement, jamais en prod (données santé).
