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

- Implémentation : `load_service.edwards_trimp(zone_seconds)` calcule la vraie somme par zone quand le champ `hr_zone_seconds` de l'activité est présent (5 valeurs Z1..Z5). `compute_trimp(..., zone_seconds=...)` la préfère automatiquement (une séance 6×800 m qui moyenne en Z3 mais passe 20 min en Z5 est comptée sur le Z5, plus sous-estimée).
- **Pourquoi c'est la forme juste, et pas un raffinement** : le repli FC moyenne sous-estime *systématiquement* les séances de qualité — exactement celles qui fatiguent le plus. Un CTL/ATL construit dessus rend l'athlète plus chargé qu'il ne paraît, dans une app dont l'argument est la sécurité. Le temps par zone est donc rempli à la synchro pour les activités `RUN` (`garmin_sync_service.enrich_run_zone_seconds`), depuis l'endpoint Garmin dédié.
- Les bornes de zones de Garmin ne sont pas les nôtres (Karvonen sur FC réelles). `load_service.redistribute_zone_seconds` reventile donc le temps des zones Garmin sur nos 5 zones au prorata du recouvrement des plages de FC, plutôt que de mapper Z_garmin_n → Z_projet_n. Sans profil FC complet, on ne mappe rien : on garde le repli FC moyenne (jamais de zones inventées).
- Si les données par zone manquent : fallback `TRIMP ≈ durée_min × facteur_zone_moyenne` estimé depuis la FC moyenne.
- Si pas de FC du tout (séance déclarée manuellement) : RPE de l'utilisateur (1–10) × durée_min / 10 (session-RPE de Foster).
- Le TRIMP calculé est stocké dans le champ `training_load` du document activité (il n'existe pas de classe `Activity` — voir garmin-sync). **Jamais** utiliser le "Training Load" propriétaire Garmin dans les calculs (non reproductible) ; on peut l'afficher à titre indicatif.

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
- Spécificité : suivre séparément la charge issue des seules séances de course, pour vérifier que le volume spécifique progresse. **Pas encore implémenté** — `compute_fitness` agrège toutes les activités sans distinguer la part course ; le prompt reçoit à la place le volume course (`weekly_run_minutes_8w`, `recent_run_sessions_8w`).
- Placement : jamais de séance course qualitative (Z4/Z5) le lendemain d'un sport intense à impacts (basket, padel). Exemple concret : basket le mercredi → l'intervalle de la semaine va mardi ou vendredi, pas jeudi.
- Les sports fixes déclarés par l'utilisateur (ex. "basket tous les mercredis") sont des **contraintes dures** du générateur de plan : le plan est construit autour, il ne les déplace jamais.
- **Adhérence (Lot 6.2)** : une séance CLÉ de course n'est comptée « réalisée » que par une activité `RUN` de durée ≥ 60 % du prévu — une partie de padel le même jour ne valide pas la sortie longue. Un lien explicite (activité liée à la séance) compte toujours, à condition de porter sur le même `slot` : un lien sur le renfo `addon` du mardi ne valide pas le run `primary` du mardi.
- **Charge ≠ adhérence — limite assumée.** Valider une séance d'un autre sport n'a **aucun** effet sur l'adhérence : `_is_key_run` ne retient que `sport == RUN`. Ce n'est pas un oubli. Les deux mesures répondent à deux questions distinctes : la **charge** (CTL/ATL) demande « qu'est-ce que mon corps a encaissé ? » — et là tout compte, le padel comme le basket ; l'**adhérence** demande « est-ce que je construis ma capacité spécifique course ? » — et seule la course la construit. Un mois de padel intensif fait donc monter le CTL sans faire monter l'adhérence, et c'est exactement le signal voulu : la forme générale progresse, la préparation course non. L'effet du cross-training sur le plan passe par le TSB (l'activité est déjà synchronisée), jamais par le compteur de séances clés.
- **Séance sautée (`skipped`)** : l'athlète peut déclarer qu'il ne fera pas une séance. Sur une optionnelle c'est gratuit — c'est la raison d'être de l'optionnel. Sur une clé, la séance est comptée manquée **immédiatement**, sans attendre que le jour passe, et alimente donc le déclencheur de replanification. Réversible, et la séance reste visible dans le plan : masquer la décision reviendrait à masquer l'information. Un skip **suggère** une replanification, il n'en déclenche jamais une.
- **Renfo Freeletics (Lot 6.3)** : ne se synchronise pas avec Garmin → charge invisible. Après un renfo planifié non retrouvé dans les activités (la veille), une notification propose de le logger en 2 taps (RPE) ; alternative sans friction : lancer une activité « Musculation » sur la montre pendant la séance (Garmin la remonte avec la FC).

