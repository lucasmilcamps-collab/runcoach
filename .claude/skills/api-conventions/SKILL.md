---
name: api-conventions
description: Patterns techniques du projet — structure FastAPI + Motor/MongoDB, modèles Pydantic, auth JWT, gestion d'erreurs, tâches de fond, et conventions Expo/React Native côté mobile (TanStack Query, Zustand, client API). Consulter ce skill avant d'écrire ou modifier tout endpoint, service, modèle, hook ou écran — c'est la référence de style du code, même pour une "petite" modification.
---

# API & Code Conventions

## Backend — structure d'un domaine

Chaque domaine (garmin, plans, workouts…) suit le même triptyque :

```
app/api/plans.py        # router : validation I/O, auth, appelle le service
app/services/plan_service.py   # logique métier, testable sans HTTP
app/models/plan.py      # PlanCreate / PlanResponse / PlanDocument
```

- Le router ne contient **aucune logique métier** ; le service ne connaît **rien de HTTP** (il lève des exceptions métier, mappées en HTTPException par le router).
- Injection : `db: AsyncIOMotorDatabase = Depends(get_db)`, `user: User = Depends(get_current_user)`.

## Modèles Pydantic

```python
class PlanCreate(BaseModel): ...          # payload entrant
class PlanResponse(BaseModel): ...        # sortie API — jamais de champs internes (raw, tokens)
class PlanDocument(PlanResponse): ...     # + _id, user_id, created_at, champs internes
```

- `model_config = ConfigDict(populate_by_name=True)` ; `_id` Mongo mappé sur `id: str`.
- Datetimes toujours **UTC aware** en base ; conversion timezone côté client.

## Erreurs

```python
raise HTTPException(status_code=409, detail={"code": "PLAN_ALREADY_ACTIVE",
                                             "message": "Un plan actif existe déjà."})
```

Codes stables en SCREAMING_SNAKE (le mobile s'appuie dessus pour les messages traduits). 401 auth, 403 droits, 404 introuvable, 409 conflit métier, 422 validation (laissé à FastAPI), 502 erreur amont (Garmin/Anthropic).

## Auth

JWT (access 30 min + refresh 30 j), `python-jose` + `passlib[bcrypt]`. Toutes les routes sous `/api/v1` sauf `/auth/*` exigent le bearer token. Un utilisateur n'accède qu'à ses propres documents : **tout query Mongo inclut `user_id`** — pas d'exception.

## Tâches de fond

Sync Garmin et génération de plan = opérations longues → pattern job :

```
POST /api/v1/plans           → 202 + {job_id}
GET  /api/v1/jobs/{job_id}   → {status: pending|running|done|failed, result_id?}
```

Implémentation simple au départ : `asyncio.create_task` + collection `jobs`. Pas de Celery tant que ce n'est pas nécessaire.

## Tests

- `pytest` + `pytest-asyncio`, base de test via `mongomock-motor` ou instance Mongo éphémère.
- Les formules de training-science ont des **tests à valeurs de référence** (ex. TRIMP d'une séance connue, courbe CTL sur 42 jours constants → converge vers la charge quotidienne).
- `validate_plan()` a un test par règle de validation (plan violant uniquement cette règle).

## Mobile — Expo

- **Expo Router** (file-based) : `app/(tabs)/index.tsx` (dashboard), `plan/`, `activity/[id].tsx`, `settings/`.
- **État serveur = TanStack Query** (clés : `['plan', planId]`, `['activities', filters]`), **état UI local = Zustand**. Jamais de données serveur dans Zustand.
- Client API unique dans `lib/api.ts` (fetch wrapper : base URL, bearer token, refresh automatique sur 401, parsing du `detail.code`).
- Types partagés : générer les types TS depuis l'OpenAPI de FastAPI (`openapi-typescript`) — ne jamais dupliquer les modèles à la main.
- Support web activé (`npx expo start --web`) : tester chaque écran sur web ET mobile ; pas d'API native sans fallback web.
- Design : dark theme par défaut, graphiques de charge avec `victory-native`.

## Sécurité (rappels non négociables)

- Aucune clé API (Anthropic, chiffrement) côté mobile ou dans le repo — `.env` + settings Pydantic.
- Données santé : jamais dans les logs, jamais dans les messages d'erreur renvoyés au client.
- CORS restreint aux origines connues, même en dev.
