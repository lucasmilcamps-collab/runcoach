import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { volumeValue } from '@/lib/plan-overview';
import type { VolumeMetric, WeekVolume } from '@/lib/plan-overview';

const ChartHeight = 96;
// Enough to stay visible on a week the plan barely runs, without pretending a
// near-empty week has volume.
const MinBarHeight = 3;

/**
 * Planned running volume, week by week.
 *
 * Bars, and from a zero baseline — the opposite of the fitness curve, on
 * purpose. Weekly volume is a discrete tally per week and the job is comparing
 * one week against the next, which is what bars are for; the height *is* the
 * value, so the baseline can't start anywhere but zero. (The fitness card plots
 * a 42-day rolling average — one continuous movement — hence a line there.)
 */
export function PlanVolumeChart({
  weeks,
  weekCurrent,
  metric = 'km',
}: {
  weeks: WeekVolume[];
  weekCurrent: number | null;
  metric?: VolumeMetric;
}) {
  const peak = Math.max(...weeks.map((w) => volumeValue(w, metric)), 1);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.chart}
        accessibilityRole="image"
        accessibilityLabel={label(weeks, peak, metric)}>
        {weeks.map((week) => {
          const isCurrent = week.index === weekCurrent;
          return (
            <View key={week.index} style={styles.slot}>
              <View
                style={[
                  styles.bar,
                  { height: `${Math.max((volumeValue(week, metric) / peak) * 100, MinBarHeight)}%` },
                  // Deload weeks are lighter, not missing: a shorter bar already
                  // says "less", and the tone says the drop was planned.
                  week.isDeload && styles.barDeload,
                  isCurrent && styles.barCurrent,
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          S{weeks[0]?.index ?? 1}
        </ThemedText>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          S{weeks[weeks.length - 1]?.index ?? 1}
        </ThemedText>
      </View>
    </View>
  );
}

function label(weeks: WeekVolume[], peak: number, metric: VolumeMetric): string {
  const unit = metric === 'km' ? 'kilomètres' : 'minutes';
  return `Volume prévu sur ${weeks.length} semaines, jusqu’à ${Math.round(peak)} ${unit} par semaine.`;
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: ChartHeight,
    gap: 2,
  },
  slot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    // Rounded at the data end only. A pill rounded at the bottom too lifts the
    // bar off its baseline, and the baseline is the whole claim a bar makes.
    borderTopLeftRadius: Rounded.sm,
    borderTopRightRadius: Rounded.sm,
    backgroundColor: Colors.contour,
  },
  barDeload: {
    backgroundColor: Colors.contourFaint,
  },
  barCurrent: {
    // Where you are reads through brightness, not the blaze accent — this card
    // is a read-out, not a call to act.
    backgroundColor: Colors.text,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
