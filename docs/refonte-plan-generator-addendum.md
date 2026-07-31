# Addendum à la refonte — lot 7 : finitions

> **À placer dans le repo à** `docs/refonte-plan-generator-addendum.md`
> **Prérequis** : lots 0 à 6 de `docs/refonte-plan-generator.md`, tous mergés.
> **Version du code auditée** : `master` au 30/07/2026, 199 tests.

---

## Contexte

Les 7 lots de la refonte sont passés, et plusieurs choix d'implémentation sont
meilleurs que ce que la spec proposait — notamment la flexibilité des sports fixes
gérée **par jour** plutôt que par sport, et `session_order_key` porté sur le modèle
Pydantic (les plans déjà stockés en Mongo bénéficient de l'ordre normalisé sans
migration).

Cet addendum couvre quatre points résiduels relevés à l'audit. Le premier est le
seul qui soit bloquant sur le fond : une fonctionnalité entièrement écrite et testée
qui ne s'exécute jamais.

**Ordre suggéré** : 7.1 d'abord (c'est le seul qui change les résultats produits),
puis 7.2 et 7.3 qui sont rapides, puis 7.4.

---

## 7.1 — Le TRIMP par zone n'est jamais alimenté (prioritaire)

### Constat

Le lot 6.1 a été fait à moitié. Le calcul est correct et testé :

- `load_service.edwards_trimp(zone_seconds)` implémente le vrai TRIMP d'Edwards.
- `load_service.compute_trimp(...)` accepte `zone_seconds` et retombe proprement sur
  la FC moyenne en son absence.
- `fitness_service.py:77` lit bien `zone_seconds=doc.get("hr_zone_seconds")`.

Mais **aucun code n'écrit `hr_zone_seconds`**. Un `grep -rn "hr_zone_seconds" backend/`
ne renvoie que la ligne de lecture. `garmin_sync_service._map_activity` (L72) ne
récupère que `averageHR` et `maxHR` :

```python
"avg_hr": raw.get("averageHR"),
"max_hr": raw.get("maxHR"),
```

Conséquence : **100 % des activités passent par le repli FC moyenne**. Le biais que le
lot 6 devait corriger — la sous-estimation systématique des séances de qualité, une
séance 6×800 m qui moyenne en Z3 comptée au facteur 3 alors qu'elle a passé 20 min en
Z5 — est toujours intégralement présent. Et il va dans le mauvais sens pour une
application dont l'argument est la sécurité : le CTL/ATL sous-estime précisément les
séances les plus fatigantes, donc l'ancrage de charge du lot 2 et l'ajustement
quotidien de `plan_adaptation` travaillent sur une image faussée.

### Travail attendu

