---
name: garmin-sync
description: Intégration Garmin Connect via python-garminconnect — authentification, stockage des tokens, endpoints de données (activités, FC, HRV, sommeil, Body Battery, VO2max), rate limiting et mapping vers les modèles du projet. Utiliser ce skill dès que le code touche à Garmin, à la synchronisation d'activités, aux métriques de santé, aux tokens, ou à tout endpoint sous /api/v1/garmin — même si "Garmin" n'est pas mentionné explicitement (ex. "récupère mon sommeil", "synchronise mes courses").
---

# Garmin Sync

## Librairie

`python-garminconnect` (wrapper non officiel de l'API Garmin Connect). Pas d'API officielle grand public : pas de vrai OAuth applicatif, l'utilisateur fournit ses identifiants Garmin une fois, on stocke les tokens de session.

```bash
uv add garminconnect
```

## Authentification et tokens

```python
from garminconnect import Garmin

client = Garmin(email, password)
client.login()
# Sérialiser les tokens pour éviter de re-login à chaque sync.
# Note : sur garminconnect >= 0.3, l'attribut s'appelle `.client` (pas `.garth`).
token_data = client.client.dumps()   # str JSON
# Restaurer plus tard :
client = Garmin()
client.client.loads(token_data)
```

Règles :
- Les tokens sont **chiffrés** (Fernet, clé dans les settings) avant stockage dans la collection `garmin_credentials`. Le mot de passe Garmin n'est **jamais** persisté.
- Les tokens expirent (~1 an, mais peuvent être invalidés). Toute erreur d'auth → marquer la connexion `needs_relogin` et notifier l'utilisateur, ne pas boucler sur des retries de login (risque de blocage du compte Garmin).
- Un login trop fréquent déclenche des CAPTCHA/blocages : **toujours restaurer les tokens**, ne re-login qu'en dernier recours.

## Endpoints utiles (méthodes du client)

| Besoin | Méthode | Notes |
|---|---|---|
| Activités | `get_activities(start, limit)` | Paginer par 20 ; filtrer par `activityType` |
| Détail activité | `get_activity(activity_id)` | Splits, FC moyenne/max, cadence, allure |
| Temps par zone FC | `get_activity_hr_in_timezones(activity_id)` | **Absent de la liste d'activités** : un appel par activité. Zones Garmin, pas les nôtres |
| FC repos & max | `get_heart_rates(date)` | `restingHeartRate` quotidien |
| HRV | `get_hrv_data(date)` | `lastNightAvg`, statut (balanced/unbalanced/low) |
| Sommeil | `get_sleep_data(date)` | durée, phases, score |
| Body Battery | `get_body_battery(start, end)` | niveau 0–100 |
| VO2max | `get_max_metrics(date)` | course et cyclisme séparés |
| Statut d'entraînement | `get_training_status(date)` | productive/maintaining/overreaching… |
| Profil | `get_user_profile()` | FC max configurée, zones utilisateur |

## Stratégie de synchronisation

- **Sync incrémentale** : stocker `last_sync_at` par utilisateur ; ne récupérer que les activités depuis cette date. Sync complète uniquement à la première connexion (90 jours d'historique — nécessaire pour amorcer le CTL, voir training-science).
- **Idempotence** : upsert par `garmin_activity_id` (index unique). Une resync ne duplique jamais.
- **Rate limiting** : max ~1 requête/seconde, sync globale par utilisateur max 1×/15 min. Utiliser un semaphore asyncio ; `python-garminconnect` est synchrone → l'appeler via `asyncio.to_thread`.
- Les métriques quotidiennes (HRV, sommeil, Body Battery) se synchronisent en un batch quotidien, pas à la demande.
- **Temps par zone FC (`hr_zone_seconds`)** — `enrich_run_zone_seconds`, après la mise à jour du profil FC (dont il dépend) :
  - **Course uniquement** : c'est là que le repli FC moyenne fausse la charge (fractionnés), et ça divise d'autant le coût en requêtes.
  - **Uniquement les activités où le champ manque**, les plus récentes d'abord, **plafonné à `_ZONE_ENRICH_MAX_PER_SYNC` par synchro**.
  - **Décision sur le rétroactif** : pas de script de backfill one-shot. L'historique se remplit progressivement sur quelques synchros — 90 jours d'un coup, c'est ~90 requêtes en rafale, le meilleur moyen de faire limiter le compte. Comme le CTL est une EMA à 42 jours et qu'on remplit du plus récent vers le plus ancien, la courbe converge au lieu de faire une marche.
  - **Zones Garmin ≠ zones du projet** : `load_service.redistribute_zone_seconds` reventile au prorata du recouvrement des plages de FC. Sans profil FC complet on n'écrit rien (jamais de zones inventées).
  - Le mapping d'activité (`_map_activity`) ne contient pas ce champ : le `$set` d'une resync ne l'écrase donc pas.
  - Script d'exploration du payload réel : `backend/scripts/inspect_activity_zones.py`.

## Mapping vers les modèles du projet

Toute activité Garmin devient un document de la collection `activities`. Il n'y a
**pas** de classe `Activity` : le document est un dict écrit par
`garmin_sync_service._map_activity`, et le modèle Pydantic `ActivityResponse`
(`app/models/activity.py`) n'est que la forme publique renvoyée par l'API — elle
n'expose ni `raw` ni `user_id`. Forme du document stocké :

```python
{
    "garmin_activity_id": int,
    "user_id": str,
    "sport": SportType,          # mapper activityTypeDTO.typeKey -> enum interne
    "start_time": datetime,      # toujours en UTC, timezone d'affichage côté client
    "duration_s": int,
    "distance_m": float | None,
    "avg_hr": int | None,
    "max_hr": int | None,
    "hr_zone_seconds": list[float] | None,  # 5 valeurs Z1..Z5, rempli après coup
    "training_load": float | None,   # calculé par load_service, pas par Garmin
    "raw": dict,                 # payload Garmin brut, pour ne rien perdre
}
```

Mapping des sports : `running`/`treadmill_running` → RUN ; `tennis`/`padel` → PADEL ; `basketball` → BASKETBALL ; `cycling` → BIKE ; `strength_training` → STRENGTH ; tout le reste → OTHER (mais toujours ingéré — voir la règle métier : tout compte dans la charge).

## Envoi d'une séance vers la montre (workouts structurés)

`POST /api/v1/garmin/workout` → `garmin_workout_service`. Il n'existe **aucun
push direct vers le device** : on crée un workout dans la bibliothèque Garmin
Connect (`client.upload_running_workout(RunningWorkout)`, module
`garminconnect.workout`), que la montre récupère à sa prochaine synchro.

### Taxonomie des erreurs — le piège central

`python-garminconnect` 0.3.x fait passer **toute réponse non-2xx par une seule
exception**, `GarminConnectConnectionError`, dont le message a la forme
`"API Error <status> - <message Garmin>"` (`garminconnect/client.py`,
`_run_request`). Le type d'exception ne dit donc rien : session expirée (401),
séance refusée (400) et rate limit (429) arrivent identiques. Relire le statut
dans le message est le seul moyen de distinguer les trois — et c'est
indispensable, parce que la suite diffère pour l'athlète :

| Statut amont | Exception métier | Réponse API | Ce que l'athlète doit faire |
|---|---|---|---|
| 401 / 403 | `GarminAuthExpiredError` | 409 `GARMIN_RELOGIN` | Reconnecter le compte (réessayer ne marchera jamais) |
| 429 | `GarminRateLimitedError` | 429 `GARMIN_RATE_LIMITED` | Attendre |
| autre 4xx | `GarminWorkoutRejectedError` | 502 `GARMIN_WORKOUT_REJECTED` | Rien — c'est notre payload, pas son réseau |
| 5xx, absence de statut | `GarminUpstreamError` | 502 `GARMIN_UPSTREAM_ERROR` | Réessayer plus tard |
| imprévu | `GarminWorkoutFailedError` | 502 `GARMIN_WORKOUT_FAILED` | Rien — tracé côté serveur |

Deux corollaires :

- Les **timeouts et erreurs de transport ne passent pas** par le wrapper de la
  librairie (l'appel se fait avec une `requests.Session` nue) : attraper
  `requests.RequestException` en plus, sinon ça sort en 500 nu.
- `client.loads()` emballe un blob de tokens illisible dans un
  `GarminConnectConnectionError`, **même quand la vraie cause est l'absence de
  tokens**. Un client qu'on n'arrive pas à reconstruire = session morte →
  `needs_relogin`, pas « Garmin ne répond pas ».

Toute erreur d'auth pose `needs_relogin: True` sur `garmin_credentials`, et un
envoi sur une connexion déjà marquée morte échoue immédiatement sans dépenser
une requête Garmin.

## Pièges connus

- **Ne jamais répondre 401 sur une erreur Garmin.** Le client mobile lit
  n'importe quel 401 comme « mon propre token JWT est mort » : il rafraîchit et
  **rejoue la requête**. Sur `/garmin/workout` ça uploade la séance deux fois ;
  sur `/garmin/connect` ça retente le mot de passe Garmin refusé une seconde
  fois, soit le meilleur moyen de déclencher un CAPTCHA ou un blocage de compte.
  Les erreurs côté Garmin sont des conflits métier → **409**.
- Les champs Garmin sont incohérents entre types d'activités (parfois `averageHR`, parfois absent) → tout mapper en `Optional`, jamais de KeyError.
- Les dates Garmin sont en heure locale de la montre ET en GMT selon les champs — utiliser les champs `*GMT` systématiquement.
- Certaines montres ne remontent pas la HRV → le moteur d'adaptation doit fonctionner en mode dégradé sans HRV.
- Ne jamais exposer le payload `raw` dans les réponses API publiques.
