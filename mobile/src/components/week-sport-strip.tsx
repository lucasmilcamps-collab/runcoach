import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { sportLabel } from '@/lib/activity-labels';
import type { WeekSport } from '@/lib/week-progress';

/** This week's activities broken down by sport. Its job is to make the product's
 * thesis literal: padel/basket/bike sit next to running because they count as
 * load too — not hidden inside a single "activities" total. */
export function WeekSportStrip({ sports }: { sports: WeekSport[] }) {
  if (sports.length === 0) return null;

  const hasCrossTraining = sports.some((s) => s.sport !== 'RUN');

  return (
    <View style={styles.strip}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Cette semaine
      </ThemedText>
      <View style={styles.tags}>
        {sports.map((s) => (
          <View key={s.sport} style={styles.tag}>
            <ThemedText type="waypointLabel" themeColor="text">
              {sportLabel(s.sport)} {s.count}
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
  strip: {
    gap: Spacing.two,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tag: {
    borderWidth: 1,
    borderColor: Colors.contour,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
