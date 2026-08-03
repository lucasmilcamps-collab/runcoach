import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatDuration } from '@/lib/plan-format';
import { makeStyles } from '@/lib/themed-styles';
import type { WeekProgress } from '@/lib/week-progress';

/** What was actually done this calendar week — three figures on one rule, as a
 * register line rather than three cards. */
export function WeeklyOverview({ progress }: { progress: WeekProgress }) {
  const styles = useStyles();

  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="inkMuted">
        Cette semaine
      </ThemedText>
      <View style={styles.row}>
        <Metric
          label="Séances"
          value={String(progress.done.count)}
          unit={progress.target.count > 0 ? `/ ${progress.target.count}` : undefined}
        />
        <Metric label="Distance" value={frNumber(progress.done.km)} unit="km" bordered />
        <Metric
          label="Temps"
          value={progress.done.minutes > 0 ? formatDuration(progress.done.minutes) : '0 min'}
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
  const styles = useStyles();

  return (
    <View style={[styles.metric, bordered && styles.metricBordered]}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      <View style={styles.valueRow}>
        <ThemedText type="figure">{value}</ThemedText>
        {unit ? (
          <ThemedText type="small" themeColor="inkMuted">
            {unit}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  row: {
    flexDirection: 'row',
  },
  metric: {
    flex: 1,
    gap: Spacing.one,
  },
  metricBordered: {
    borderLeftWidth: 1,
    borderLeftColor: t.rule,
    paddingLeft: Spacing.three,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
}));
