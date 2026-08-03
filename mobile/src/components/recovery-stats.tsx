import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { RecoverySummary } from '@/lib/api/plans';
import { makeStyles } from '@/lib/themed-styles';

function formatSleep(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, '0')}`;
}

/**
 * The overnight readings behind today's adjustment — HRV, resting HR, sleep,
 * Body Battery — as a register line.
 *
 * Transparency, not decoration: the engine downgrades a session on these
 * numbers, and an athlete who can't see them will override the decision. Only
 * metrics Garmin actually returned are shown; a missing reading is absent
 * rather than drawn as a zero.
 */
export function RecoveryStats({ recovery }: { recovery: RecoverySummary }) {
  const styles = useStyles();
  const items: { key: string; label: string; value: string; hint?: string }[] = [];

  if (recovery.hrv != null) {
    items.push({
      key: 'hrv',
      label: 'HRV',
      value: `${Math.round(recovery.hrv)} ms`,
      hint: recovery.hrv_baseline != null ? `base ${Math.round(recovery.hrv_baseline)}` : undefined,
    });
  }
  if (recovery.resting_hr != null) {
    items.push({
      key: 'rhr',
      label: 'FC repos',
      value: `${Math.round(recovery.resting_hr)} bpm`,
      hint:
        recovery.resting_hr_baseline != null
          ? `base ${Math.round(recovery.resting_hr_baseline)}`
          : undefined,
    });
  }
  if (recovery.sleep_hours != null) {
    items.push({ key: 'sleep', label: 'Sommeil', value: formatSleep(recovery.sleep_hours) });
  }
  if (recovery.body_battery != null) {
    items.push({ key: 'bb', label: 'Body Battery', value: `${recovery.body_battery}` });
  }
  if (items.length === 0) return null;

  return (
    <View style={styles.block}>
      <ThemedText type="label" themeColor="inkMuted">
        La nuit dernière
      </ThemedText>
      <View style={styles.row}>
        {items.map((item) => (
          <View key={item.key} style={styles.stat}>
            <ThemedText type="label" themeColor="inkMuted">
              {item.label}
            </ThemedText>
            <ThemedText type="figure" style={styles.value}>
              {item.value}
            </ThemedText>
            {item.hint ? (
              <ThemedText type="small" themeColor="inkMuted">
                {item.hint}
              </ThemedText>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.four,
  },
  stat: {
    gap: Spacing.half,
  },
  value: {
    fontSize: 16,
    lineHeight: 22,
  },
}));
