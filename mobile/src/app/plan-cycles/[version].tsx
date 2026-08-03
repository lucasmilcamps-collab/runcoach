import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { DetailScreen } from '@/components/detail-screen';
import { PlanPhaseBar } from '@/components/plan-phase-bar';
import { StatTiles } from '@/components/stat-tiles';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';
import { getPlanOverview, getPlanVersion } from '@/lib/api/plans';
import type { Plan, PlanOverview, PlanPhase } from '@/lib/api/plans';
import { PHASE_LABELS, formatDuration, frKm } from '@/lib/plan-format';
import { PHASE_PURPOSE, phaseSpans, weeklyVolume, weekRangeLabel } from '@/lib/plan-overview';
import { qk } from '@/lib/query-keys';

export default function PlanCyclesScreen() {
  const theme = useTheme();
  const styles = useStyles();
  const { version } = useLocalSearchParams<{ version: string }>();
  const versionNumber = Number(version);
  const enabled = Number.isFinite(versionNumber);

  const planQuery = useQuery({
    queryKey: qk.planVersion.byVersion(versionNumber),
    queryFn: () => getPlanVersion(versionNumber),
    enabled,
  });
  const overviewQuery = useQuery({
    queryKey: qk.planOverview.byVersion(versionNumber),
    queryFn: () => getPlanOverview(versionNumber),
    enabled,
  });

  const plan = planQuery.data?.plan ?? null;

  return (
    <DetailScreen
      kicker={`Plan ${version}`}
      title="Cycles"
      blurb="Un plan n’est pas une suite de semaines interchangeables : chaque bloc a un travail à lui, et n’a de sens que posé sur le précédent.">
      {planQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.ruleStrong} />
        </View>
      ) : planQuery.isError || !plan ? (
        <ThemedText type="default" themeColor="alerte">
          Impossible de charger les cycles de ce plan.
        </ThemedText>
      ) : (
        <Body plan={plan} overview={overviewQuery.data ?? null} />
      )}
    </DetailScreen>
  );
}

function Body({ plan, overview }: { plan: Plan; overview: PlanOverview | null }) {
  const styles = useStyles();
  const spans = phaseSpans(plan);
  const volumes = weeklyVolume(plan);
  const weekCurrent = overview?.week_current ?? null;
  // Position within the whole plan, so each phase's weeks can be dated.
  const positionOf = new Map(volumes.map((week, position) => [week.index, position]));

  return (
    <>
      <View style={styles.card}>
        <PlanPhaseBar phases={spans} weekCurrent={weekCurrent} />
      </View>

      {plan.phases
        .filter((phase) => phase.weeks.length > 0)
        .map((phase, phaseIndex) => (
          <PhaseCard
            key={`${phase.name}-${phaseIndex}`}
            phase={phase}
            position={phaseIndex + 1}
            total={spans.length}
            weekCurrent={weekCurrent}
            volumes={volumes}
            positionOf={positionOf}
            startDate={overview?.start_date ?? null}
          />
        ))}
    </>
  );
}

function PhaseCard({
  phase,
  position,
  total,
  weekCurrent,
  volumes,
  positionOf,
  startDate,
}: {
  phase: PlanPhase;
  position: number;
  total: number;
  weekCurrent: number | null;
  volumes: ReturnType<typeof weeklyVolume>;
  positionOf: Map<number, number>;
  startDate: string | null;
}) {
  const styles = useStyles();
  const first = phase.weeks[0].index;
  const last = phase.weeks[phase.weeks.length - 1].index;
  const isCurrent = weekCurrent != null && weekCurrent >= first && weekCurrent <= last;
  const phaseVolumes = volumes.filter((v) => v.index >= first && v.index <= last);
  const km = phaseVolumes.reduce((sum, v) => sum + v.km, 0);
  const minutes = phaseVolumes.reduce((sum, v) => sum + v.minutes, 0);
  const keyRuns = phase.weeks.reduce(
    (sum, week) =>
      sum +
      week.sessions.filter(
        (s) => s.sport === 'RUN' && s.type !== 'rest' && s.slot === 'primary' && s.priority === 'key',
      ).length,
    0,
  );

  return (
    <View style={styles.card}>
      <View style={styles.phaseHead}>
        <ThemedText type="label" themeColor="inkMuted">
          Cycle {position} sur {total}
        </ThemedText>
        {isCurrent ? (
          <View style={styles.badge}>
            <ThemedText type="label" themeColor="ink">
              En cours
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="subtitle">{PHASE_LABELS[phase.name]}</ThemedText>
      <ThemedText type="small" themeColor="inkMuted">
        {first === last ? `Semaine ${first}` : `Semaines ${first} à ${last}`}
      </ThemedText>
      {/* Straight from the project's training-science reference, not marketing
          copy: what this block is for, and why it comes where it comes. */}
      <ThemedText type="default" themeColor="inkMuted">
        {PHASE_PURPOSE[phase.name]}
      </ThemedText>

      <StatTiles
        stats={[
          { label: 'Durée', value: `${phase.weeks.length}`, unit: 'semaines' },
          { label: 'Séances clés', value: `${keyRuns}`, unit: 'courses' },
          { label: 'Distance', value: frKm(km), unit: 'km' },
          { label: 'Temps de course', value: formatDuration(minutes) },
        ]}
      />

      <View style={styles.weeks}>
        {phase.weeks.map((week) => {
          const volume = volumes.find((v) => v.index === week.index);
          const pos = positionOf.get(week.index);
          return (
            <View key={week.index} style={styles.row}>
              <View style={styles.rowMain}>
                <ThemedText
                  type="default"
                  themeColor={week.index === weekCurrent ? 'ink' : 'inkMuted'}>
                  Semaine {week.index}
                  {week.is_deload ? ' · Décharge' : ''}
                </ThemedText>
                {startDate != null && pos != null ? (
                  <ThemedText type="small" themeColor="inkMuted">
                    {weekRangeLabel(startDate, pos)}
                  </ThemedText>
                ) : null}
              </View>
              {volume && volume.km > 0 ? (
                <ThemedText type="default" themeColor="inkMuted">
                  {frKm(volume.km)} km
                </ThemedText>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  card: {
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  phaseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  badge: {
    backgroundColor: t.rule,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  weeks: {
    gap: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 40,
    borderTopWidth: 1,
    borderTopColor: t.rule,
    paddingTop: Spacing.two,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
}));
