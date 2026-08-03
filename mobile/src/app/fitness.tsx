import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { DetailScreen } from '@/components/detail-screen';
import { FitnessCard } from '@/components/fitness-card';
import { RecoveryStats } from '@/components/recovery-stats';
import { StatTiles } from '@/components/stat-tiles';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getFitness } from '@/lib/api/fitness';
import { getTodaySession } from '@/lib/api/plans';
import { formBand, signed } from '@/lib/fitness-format';
import { qk } from '@/lib/query-keys';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The figures behind the ledger's one-line form read-out.
 *
 * Accueil answers *how heavy was the week*; this answers *how much, and made of
 * what* — the verdict, then the three numbers it is computed from, then the
 * 90-day curve. It exists so Accueil can stay at three blocks: the trend card
 * used to sit there as a fourth, competing for the same glance with something
 * nobody needs daily.
 */
export default function FitnessScreen() {
  const styles = useStyles();
  const fitnessQuery = useQuery({ queryKey: qk.fitness(), queryFn: getFitness });
  // Shares Accueil's cache — the same read, no extra request.
  const todayQuery = useQuery({ queryKey: qk.planToday(), queryFn: getTodaySession });
  const fitness = fitnessQuery.data;
  const hasForm = !!fitness?.has_profile && (fitness?.series.length ?? 0) > 0;
  const band = hasForm ? formBand(fitness!.tsb) : null;

  return (
    <DetailScreen
      kicker="Charge"
      title="Forme et fatigue"
      blurb="Ce que ton corps a encaissé, et ce qu’il te reste sous le pied.">
      {band ? (
        <View style={styles.verdict}>
          <ThemedText type="subtitle" themeColor={band.color}>
            {band.verdict}
          </ThemedText>
          <StatTiles
            stats={[
              {
                label: 'Forme',
                value: signed(fitness!.tsb),
                hint: band.word,
              },
              {
                label: 'Caisse de fond',
                value: String(Math.round(fitness!.ctl)),
                hint: 'Moyenne sur 42 jours',
              },
              {
                label: 'Fatigue',
                value: String(Math.round(fitness!.atl)),
                hint: 'Moyenne sur 7 jours',
              },
              {
                label: 'FC max / repos',
                value:
                  fitness!.hr_max != null && fitness!.hr_rest != null
                    ? `${fitness!.hr_max} / ${fitness!.hr_rest}`
                    : '—',
                hint: fitness!.manual ? 'Saisie à la main' : 'Depuis Garmin',
              },
            ]}
          />
        </View>
      ) : null}

      {todayQuery.data?.recovery ? <RecoveryStats recovery={todayQuery.data.recovery} /> : null}

      <FitnessCard fitness={fitness} isLoading={fitnessQuery.isLoading} />

      {/* Stated once, plainly, and not as a disclaimer buried at the bottom of a
          settings page: the app coaches training load, it does not diagnose. */}
      <ThemedText type="small" themeColor="inkMuted">
        Ces chiffres décrivent ta charge d’entraînement, rien de plus. Si la fatigue s’installe
        au-delà de quelques jours de repos, parles-en à un professionnel de santé.
      </ThemedText>
    </DetailScreen>
  );
}

const useStyles = makeStyles(() => ({
  verdict: {
    gap: Spacing.three,
  },
}));
