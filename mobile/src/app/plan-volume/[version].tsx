import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { DetailScreen } from '@/components/detail-screen';
import { PlanVolumeChart } from '@/components/plan-volume-chart';
import { StatTiles } from '@/components/stat-tiles';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { getPlanOverview, getPlanVersion } from '@/lib/api/plans';
import type { Plan, PlanOverview } from '@/lib/api/plans';
import { formatDuration, frKm } from '@/lib/plan-format';
import { volumeValue, weeklyVolume, weekRangeLabel } from '@/lib/plan-overview';
import type { VolumeMetric, WeekVolume } from '@/lib/plan-overview';
import { qk } from '@/lib/query-keys';

export default function PlanVolumeScreen() {
  const { version } = useLocalSearchParams<{ version: string }>();
  const versionNumber = Number(version);
  const enabled = Number.isFinite(versionNumber);
  // Minutes are what the plan actually prescribes; kilometres are derived from
  // each session's target pace. Both are worth seeing, so neither is buried.
  const [metric, setMetric] = useState<VolumeMetric>('km');

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
      title="Volume"
      blurb="La charge de course que le plan demande, semaine par semaine. Les kilomètres sont estimés à partir de l’allure cible — les minutes, elles, sont ce que le plan prescrit.">
      {planQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.contour} />
        </View>
      ) : planQuery.isError || !plan ? (
        <ThemedText type="default" themeColor="flare">
          Impossible de charger le volume de ce plan.
        </ThemedText>
      ) : (
        <Body
          plan={plan}
          overview={overviewQuery.data ?? null}
          metric={metric}
          onMetric={setMetric}
        />
      )}
    </DetailScreen>
  );
}

function Body({
  plan,
  overview,
  metric,
  onMetric,
}: {
  plan: Plan;
  overview: PlanOverview | null;
  metric: VolumeMetric;
  onMetric: (metric: VolumeMetric) => void;
}) {
  const weeks = weeklyVolume(plan);
  const values = weeks.map((w) => volumeValue(w, metric));
  const total = values.reduce((a, b) => a + b, 0);
  const peak = Math.max(...values, 0);

  // "Remaining" needs to know which weeks are behind us, and only the server
  // knows where the plan sits on the calendar.
  const pastIndexes = new Set(
    (overview?.weeks ?? []).filter((w) => w.is_past).map((w) => w.week_index),
  );
  const remaining = weeks
    .filter((w) => !pastIndexes.has(w.index))
    .reduce((sum, w) => sum + volumeValue(w, metric), 0);

  if (peak <= 0) {
    return (
      <ThemedText type="default" themeColor="textSecondary">
        Ce plan ne porte pas d’allure cible sur ses séances : impossible d’en estimer le volume.
      </ThemedText>
    );
  }

  return (
    <>
      <View style={styles.metrics}>
        <Chip label="Distance" selected={metric === 'km'} onPress={() => onMetric('km')} />
        <Chip label="Durée" selected={metric === 'minutes'} onPress={() => onMetric('minutes')} />
      </View>

      <View style={styles.card}>
        <StatTiles
          stats={[
            {
              label: 'Moyenne',
              value: fmt(total / weeks.length, metric),
              hint: 'par semaine, sur tout le plan',
            },
            { label: 'Pic', value: fmt(peak, metric), hint: 'la semaine la plus chargée' },
            { label: 'Total', value: fmt(total, metric), hint: `sur ${weeks.length} semaines` },
            {
              label: 'Restant',
              value: fmt(remaining, metric),
              hint: overview ? 'd’ici la fin du plan' : 'plan entier',
            },
          ]}
        />
      </View>

      <View style={styles.card}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Vue d’ensemble
        </ThemedText>
        <PlanVolumeChart
          weeks={weeks}
          weekCurrent={overview?.week_current ?? null}
          metric={metric}
        />
      </View>

      <View style={styles.card}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Semaine par semaine
        </ThemedText>
        {weeks.map((week, position) => (
          <WeekRow
            key={week.index}
            week={week}
            metric={metric}
            peak={peak}
            isCurrent={week.index === overview?.week_current}
            range={overview ? weekRangeLabel(overview.start_date, position) : null}
          />
        ))}
      </View>
    </>
  );
}

function WeekRow({
  week,
  metric,
  peak,
  isCurrent,
  range,
}: {
  week: WeekVolume;
  metric: VolumeMetric;
  peak: number;
  isCurrent: boolean;
  range: string | null;
}) {
  const value = volumeValue(week, metric);

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <ThemedText type="default" themeColor={isCurrent ? 'text' : 'textSecondary'}>
          Semaine {week.index}
          {week.isDeload ? ' · Décharge' : ''}
        </ThemedText>
        {range ? (
          <ThemedText type="small" themeColor="textSecondary">
            {range}
          </ThemedText>
        ) : null}
      </View>
      {/* A bar beside the figure, so the list is scannable as a shape and not
          just as a column of numbers to compare in your head. */}
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max((value / peak) * 100, 2)}%` },
            week.isDeload && styles.fillDeload,
            isCurrent && styles.fillCurrent,
          ]}
        />
      </View>
      <ThemedText type="default" style={styles.value}>
        {fmt(value, metric)}
      </ThemedText>
    </View>
  );
}

function fmt(value: number, metric: VolumeMetric): string {
  return metric === 'km' ? `${frKm(value)} km` : formatDuration(Math.round(value));
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  metrics: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
    paddingTop: Spacing.two,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  track: {
    width: 64,
    height: 6,
    borderRadius: Rounded.sm,
    backgroundColor: Colors.contourFaint,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Rounded.sm,
    backgroundColor: Colors.contour,
  },
  fillDeload: {
    backgroundColor: Colors.contourFaint,
  },
  fillCurrent: {
    backgroundColor: Colors.text,
  },
  value: {
    minWidth: 72,
    textAlign: 'right',
  },
});