## Périodisation d'un plan course

Structure standard (adapter la durée totale à la date de course) :

1. **Base** (30–40 % du plan) : volume Z2, une séance de qualité légère/sem.
2. **Build** (30–40 %) : introduction seuil puis VMA, 2 séances de qualité/sem max.
3. **Peak** (2–3 sem) : intensité spécifique à l'allure objectif, volume maintenu.
4. **Taper** (1–2 sem) : volume −40 à −60 %, intensité maintenue, TSB remonte vers +10/+15 le jour J.

- **Deload obligatoire** toutes les 3–4 semaines (`MAX_CONSECUTIVE_NORMAL_WEEKS`, ≥ 1 deload par bloc de 4). L'adaptation se produit pendant la baisse de charge, pas pendant la charge : une semaine « allégée » qui ne baisse pas est une semaine normale déguisée, et le cycle ne rend rien. D'où le plafond dur `DELOAD_MAX_RATIO = 0.85` — au plus 85 % de la dernière semaine **normale** (pas de la précédente, qui peut déjà être un deload). Viser −30 à −40 % de volume ; 85 % est la limite au-delà de laquelle le validateur refuse, pas la cible.
- **Ancrage de la semaine 1 sur la charge réelle** (`INITIAL_RAMP_MAX_RATIO`, même ratio que la rampe interne) : le saut le plus dangereux d'un plan n'est pas entre ses semaines mais entre la charge réellement portée par l'athlète les 4 dernières semaines et la semaine 1. C'est un **plafond seulement** — démarrer sous sa charge réelle est légitime (retour de blessure). Sans historique fiable, aucun ancrage n'est appliqué.
- Sortie longue hebdomadaire : progression max +10–15 min/sem (`LONG_RUN_WEEKLY_STEP_MAX_MIN`), plafonnée à ~2h (semi) / 2h45 (marathon) — le risque tendineux d'une sortie longue croît avec la durée passée sur les jambes, pas avec la distance.
- **Séances clés vs optionnelles** (`_check_session_counts`) : sur une semaine normale, **exactement** `min_run_sessions_per_week` séances de course sont marquées `key`, et le total ne dépasse jamais `max_run_sessions_per_week`. Les semaines de deload sont exemptées du plancher de clés. Défaut : 2 clés pour 3 séances possibles — l'engagement porte sur ce qui tient dans une mauvaise semaine, le reste est du bonus. À min = max, tout devient clé et l'athlète n'a plus rien à sacrifier quand la semaine dérape : c'est la configuration à éviter.
- **Placement du renfo — *hard days hard*** (`_check_strength_placement`) : jamais de renforcement la veille d'une sortie longue ou d'une séance de qualité, et ≥ 48 h entre deux renfos. Concentrer le stress sur les jours durs et protéger les jours faciles ; un renfo la veille arrive sur des jambes déjà entamées et dégrade la séance clé sans apporter d'adaptation. Le même jour qu'une séance dure est en revanche autorisé (c'est le principe).

## Estimation de chrono et plafond de progression

`performance_service` (module pur, testé sur valeurs de référence) :

- **Riegel** `T2 = T1 × (D2/D1)^1.06` (`RIEGEL_EXPONENT`) : extrapole une performance récente vers la distance objectif. L'exposant traduit le fait qu'on ralentit quand la distance monte ; il dérive de données de course, pas d'un modèle physiologique — d'où sa dérive quand le rapport des distances devient grand.
- **`confidence`** en conséquence : une performance récente et proche en distance donne `high`, une vieille ou très éloignée donne `low`. Un chrono estimé n'est jamais présenté comme une mesure.
- **Chrono projeté** : la progression est adossée au gain de CTL projeté, avec seulement une fraction du gain relatif converti en gain de temps (`_CTL_TO_TIME_GAIN`) et un plafond absolu (`_MAX_PROJECTED_IMPROVEMENT`). L'endurance progresse lentement ; une projection optimiste produit des allures prescrites trop rapides, donc des séances ratées.
- **Plafond de progression réaliste** (`_IMPROVEMENT_PER_WEEK`, `_MAX_REALISTIC_IMPROVEMENT`) : au-delà, `feasibility_warning` prévient que l'objectif est ambitieux. **Un avertissement, jamais un blocage** — l'objectif reste celui de l'athlète.
- **Garde-fou sur la performance source** (`is_source_pace_implausible`) : Riegel extrapole ce qu'on lui donne. Une course mal mesurée (GPS erratique, sortie interrompue, point-à-point en descente) devient un « chrono actuel » rapide qui contamine ensuite les allures prescrites **et** l'avertissement de faisabilité. Faute de recoupement VO2max, la référence est l'athlète lui-même : une allure source nettement plus rapide que la médiane de ses courses récentes dégrade la `confidence` d'un cran (`downgrade_confidence`). L'estimation est conservée — la retirer laisserait le plan sans ancrage du tout.
- Daniels VDOT (`daniels_vdot`) est disponible comme base d'allures ; le recoupement VO2max n'existe pas encore (donnée Garmin non stockée) — c'est la piste moyen terme, une fois la VO2max Garmin persistée.

## Allures cibles

À partir du chrono estimé ci-dessus, dérivation des allures d'entraînement (style VDOT) :

- Easy/long run : allure course +45 s à +75 s/km
- Tempo (Z3/Z4 bas) : allure semi à +10 s/km
- Seuil : ≈ allure 10 km à +5–8 s/km
- Intervalles VMA : ≈ allure 3–5 km

Toujours donner une **fourchette** d'allure, pas une valeur unique, et croiser avec les zones FC (si conflit allure/FC sur route vallonnée → la FC prime en Z1–Z2, l'allure prime en séance qualité sur plat).

