import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { PhaseSpan } from '@/lib/plan-overview';
import { PHASE_LABELS } from '@/lib/plan-format';

/**
 * The plan's phases as one continuous bar, each segment as wide as the phase is
 * long, with the phase you're in right now brought forward.
 *
 * Campus draws this as an arc of tiles; here it stays a straight run, because
 * the app already reads a plan as a trail travelled left to right — the week
 * stepper on Accueil uses the same axis, and two different geometries for "how
 * far along am I" would be two metaphors for one idea.
 */
export function PlanPhaseBar({
  phases,
  weekCurrent,
}: {
  phases: PhaseSpan[];
  weekCurrent: number | null;
}) {
  const totalWeeks = phases.reduce((n, phase) => n + phase.weeks, 0) || 1;

  return (
    <View style={styles.wrap}>
      <View
        style={styles.bar}
        accessibilityRole="image"
        accessibilityLabel={phases
          .map((p) => `${PHASE_LABELS[p.name]} ${p.weeks} semaines`)
          .join(', ')}>
        {phases.map((phase) => {
          const isCurrent =
            weekCurrent != null && weekCurrent >= phase.firstWeek && weekCurrent <= phase.lastWeek;
          return (
            <View
              key={`${phase.name}-${phase.firstWeek}`}
              style={[
                styles.segment,
                { flexGrow: phase.weeks / totalWeeks },
                isCurrent && styles.segmentCurrent,
              ]}
            />
          );
        })}
      </View>
      {/* The names sit in a plain wrapping row, NOT in columns matching the
          segments: a phase's width says how many weeks it lasts, and it has
          nothing to do with how long its name is. Tying the two put "Affûtage"
          in a 26px column, where it broke one letter per line. Left-to-right
          order is what ties a name back to its segment. */}
      <View style={styles.labels}>
        {phases.map((phase) => {
          const isCurrent =
            weekCurrent != null && weekCurrent >= phase.firstWeek && weekCurrent <= phase.lastWeek;
          return (
            <View key={`${phase.name}-${phase.firstWeek}`} style={styles.label}>
              <ThemedText type="waypointLabel" themeColor={isCurrent ? 'text' : 'textSecondary'}>
                {PHASE_LABELS[phase.name]}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {phase.weeks} sem.
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  bar: {
    flexDirection: 'row',
    height: 10,
    gap: 2,
  },
  segment: {
    flexBasis: 0,
    borderRadius: Rounded.sm,
    backgroundColor: Colors.contourFaint,
  },
  segmentCurrent: {
    backgroundColor: Colors.contour,
  },
  labels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  label: {
    gap: Spacing.half,
  },
});
