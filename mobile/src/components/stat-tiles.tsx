import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';

export type Stat = {
  label: string;
  value: string;
  unit?: string;
  /** Shown under the value — what the number means, when the label can't say it
   * in three words. A figure nobody can interpret is worse than no figure. */
  hint?: string;
};

/**
 * A two-up register of figures, used by the detail screens where each one breaks
 * a single summary block into the numbers behind it.
 *
 * Cells are divided by rules rather than boxed as cards: they are columns of one
 * table, not four separate objects, and a card around each would say otherwise
 * (DESIGN.md).
 */
export function StatTiles({ stats }: { stats: Stat[] }) {
  const styles = useStyles();

  return (
    <View style={styles.grid}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.tile}>
          <ThemedText type="label" themeColor="inkMuted">
            {stat.label}
          </ThemedText>
          <View style={styles.valueRow}>
            <ThemedText type="figure">{stat.value}</ThemedText>
            {stat.unit ? (
              <ThemedText type="small" themeColor="inkMuted">
                {stat.unit}
              </ThemedText>
            ) : null}
          </View>
          {stat.hint ? (
            <ThemedText type="small" themeColor="inkMuted">
              {stat.hint}
            </ThemedText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
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
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
    gap: Spacing.one,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
}));
