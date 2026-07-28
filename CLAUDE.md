# RunCoach — App de coaching course à pied multi-sports

## Vision produit

App de tracking et coaching course à pied (inspirée de Campus Coach / Runna) qui :
1. Génère un plan d'entraînement **par IA** à partir d'un objectif (course cible ou distance + chrono visé).
2. Prend en compte **les autres sports pratiqués** (padel, basket, etc.) comme charge d'entraînement croisée — pas comme du bruit.
3. Exploite les **données Garmin** (activités, FC, HRV, sommeil, Body Battery, VO2max) pour construire ET adapter le plan en continu.

Le différenciateur vs Runna : l'adaptation dynamique du plan aux données réelles de récupération et aux séances des autres sports.

## Architecture

```
backend/          FastAPI + MongoDB (Motor, async)
  app/
    api/          Routers (un fichier par domaine : auth, garmin, plans, workouts)
    services/     Logique métier (garmin_service, plan_service, load_service)
    models/       Modèles Pydantic (schemas API) + documents Mongo
    core/         Config, sécurité, dépendances
  tests/
mobile/           Expo (React Native) — cible iOS, Android ET web/desktop
  src/
    app/          Expo Router (file-based routing)
    components/
    lib/          Client API, hooks, stores (Zustand)
docs/             Specs fonctionnelles et décisions d'architecture
```

- **Une seule codebase frontend** : Expo avec support web activé. Ne jamais créer de frontend desktop séparé.
- La génération de plans appelle l'**API Anthropic côté backend uniquement** (jamais depuis le mobile — pas de clé API côté client).
- Les tokens Garmin sont stockés chiffrés en MongoDB, jamais en clair, jamais loggés.

## Commandes

```bash
# Backend (uv si disponible)
cd backend && uv sync                      # installer les dépendances
uv run uvicorn app.main:app --reload       # lancer en dev (port 8000)
uv run pytest                              # tests
uv run ruff check --fix && uv run ruff format   # lint + format

# Backend — repli si `uv` est bloqué (ex. politique de sécurité d'entreprise) :
# python -m venv .venv && .venv\Scripts\python -m pip install -r requirements-dev.txt
# .venv\Scripts\python -m uvicorn app.main:app --reload
# .venv\Scripts\python -m pytest
# .venv\Scripts\python -m ruff check --fix . && .venv\Scripts\python -m ruff format .

# Mobile
cd mobile && npm install
npx expo start                             # dev (QR code pour mobile, w pour web)
npm test
```

## Conventions

- **Langue** : code, noms de variables et commits en **anglais** ; documentation dans `docs/` en français.
- **API** : REST, préfixe `/api/v1/`, réponses en snake_case, erreurs via `HTTPException` avec un `detail` structuré `{code, message}`.
- **Async partout** dans le backend (Motor, httpx). Pas de client Mongo synchrone.
- **Pydantic v2** : modèles de requête/réponse séparés des documents Mongo (`XCreate`, `XResponse`, `XDocument`).
- **Tests** : tout service métier a des tests unitaires ; les calculs de charge/zones (training-science) ont des tests avec valeurs de référence connues.
- **Frontend** : TypeScript strict, composants fonctionnels, état serveur via TanStack Query, état local via Zustand.
- Commits conventionnels : `feat:`, `fix:`, `refactor:`, `docs:`, `test:`.

## Règles métier critiques (à ne jamais violer)

- Les **zones cardiaques** se calculent à partir de la FC max et FC repos réelles issues de Garmin (méthode Karvonen), **jamais** avec la formule 220 − âge.
- La **charge d'entraînement hebdomadaire ne progresse jamais de plus de 10 %** d'une semaine à l'autre, cross-training inclus.
- Une semaine de **décharge (deload)** toutes les 3 à 4 semaines est obligatoire dans tout plan généré.
- Les séances des **autres sports comptent dans la charge** : elles ne sont jamais ignorées dans le calcul ATL/CTL.
- Un plan généré par IA est **toujours validé par le validateur programmatique** (`plan_service.validate_plan`) avant d'être persisté. Si la validation échoue, on régénère — on ne persiste jamais un plan invalide.
- Aucune recommandation médicale : si les données suggèrent un surentraînement sévère, l'app recommande du repos et de consulter un professionnel, rien de plus.

## Skills du projet

Consulte systématiquement le skill concerné avant de coder dans son domaine :

- `.claude/skills/garmin-sync` — intégration python-garminconnect : auth, endpoints, tokens, rate limiting, mapping des données.
- `.claude/skills/training-science` — science de l'entraînement : zones, TSS/CTL/ATL/TSB, périodisation, équivalences cross-training.
- `.claude/skills/plan-generator` — génération IA des plans : prompts, schéma JSON, validation, adaptation dynamique.
- `.claude/skills/api-conventions` — patterns FastAPI/Mongo/Expo détaillés du projet.

## État du projet

Projet démarré de zéro. Phases prévues :
1. **Phase 1** : backend + auth + sync Garmin (ingestion activités et métriques santé).
2. **Phase 2** : moteur de charge (TSS/CTL/ATL) + génération de plan v1 (cas de test réel : semi-marathon avec basket hebdomadaire fixe).
3. **Phase 3** : app Expo — consultation du plan, tracking des séances, dashboard charge/forme.
4. **Phase 4** : adaptation dynamique du plan (HRV/sommeil/séances manquées) — le différenciateur.
