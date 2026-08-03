import { useState } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import type { WeekAdherence } from '@/lib/api/plans';

const MaxCell = 14;
const MinCell = 6;
const CellGap = 2;

type CellState = 'done' | 'missed' | 'upcoming';

/**
 * One cell per committed run, one column per week: what the plan asked, and
 * what actually happened.
 *
 * The three states are told apart by fill *and* by outline, never by colour
 * alone — a filled block, a hollow one, and a faint one stay distinguishable in
 * greyscale and to a colour-blind reader. A legend names them, because a grid
 * of squares explains nothing on its own.
 *
 * Missed sessions are drawn as an outline, never in the Alerte ink. Skipping a run is
 * not a fault to flag in red; it is a fact the plan can adapt to.
 */
export function PlanAdherenceGrid({ weeks }: { weeks: WeekAdherence[] }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  const columns = weeks.length;
  const rows = Math.max(...weeks.map((w) => w.planned), 1);
  // A 25-week plan can't keep 14px cells on a phone, so the grid sizes itself
  // to the column rather than overflowing or being cut off.
  const cell = Math.max(
    MinCell,
    Math.min(MaxCell, columns > 0 ? (width - CellGap * (columns - 1)) / columns : MaxCell),
  );

  return (
    <View style={styles.wrap}>
      <View
        style={styles.grid}
        onLayout={onLayout}
        accessibilityRole="image"
        accessibilityLabel={label(weeks)}
        // The label gives the totals; the hint explains the shape those totals
        // are drawn in, which is the part a non-sighted reader has no other way
        // to reconstruct — and which the on-screen legend only tells you if you
        // can see the swatches.
        accessibilityHint="Une colonne par semaine, un carré par séance clé prévue : plein pour une séance faite, en contour pour une manquée, estompé pour une séance à venir.">
        {width > 0
          ? weeks.map((week) => (
              <View key={week.week_index} style={styles.column}>
                {Array.from({ length: rows }, (_, row) => {
                  // Rows fill from the bottom, so a week with fewer runs leaves
                  // its gap at the top instead of floating mid-column.
                  const slot = rows - 1 - row;
                  if (slot >= week.planned) {
                    return <View key={row} style={{ width: cell, height: cell }} />;
                  }
                  return (
                    <View
                      key={row}
                      style={[
                        styles.cell,
                        { width: cell, height: cell },
                        styles[cellState(week, slot)],
                      ]}
                    />
                  );
                })}
              </View>
            ))
          : null}
      </View>
      <View style={styles.axis}>
        <ThemedText type="label" themeColor="inkMuted">
          S{weeks[0]?.week_index ?? 1}
        </ThemedText>
        <ThemedText type="label" themeColor="inkMuted">
          S{weeks[weeks.length - 1]?.week_index ?? 1}
        </ThemedText>
      </View>
      <View style={styles.legend}>
        <LegendItem state="done" label="Faite" />
        <LegendItem state="missed" label="Manquée" />
        <LegendItem state="upcoming" label="À venir" />
      </View>
    </View>
  );
}

function cellState(week: WeekAdherence, slot: number): CellState {
  if (slot < week.completed) return 'done';
  return week.is_past ? 'missed' : 'upcoming';
}

function LegendItem({ state, label }: { state: CellState; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.cell, styles.legendSwatch, styles[state]]} />
      <ThemedText type="small" themeColor="inkMuted">
        {label}
      </ThemedText>
    </View>
  );
}

function label(weeks: WeekAdherence[]): string {
  const elapsed = weeks.filter((w) => w.is_past);
  const planned = elapsed.reduce((n, w) => n + w.planned, 0);
  const done = elapsed.reduce((n, w) => n + w.completed, 0);
  return `${done} séances clés faites sur ${planned} prévues, semaine par semaine.`;
}

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: CellGap,
  },
  column: {
    gap: CellGap,
  },
  cell: {
    borderRadius: Rounded.sm,
    borderWidth: 1,
  },
  done: {
    backgroundColor: t.ruleStrong,
    borderColor: t.rule,
  },
  missed: {
    backgroundColor: 'transparent',
    borderColor: t.rule,
  },
  upcoming: {
    backgroundColor: 'transparent',
    borderColor: t.rule,
  },
  legendSwatch: {
    width: 10,
    height: 10,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
}));
