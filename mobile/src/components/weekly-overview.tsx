import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { formatDuration } from '@/lib/plan-format';
import type { WeekProgress } from '@/lib/week-progress';

/** "Ton aperçu hebdomadaire": what was actually done this calendar week. */
export function WeeklyOverview({ progress }: { progress: WeekProgress }) {
  return (
    <View style={styles.card}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Ton aperçu hebdomadaire
      </ThemedText>
      <View style={styles.row}>
        <Metric label="Activités" value={String(progress.done.count)} unit={`/ ${progress.target.count}`} />
        <Metric label="Distance" value={frNumber(progress.done.km)} unit="km" bordered />
        <Metric
          label="Temps"
          value={progress.done.minutes > 0 ? formatDuration(progress.done.minutes) : '0'}
          unit={progress.done.minutes >= 60 ? '' : 'min'}
          bordered
        />
      </View>
    </View>
  );
}

function frNumber(n: number): string {
  return (Number.isInteger(n) ? String(n) : n.toFixed(1)).replace('.', ',');
}

function Metric({
  label,
  value,
  unit,
  bordered,
}: {
  label: string;
  value: string;
  unit?: string;
  bordered?: boolean;
}) {
  return (
    <View style={[styles.metric, bordered && styles.metricBordered]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.valueRow}>
        <ThemedText type="subtitle">{value}</ThemedText>
        {unit ? (
          <ThemedText type="small" themeColor="textSecondary">
            {unit}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
  },
  metric: {
    flex: 1,
    gap: Spacing.half,
  },
  metricBordered: {
    borderLeftWidth: 1,
    borderLeftColor: Colors.contourFaint,
    paddingLeft: Spacing.three,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
});
