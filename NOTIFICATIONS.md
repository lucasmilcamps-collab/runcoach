# Notifications push (Web Push / PWA)

Notifications matinales (séance du jour + alerte « plan à réajuster ») envoyées
au navigateur et à la **PWA installée** (iPhone : iOS 16.4+, app ajoutée à
l'écran d'accueil). Aucune app native requise.

## 1. Générer les clés VAPID (une fois)

```bash
cd backend
python scripts/gen_vapid.py
```

Copie la valeur `VAPID_PRIVATE_KEY` affichée. La clé publique
(applicationServerKey) est **dérivée** de la privée au runtime — rien d'autre à
stocker.

## 2. Variables d'environnement du backend (Render)

| Variable | Valeur |
|---|---|
| `VAPID_PRIVATE_KEY` | la clé privée générée (secrète) |
| `VAPID_SUBJECT` | `mailto:ton-email@exemple.com` |
| `PUSH_RUN_SECRET` | une longue chaîne aléatoire (secrète) — protège `/push/run` |

Sans `VAPID_PRIVATE_KEY`, l'endpoint `/push/public-key` renvoie `null` et la
carte Notifications reste inactive : la fonctionnalité est simplement désactivée,
rien ne casse.

## 3. Planificateur (GitHub Actions)

Le workflow [`.github/workflows/push-cron.yml`](.github/workflows/push-cron.yml)
appelle `/push/run` chaque matin (07:00 UTC ≈ 8-9h Paris). Dans **Settings → Secrets and
variables → Actions**, ajoute :

| Secret | Valeur |
|---|---|
| `BACKEND_URL` | l'URL du backend, ex. `https://runcoach-api.onrender.com` |
| `PUSH_RUN_SECRET` | la **même** valeur que côté backend |

Pour tester tout de suite : onglet **Actions → Daily push notifications → Run
workflow**.

## 4. Côté utilisateur

1. Ouvre la PWA (installée sur l'écran d'accueil sur iPhone).
2. Dashboard → carte **Notifications** → **Activer les notifications** → autoriser.
3. **M'envoyer un test** vérifie la chaîne de bout en bout.

## Notes

- iPhone : le web push ne marche **que** sur la PWA installée (pas dans Safari).
- Les abonnements périmés (410/404) sont purgés automatiquement à l'envoi.
- Le contenu santé n'est jamais loggé (règle de sécurité du projet).
