import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { sportLabel } from '@/lib/activity-labels';
import type { WeekSport } from '@/lib/week-progress';

/**
 * This week's activities broken down by sport, as a small load chart. Its job is
 * to make the product's thesis literal: padel/basket/bike sit next to running,
 * with the *same* bar treatment, because they count as load too — not hidden
 * inside a single "activities" total, and not visually subordinated to running.
 *
 * Bars are sienna contour (never a second accent): this is a load read-out, not
 * a call to act, so the One Blaze Rule is left to the hero and the week
 * waymarker.
 */
export function WeekSportStrip({ sports }: { sports: WeekSport[] }) {
  if (sports.length === 0) return null;

  const max = Math.max(...sports.map((s) => s.count), 1);
  const hasCrossTraining = sports.some((s) => s.sport !== 'RUN');

  return (
    <View style={styles.card}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Ta charge cette semaine
      </ThemedText>
      <View style={styles.rows}>
        {sports.map((s) => (
          <View key={s.sport} style={styles.row}>
            <ThemedText type="default" style={styles.name} numberOfLines={1}>
              {sportLabel(s.sport)}
            </ThemedText>
            <View
              style={styles.track}
              accessibilityLabel={`${sportLabel(s.sport)} : ${s.count} séance${s.count > 1 ? 's' : ''}`}>
              <View style={[styles.fill, { width: `${(s.count / max) * 100}%` }]} />
            </View>
            <ThemedText type="waypointLabel" themeColor="text" style={styles.count}>
              {s.count}
            </ThemedText>
          </View>
        ))}
      </View>
      {hasCrossTraining ? (
        <ThemedText type="small" themeColor="textSecondary">
          Le cross-training compte dans ta charge, comme la course.
        </ThemedText>
      ) : null}
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
  rows: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  name: {
    width: 108,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: Rounded.sm,
    backgroundColor: Colors.contourFaint,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Rounded.sm,
    backgroundColor: Colors.contour,
    minWidth: 8,
  },
  count: {
    minWidth: 16,
    textAlign: 'right',
  },
});
