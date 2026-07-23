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

## Mapping vers les modèles du projet

Toute activité Garmin devient un document `Activity` :

```python
class Activity(BaseModel):
    garmin_activity_id: int
    user_id: str
    sport: SportType          # mapper activityTypeDTO.typeKey -> enum interne
    start_time: datetime      # toujours en UTC, timezone d'affichage côté client
    duration_s: int
    distance_m: float | None
    avg_hr: int | None
    max_hr: int | None
    training_load: float | None   # calculé par load_service, pas par Garmin
    raw: dict                 # payload Garmin brut, pour ne rien perdre
```

Mapping des sports : `running`/`treadmill_running` → RUN ; `tennis`/`padel` → PADEL ; `basketball` → BASKETBALL ; `cycling` → BIKE ; `strength_training` → STRENGTH ; tout le reste → OTHER (mais toujours ingéré — voir la règle métier : tout compte dans la charge).

## Pièges connus

- Les champs Garmin sont incohérents entre types d'activités (parfois `averageHR`, parfois absent) → tout mapper en `Optional`, jamais de KeyError.
- Les dates Garmin sont en heure locale de la montre ET en GMT selon les champs — utiliser les champs `*GMT` systématiquement.
- Certaines montres ne remontent pas la HRV → le moteur d'adaptation doit fonctionner en mode dégradé sans HRV.
- Ne jamais exposer le payload `raw` dans les réponses API publiques.