1. **Vérifier la disponibilité de la donnée.** Le temps par zone n'est en général
   **pas** dans la réponse de liste d'activités : il faut le détail d'activité
   (`garminconnect` expose un appel dédié au temps en zone / aux détails d'activité).
   Écrire un script jetable dans `backend/scripts/` pour inspecter la réponse réelle
   sur un compte de test avant de coder quoi que ce soit — la forme exacte du payload
   varie selon le type d'activité et le modèle de montre.

2. **Décider du coût de synchronisation.** Un appel supplémentaire par activité
   change le profil de la synchro. `_fetch_activities_sync` pagine déjà avec des
   pauses pour rester sous la limite informelle de Garmin. Options, par ordre de
   préférence :
   - ne récupérer le détail que pour les activités `RUN` (les seules où le biais
     compte vraiment) ;
   - ne le faire que pour les activités des N derniers jours à la première synchro,
     puis systématiquement en incrémental ;
   - le faire dans un second temps, en tâche de fond via `job_service`, pour ne pas
     allonger la synchro interactive.

   Documenter le choix retenu en commentaire — c'est un arbitrage, pas une évidence.

3. **Normaliser en 5 valeurs Z1..Z5.** Garmin renvoie ses propres bornes de zones,
   qui ne correspondent pas forcément aux zones Karvonen du projet. Deux approches :
   - mapper les zones Garmin sur les nôtres (rapide, approximatif) ;
   - stocker le brut et recalculer nos zones à partir du profil FC réel de
     l'utilisateur (juste, plus de travail).

   La seconde est cohérente avec la règle métier « jamais 220 − âge, toujours les
   FC max/repos réelles ». Si la première est retenue pour aller vite, l'écrire
   explicitement comme une dette.

4. **Stocker sous `hr_zone_seconds`** dans le document activité — le champ que
   `fitness_service` lit déjà. Aucun changement côté lecture.

5. **Recalcul rétroactif.** Les activités déjà en base n'ont pas le champ. Prévoir un
   script `backend/scripts/backfill_hr_zones.py` idempotent, ou accepter que seules
   les nouvelles activités en bénéficient — mais alors le CTL sera discontinu au
   moment du basculement, ce qui se verra dans les courbes. Trancher explicitement.

### Tests

- `test_map_activity_stores_hr_zone_seconds` — le mappage écrit bien 5 valeurs.
- `test_compute_trimp_prefers_zone_seconds` — existe probablement déjà côté
  `load_service` ; vérifier qu'un test d'intégration couvre la chaîne
  synchro → stockage → `fitness_service`.
- Un test à valeurs de référence : même séance calculée par les deux voies, l'écart
  attendu sur une séance d'intervalles doit être significatif (c'est tout l'intérêt).

### Critère d'acceptation

- [ ] Après une synchro, au moins une activité de course en base porte
      `hr_zone_seconds` avec 5 valeurs dont la somme ≈ la durée.
- [ ] Le TRIMP d'une séance d'intervalles est nettement supérieur à celui calculé par
      la FC moyenne, et la différence est vérifiée par un test.
- [ ] La décision sur le rétroactif est écrite dans le code ou dans `docs/`.

---

## 7.2 — La deadline globale ne borne rien, et le skill la documente faussement

### Constat

Dans `backend/app/services/plan_service.py` :

```python
_ANTHROPIC_TIMEOUT_S = 160.0
_TOTAL_DEADLINE_S = 160.0
```

Les deux valeurs sont **égales**. Une seule tentative peut donc consommer la totalité
du budget, et un retry n'a lieu que si la première passe a été sensiblement plus
rapide que son propre timeout. Le garde-fou du lot 0.6 existe mais ne contraint rien
dans le cas qu'il visait.

Par ailleurs `.claude/skills/plan-generator/SKILL.md:50` annonce « deadline globale
90 s » alors que le code dit 160. C'est une **nouvelle dérive documentaire, créée par
le lot qui devait supprimer les dérives documentaires** — et dans un skill, ce qui est
pire qu'ailleurs : c'est le fichier que les sessions Claude Code suivantes liront comme
source de vérité.

### Travail attendu

Trancher entre deux stratégies, et rendre le code et le skill cohérents dans les deux
cas :

**Option A — rester synchrone (changement minimal).**
Poser `_ANTHROPIC_TIMEOUT_S = 60.0` et `_TOTAL_DEADLINE_S = 150.0`, de sorte que le
budget autorise réellement deux à trois tentatives. Vérifier que 150 s reste sous le
timeout HTTP de la plateforme d'hébergement — sinon le client prend un 502 pendant que
le backend continue de consommer des tokens pour un plan que personne ne recevra.

**Option B — passer la génération en job (recommandé à terme).**
`job_service.py` et `api/jobs.py` existent déjà. La génération devient un job, le
frontend interroge son statut, et toute la contrainte de timeout HTTP disparaît. C'est
plus de travail côté mobile (état de chargement persistant, reprise si l'app est mise
en arrière-plan), mais c'est la seule façon de laisser les 3 tentatives se dérouler
sereinement. La docstring de `generate_plan` justifie le choix synchrone par le risque
qu'un `background task` soit tué sur un hébergement mono-instance gratuit — un job
persisté en base ne souffre pas de ce problème, contrairement à une `BackgroundTask`
en mémoire.

Quelle que soit l'option, **mettre `SKILL.md:50` à jour avec les valeurs réelles**, et
ajouter un test qui échoue si les constantes et le skill divergent, ou à défaut une
note dans la Definition of Done.

### Critère d'acceptation

- [ ] `_TOTAL_DEADLINE_S > _ANTHROPIC_TIMEOUT_S`, avec un commentaire expliquant le
      rapport entre les deux.
- [ ] `.claude/skills/plan-generator/SKILL.md` annonce les valeurs effectivement
      présentes dans `config.py` / `plan_service.py`.
- [ ] Test : une première tentative lente laisse quand même la place à une seconde.

---

## 7.3 — `training-science/SKILL.md` n'a pas suivi la refonte

### Constat

Les nouvelles règles ont été documentées dans `plan-generator/SKILL.md` (une dizaine
de mentions des nouveaux concepts) mais quasiment pas dans `training-science/SKILL.md`
(une seule). Or ce sont des règles d'**entraînement**, pas d'architecture :

| Règle | Où elle vit dans le code | Documentée dans training-science ? |
|---|---|---|
| Deload ≤ 85 % de la dernière semaine normale | `DELOAD_MAX_RATIO` | non |
| Ancrage de la semaine 1 sur la charge réelle | `INITIAL_RAMP_MAX_RATIO` | non |
| Placement du renfo (*hard days hard*), 48 h d'écart | `_check_strength_placement` | non |
| Séances clés vs optionnelles, min/max hebdo | `_check_session_counts` | non |
| TRIMP d'Edwards par temps en zone | `edwards_trimp` | non |
| Estimation Riegel, plafond de progression réaliste | `performance_service` | non |

`training-science` est le skill que Claude Code consultera pour toute question de
physiologie ou de périodisation. S'il décrit l'état d'avant la refonte, il induira en
erreur à chaque session — et le risque est celui d'une régression silencieuse : un
futur changement « corrigera » le code pour le remettre en conformité avec un skill
périmé.

### Travail attendu

Reprendre `training-science/SKILL.md` pour y intégrer les six lignes du tableau, avec
pour chacune : la règle, sa justification physiologique en une phrase, et la constante
ou la fonction qui l'implémente. Garder le format existant du skill.

Point de vigilance : `plan-generator` et `training-science` ne doivent pas se
contredire. `plan-generator` décrit **le pipeline** (qui appelle quoi, dans quel
ordre, avec quel schéma) ; `training-science` décrit **le pourquoi** (la règle et sa
raison d'être). Si une valeur numérique doit apparaître dans les deux, la citer une
seule fois — dans `training-science` — et y renvoyer depuis l'autre.

### Critère d'acceptation

- [ ] Les six règles du tableau figurent dans `training-science/SKILL.md`.
- [ ] Aucune valeur numérique n'est dupliquée entre les deux skills.

---

## 7.4 — Les valeurs par défaut annulent la fonctionnalité « séance clé »

### Constat

Dans `backend/app/models/plan.py` :

```python
min_run_sessions_per_week: int = 3
max_run_sessions_per_week: int = 3
```

Et côté UI, `mobile/src/app/plan-setup.tsx:100-101` reprend ces mêmes défauts.

Or `_check_session_counts` exige **exactement** `min_run_sessions_per_week` séances
marquées `key` sur les semaines normales. Avec 3/3, les trois séances de course sont
donc clés, et il n'existe aucune séance `optional` — ce qui annule précisément le
besoin à l'origine de la fonctionnalité : savoir laquelle sauter une semaine chargée.

Ce n'est pas un bug du validateur : la règle est juste. C'est un défaut mal choisi,
qui fait que la feature ne se manifeste jamais tant que l'utilisateur ne modifie pas
les curseurs — et rien dans l'écran ne lui indique que c'est là que ça se joue.

### Travail attendu

1. Changer le défaut en `min_run_sessions_per_week = 2`, `max_run_sessions_per_week = 3` :
   deux séances non négociables, une troisième bonus. C'est le cas d'usage réel.
2. Dans `plan-setup.tsx`, rendre la distinction lisible plutôt que de présenter deux
   curseurs numériques quasi identiques. Formulation suggérée :
   *« Je m'engage sur ___ séances par semaine, et je peux en faire jusqu'à ___ si la
   semaine le permet. »*
3. Empêcher `min > max` côté UI (contrainte sur les curseurs) **et** côté modèle
   (`@model_validator` sur `PlanRequest`) — aujourd'hui rien ne l'interdit, et une
   requête incohérente produirait un plan invalide à chaque tentative jusqu'à
   l'échec après 3 essais, sans message compréhensible.
4. Afficher la distinction dans `plan-view.tsx` : les séances `optional` doivent être
   visuellement distinctes des `key`, sinon le champ ne sert à rien à l'usage.

### Critère d'acceptation

- [ ] Un plan généré avec les défauts contient au moins une séance `optional` par
      semaine normale.
- [ ] `min > max` est refusé avec un message clair, avant l'appel au modèle.
- [ ] Les séances optionnelles sont identifiables d'un coup d'œil dans le plan.

---

## 7.5 — Point mineur : le recoupement VDOT annoncé n'existe pas

La docstring de `performance_service.py` le dit honnêtement :

> *Garmin VO2max isn't stored, so there's no VO2max cross-check yet.*

Riegel fonctionne seul, mais sans garde-fou : si la performance source est atypique
(sortie longue en négatif, course interrompue, GPS erratique), l'estimation part de
travers et alimente ensuite les allures prescrites **et** l'avertissement de
faisabilité.

Deux pistes, par ordre de coût croissant :

- **Court terme** : filtrer les performances sources aberrantes — écarter celles dont
  l'allure s'écarte trop de la médiane des courses récentes, et faire remonter cette
  situation par la `confidence` déjà présente dans `TimeEstimate`.
- **Moyen terme** : stocker la VO2max Garmin (elle est disponible dans les données
  utilisateur) et l'utiliser en recoupement via les tables VDOT, comme prévu
  initialement au lot 4.

Non bloquant — à traiter quand 7.1 sera fait, puisque les deux touchent à
l'enrichissement des données Garmin et peuvent partager le même travail
d'exploration de l'API.

---

## Definition of done du lot 7

- `uv run pytest` vert.
- `uv run ruff check && uv run ruff format --check` propres.
- `npx tsc --noEmit` propre sur `mobile/`.
- Aucune valeur numérique divergente entre `config.py` / `plan_service.py` et les deux
  skills.
- `grep -rn "hr_zone_seconds" backend/` renvoie au moins une écriture, pas seulement
  une lecture.
