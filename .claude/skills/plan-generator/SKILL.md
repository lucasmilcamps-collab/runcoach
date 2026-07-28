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

## Appel API Anthropic

- Modèle : `claude-sonnet-5` (aligné sur `config.plan_model`). Clé en variable d'env `ANTHROPIC_API_KEY`, jamais côté client. Un client par génération (pas un par tentative), deadline globale 90 s.
- **Tool use** : le plan est émis via l'outil `submit_plan` dont l'`input_schema` = `Plan.model_json_schema()` + `tool_choice` forcé. Ça supprime la classe d'erreurs « JSON non conforme » ; `tool_block.input` est déjà un dict → `Plan.model_validate(...)`.
- System prompt : rôle de coach, règles training-science, priority/min-max, renfo et cross-training **conditionnels** au `PlanRequest`, streaming, thinking off.
- Retry conversationnel : chaque échec est rejoué en `assistant`=tool_use + `user`=tool_result(violations). Max 3 tentatives.

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

1. Rampe : `target_load` hebdo n'augmente jamais de > 10 % (deload exclu de la comparaison ; après deload, on compare à la dernière semaine **normale**).
2. Charge initiale (si `context.avg_weekly_load_4w` dispo et non nul) : `weeks[0].target_load` ≤ charge réelle récente × 1,10 — plafond seulement, jamais plancher (une reprise démarre plus bas, c'est conforme).
3. Deload : ≥ 1 `is_deload` par bloc de 4 semaines ; une semaine deload doit réellement réduire la charge (≤ 85 % de la dernière normale) ; un plan tout-deload est refusé.
4. Contraintes dures : chaque `FixedSport` apparaît **chaque semaine** sur l'un de ses jours déclarés (multi-jours géré ; si `flexible`, un seul des jours suffit) ; aucune séance course qualitative le lendemain d'un sport à impacts (frontière dimanche→lundi incluse).
5. Nombre de séances course : ≤ `max_run_sessions_per_week` au total, et **exactement** `min_run_sessions_per_week` marquées `priority="key"` chaque semaine normale (deload exempté). Renfo (`slot="addon"`) ne compte pas.
5b. Placement du renfo : jamais la veille d'une sortie longue ou d'une séance de qualité ; deux renfos/semaine espacés d'au moins 48 h.
6. Taper : dernière(s) semaine(s) avec charge décroissante, course le jour J.
7. Sortie longue : progression ≤ 15 min/sem vs la dernière semaine **normale**, plafond absolu selon la distance objectif (appliqué à toutes les semaines).
8. Max 2 séances de qualité course/semaine ; jamais 2 jours de qualité consécutifs (frontière dimanche→lundi incluse).
9. Cohérence calendrier : nombre de semaines = temps jusqu'à `race_date` ; jours dans `available_days`.

`validate_plan(plan, request, today, context=None)` : `context` (le dict `build_context`) est optionnel ; il active la règle 2.

En cas d'échec : renvoyer les violations dans le message de retry ("Le plan viole : …, corrige uniquement ces points").

## Adaptation dynamique (Phase 4)

Deux niveaux, à ne pas confondre :

- **Ajustement quotidien** (sans IA) : règles du skill training-science (HRV/sommeil/TSB) appliquées par le code → dégrade ou confirme la séance du jour. Rapide, déterministe, gratuit.
- **Replanification** (avec IA) : déclenchée par un événement structurel (≥ 2 séances clés manquées, blessure déclarée, changement d'objectif, TSB chroniquement < −25). On régénère les semaines restantes avec le même pipeline, en passant l'historique réel réalisé.

Chaque adaptation crée une nouvelle version du plan (`plan_versions`) — jamais de mutation en place, l'utilisateur peut voir l'historique.

## Coûts et robustesse

- Cache : une génération = ~1 appel ; pas de régénération silencieuse en boucle (max 3 tentatives puis erreur explicite à l'utilisateur).
- Timeout httpx 60 s ; les générations passent par une tâche de fond (le mobile poll `GET /plans/{id}/status`).
- Logguer les prompts/réponses en dev uniquement, jamais en prod (données santé).
