import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';

export type Stat = {
  label: string;
  value: string;
  unit?: string;
  /** Shown under the value — what the number means, when the label can't say it
   * in three words. A figure nobody can interpret is worse than no figure. */
  hint?: string;
};

/**
 * A two-up grid of figures. Used by the plan detail screens, where each one
 * breaks a single card of the summary into the four numbers behind it.
 */
export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.grid}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.tile}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {stat.label}
          </ThemedText>
          <View style={styles.valueRow}>
            <ThemedText type="subtitle">{stat.value}</ThemedText>
            {stat.unit ? (
              <ThemedText type="small" themeColor="textSecondary">
                {stat.unit}
              </ThemedText>
            ) : null}
          </View>
          {stat.hint ? (
            <ThemedText type="small" themeColor="textSecondary">
              {stat.hint}
            </ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  tile: {
    // Two per row at any width: `flexBasis: 0` with a grow of 1 would let a long
    // value squeeze its neighbour instead of wrapping.
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: Colors.background,
    borderRadius: Rounded.md,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
});
