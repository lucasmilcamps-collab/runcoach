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
    goal_type: Literal["race", "distance"]
    race_date: date | None
    distance_km: float                 # 10, 21.1, 42.2…
    target_time: timedelta | None      # optionnel : "finir" est un objectif valide
    weekly_availability: dict[Weekday, list[TimeSlot]]
    fixed_sports: list[FixedSport]     # ex. basket mercredi soir — contrainte dure
    max_run_sessions_per_week: int
```

Contexte calculé ajouté au prompt : CTL/ATL actuels, volume course des 8 dernières semaines, meilleur chrono récent (extrait des activités Garmin), zones FC personnelles, flag `low_confidence` si historique < 90 j.

## Appel API Anthropic

- Modèle : `claude-sonnet-5` (aligné sur `config.plan_model` ; bon rapport qualité/coût pour du JSON structuré). Clé en variable d'env `ANTHROPIC_API_KEY`, jamais côté client.
- System prompt : rôle de coach, **règles du skill training-science injectées en résumé** (rampe 10 %, deload 3–4 sem, périodisation, contraintes cross-training), et consigne stricte : "Réponds uniquement avec le JSON, sans markdown".
- Parsing : strip des éventuels ```json, puis `Plan.model_validate_json()`. Toute erreur de parsing = tentative échouée → retry avec l'erreur en feedback.

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
    sport: SportType                   # RUN ou sport fixe de l'utilisateur
    type: Literal["easy", "long_run", "tempo", "threshold", "intervals",
                  "recovery", "cross_training", "rest"]
    duration_min: int
    structure: list[Block]             # ex. échauffement / 6×800m / retour au calme
    pace_range: PaceRange | None       # pour la course
    hr_zone: int | None
    rationale: str                     # 1 phrase : pourquoi cette séance ici
```

Le champ `rationale` est obligatoire : il alimente la transparence côté UI.

## validate_plan() — règles programmatiques

Retourne la liste des violations (vide = valide) :

1. Rampe : `target_load` hebdo n'augmente jamais de > 10 % (deload exclu de la comparaison ; après deload, on compare à la dernière semaine normale).
2. Deload : au moins 1 semaine `is_deload` par bloc de 4 semaines.
3. Contraintes dures : chaque `FixedSport` apparaît au bon jour ; aucune séance course qualitative (tempo/threshold/intervals) le lendemain d'un sport à impacts.
4. Taper : dernière(s) semaine(s) avec charge décroissante, course le jour J.
5. Sortie longue : progression ≤ 15 min/sem, plafond selon la distance objectif.
6. Max 2 séances de qualité course/semaine ; jamais 2 jours de qualité consécutifs.
7. Cohérence calendrier : nombre de semaines = temps jusqu'à `race_date` ; jours dans `weekly_availability`.

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