**Cette règle d'arbitrage est implémentée** dans `weekly_review_service._governing_signal`, qui étiquette chaque séance passée en revue `signal: "hr"` ou `"pace"` — et transmet l'étiquette au générateur de plan (`semaine_ecoulee`) pour qu'il ne lise pas une côte comme une allure ratée. Les types Z1–Z2 (`easy`, `long_run`, `recovery`) sont toujours jugés sur la FC ; les types qualité le sont sur l'allure **tant que le terrain est plat**. Le seuil de « plat » (`_HILLY_M_PER_KM`, 10 m/km) est le seul nombre du module que ce skill ne fixe pas : c'est un critère descriptif — « peut-on encore se fier à l'allure ici ? » — pas une constante physiologique.

## Signaux de récupération (pour l'adaptation dynamique)

Entrées quotidiennes : HRV (vs baseline 30 j), FC repos (vs baseline), score de sommeil, Body Battery matin, TSB.

Règles simples et transparentes (pas de ML au départ) :
- HRV < baseline −10 % ET FC repos > baseline +5 bpm → dégrader la séance du jour d'un cran (qualité → Z2, Z2 → repos).
- 2 nuits < 6 h consécutives → pas de séance Z4/Z5 le jour même.
- Séance manquée : ne jamais la "rattraper" en l'empilant ; recalculer la semaine en préservant la séance clé (long run ou qualité principale).
- Toute dégradation est **expliquée à l'utilisateur** (transparence = confiance).

### Bilan de fin de semaine (`weekly_review_service`)

Le pendant hebdomadaire de l'ajustement quotidien ci-dessus. Le verdict « faut-il réajuster le plan ? » est **déterministe et gratuit** — aucun appel modèle — et n'utilise que des seuils déjà documentés ici, en réutilisant les constantes existantes plutôt que d'en créer des variantes :

- ≥ 2 séances clés manquées sur la semaine (`_MISSED_KEY_TRIGGER`, partagé avec `plan_progress`) ;
- TSB < −25 (`_CHRONIC_FATIGUE_TSB`) ;
- CTL en hausse de plus de ~10 % sur la semaine (règle métier du CLAUDE.md, `_MAX_CTL_RAMP_PCT`).

La dérive cardiaque et l'écart d'allure sont **mesurés et transmis** (ils viennent des splits par tour), mais ne déclenchent rien : ce skill ne leur fixe pas de seuil, et en inventer un ferait passer une intuition pour de la science. Ils servent à expliquer, pas à décider.

L'IA n'intervient qu'une fois le verdict déjà positif, et uniquement pour rédiger l'explication et la recommandation. Comme `replan_suggested`, le bilan **propose** — il ne régénère jamais un plan de lui-même.
