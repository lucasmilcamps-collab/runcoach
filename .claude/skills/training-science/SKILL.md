---
name: training-science
description: Science de l'entraînement du projet — zones cardiaques, charge d'entraînement (TRIMP/TSS, CTL/ATL/TSB), périodisation, allures cibles, et intégration du cross-training (padel, basket, vélo, renfo) dans la charge. Consulter ce skill pour TOUT calcul physiologique ou de charge, toute logique de plan, d'allure, de zone, de fatigue, de forme ou de récupération — même si le terme exact n'apparaît pas dans la demande (ex. "calcule ma forme", "pourquoi la semaine 4 est légère").
---

# Training Science

Toutes les formules de ce fichier sont LA référence du projet. Le code de `load_service` et `plan_service` doit les implémenter exactement, avec tests sur valeurs de référence.

## Zones cardiaques (Karvonen — jamais 220−âge)

FC de réserve : `HRR = HRmax − HRrest` (les deux issues de Garmin, mises à jour à chaque sync).
Zone n : `HRrest + pct × HRR`.

| Zone | % HRR | Usage |
|---|---|---|
| Z1 | 50–60 % | Récupération |
| Z2 | 60–70 % | Endurance fondamentale (≈80 % du volume course) |
| Z3 | 70–80 % | Tempo |
| Z4 | 80–90 % | Seuil |
| Z5 | 90–100 % | VMA / intervalles |

Répartition polarisée par défaut : ~80 % du temps course en Z1–Z2, ~20 % en Z3+.

## Charge d'une séance — TRIMP d'Edwards

Pour être **sport-agnostique** (indispensable pour le cross-training), on utilise le TRIMP d'Edwards basé sur le temps passé par zone FC :

```
TRIMP = 1×t(Z1) + 2×t(Z2) + 3×t(Z3) + 4×t(Z4) + 5×t(Z5)   (t en minutes)
```

- Si les données FC détaillées manquent : fallback `TRIMP ≈ durée_min × facteur_zone_moyenne` estimé depuis la FC moyenne.
- Si pas de FC du tout (séance déclarée manuellement) : RPE de l'utilisateur (1–10) × durée_min / 10 (session-RPE de Foster).
- Le TRIMP calculé est stocké dans `Activity.training_load`. **Jamais** utiliser le "Training Load" propriétaire Garmin dans les calculs (non reproductible) ; on peut l'afficher à titre indicatif.

## Forme et fatigue — CTL / ATL / TSB

Moyennes exponentielles de la charge quotidienne (somme des TRIMP du jour) :

```
CTL_today = CTL_yesterday + (load_today − CTL_yesterday) / 42   # fitness, 42 j
ATL_today = ATL_yesterday + (load_today − ATL_yesterday) / 7    # fatigue, 7 j
TSB = CTL_yesterday − ATL_yesterday                             # forme
```

- Amorçage : 90 jours d'historique Garmin ; si moins, initialiser CTL/ATL à la moyenne des charges disponibles et flaguer `low_confidence`.
- Interprétation : TSB < −25 → fatigue élevée, alléger ; TSB entre −10 et +5 → zone d'entraînement productive ; TSB > +15 → frais (visé le jour de course).
- **Rampe** : CTL ne doit pas croître de plus de ~10 %/semaine (règle métier du CLAUDE.md).

## Cross-training : comment les autres sports comptent

Principe : **toute charge compte dans ATL/CTL** (c'est du stress physiologique), mais **seule la course développe la spécificité course**.

- Fatigue : TRIMP du padel/basket/vélo intégré tel quel dans la charge quotidienne.
- Spécificité : suivre séparément `run_load` (TRIMP des séances course uniquement) pour vérifier que le volume spécifique course progresse.
- Placement : jamais de séance course qualitative (Z4/Z5) le lendemain d'un sport intense à impacts (basket, padel). Exemple concret : basket le mercredi → l'intervalle de la semaine va mardi ou vendredi, pas jeudi.
- Les sports fixes déclarés par l'utilisateur (ex. "basket tous les mercredis") sont des **contraintes dures** du générateur de plan : le plan est construit autour, il ne les déplace jamais.

## Périodisation d'un plan course

Structure standard (adapter la durée totale à la date de course) :

1. **Base** (30–40 % du plan) : volume Z2, une séance de qualité légère/sem.
2. **Build** (30–40 %) : introduction seuil puis VMA, 2 séances de qualité/sem max.
3. **Peak** (2–3 sem) : intensité spécifique à l'allure objectif, volume maintenu.
4. **Taper** (1–2 sem) : volume −40 à −60 %, intensité maintenue, TSB remonte vers +10/+15 le jour J.

- **Deload obligatoire** toutes les 3–4 semaines : volume −30 à −40 %.
- Sortie longue hebdomadaire : progression max +10–15 min/sem, plafonnée à ~2h (semi) / 2h45 (marathon).
- 3 séances course/sem est le minimum viable pour un objectif chrono ; compléter par le cross-training existant plutôt que d'ajouter de la course.

## Allures cibles

À partir d'un chrono récent ou objectif, via l'équivalence de Riegel (`T2 = T1 × (D2/D1)^1.06`) puis dérivation des allures d'entraînement (style VDOT) :

- Easy/long run : allure course +45 s à +75 s/km
- Tempo (Z3/Z4 bas) : allure semi à +10 s/km
- Seuil : ≈ allure 10 km à +5–8 s/km
- Intervalles VMA : ≈ allure 3–5 km

Toujours donner une **fourchette** d'allure, pas une valeur unique, et croiser avec les zones FC (si conflit allure/FC sur route vallonnée → la FC prime en Z1–Z2, l'allure prime en séance qualité sur plat).

## Signaux de récupération (pour l'adaptation dynamique)

Entrées quotidiennes : HRV (vs baseline 30 j), FC repos (vs baseline), score de sommeil, Body Battery matin, TSB.

Règles simples et transparentes (pas de ML au départ) :
- HRV < baseline −10 % ET FC repos > baseline +5 bpm → dégrader la séance du jour d'un cran (qualité → Z2, Z2 → repos).
- 2 nuits < 6 h consécutives → pas de séance Z4/Z5 le jour même.
- Séance manquée : ne jamais la "rattraper" en l'empilant ; recalculer la semaine en préservant la séance clé (long run ou qualité principale).
- Toute dégradation est **expliquée à l'utilisateur** (transparence = confiance).
