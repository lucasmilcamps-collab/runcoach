import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { SportIcon } from '@/components/sport-icon';
import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing, typeSize } from '@/constants/theme';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { sportLabel } from '@/lib/activity-labels';
import { DAY_LABELS, DAY_LABELS_SHORT, formatDuration } from '@/lib/plan-format';
import { makeStyles } from '@/lib/themed-styles';
import type { LedgerDay, OverloadVerdict, WeekLedger } from '@/lib/week-ledger';

/** Tallest a column can draw. The scale is the week's own peak, from a zero
 * baseline — a bar states its value through its height, so it cannot start
 * anywhere else (DESIGN.md). */
const BAR_MAX = 104;
const SEGMENT_MIN = 4;

/**
 * The Ledger: seven day-columns on one shared baseline, every discipline posting
 * to the same account.
 *
 * This is the product's argument made into a drawing. A Tuesday basket match and
 * a Wednesday tempo are compared on the same axis, at the same width, with the
 * same treatment — cross-training is load, and the one thing this component may
 * never do is fold padel and basket into a single "autres" segment.
 *
 * Realised minutes are filled; what the plan still asks for is a dashed outline.
 * Colour appears only on the state tick under each column, because in this
 * system colour means training load and nothing else: Go for the day carrying
 * the week's key session, Récup for a day that is *supposed* to be quiet.
 * Sport is carried by a glyph and by the totals line, never by a colour legend —
 * five distinguishable hues would be five hues that stop meaning load.
 */
export function WeekLedgerCard({
  ledger,
  verdict,
  style,
}: {
  ledger: WeekLedger;
  verdict: OverloadVerdict | null;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const theme = useTheme();
  // Seven columns have to share one phone width. Past this much text growth,
  // three-letter days collide, so they drop to two — the column's position
  // already says which day it is, and the chart's spoken description names
  // every day in full regardless.
  const dayLabels = useFontScale() >= 1.4 ? DAY_LABELS_SHORT : DAY_LABELS;

  const verdictColor =
    verdict?.level === 'high' ? theme.prudence : verdict?.level === 'low' ? theme.go : theme.inkMuted;

  return (
    <View style={[styles.block, style]}>
      <View style={styles.head}>
        <ThemedText type="label" themeColor="inkMuted">
          La semaine
        </ThemedText>
        <ThemedText type="figure" themeColor="inkMuted" style={styles.headFigure}>
          {formatDuration(ledger.doneMinutes)}
          {ledger.plannedMinutes > 0
            ? ` / ${formatDuration(ledger.doneMinutes + ledger.plannedMinutes)}`
            : ''}
        </ThemedText>
      </View>

      {/* The chart states its conclusion in words: the drawing gives the shape,
          this gives the direction and the size, so neither rests on an axis the
          reader can't see. */}
      {verdict ? (
        <View style={styles.verdictRow}>
          <View style={[styles.verdictTag, { borderColor: verdictColor }]}>
            <ThemedText type="label" style={{ color: verdictColor }}>
              Surcharge {verdict.word}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="inkMuted" style={styles.verdictText}>
            {verdict.sentence}
          </ThemedText>
        </View>
      ) : null}

      {/* Plot, baseline and axis are one unit with no gap between them: the
          columns have to stand *on* the rule for the comparison to read. */}
      <View accessibilityRole="image" accessibilityLabel={ledgerDescription(ledger)}>
        <View style={styles.plot}>
          {ledger.days.map((day) => (
            <Column key={day.weekday} day={day} peak={ledger.peakMinutes} />
          ))}
        </View>
        <View style={styles.baseline} />
        <View style={styles.axis}>
          {ledger.days.map((day) => (
            <View key={day.weekday} style={styles.axisCell}>
              <ThemedText
                type="label"
                themeColor={day.isToday ? 'ink' : 'inkMuted'}
                style={day.isToday ? styles.axisToday : undefined}>
                {dayLabels[day.weekday]}
              </ThemedText>
              <View
                style={[
                  styles.tick,
                  day.state === 'recup' && styles.tickShort,
                  {
                    backgroundColor:
                      day.state === 'go'
                        ? theme.go
                        : day.state === 'recup'
                          ? theme.recup
                          : 'transparent',
                  },
                ]}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Without this the ticks were colour alone: nothing on screen said what
          a green mark meant, and a reader who can't separate the two hues had
          no second cue at all. The marks now differ in length as well, and the
          legend names both — it only appears when a state is actually drawn. */}
      {ledger.days.some((day) => day.state != null) ? (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.tick, { backgroundColor: theme.go }]} />
            <ThemedText type="small" themeColor="inkMuted">
              Séance clé
            </ThemedText>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.tick, styles.tickShort, { backgroundColor: theme.recup }]} />
            <ThemedText type="small" themeColor="inkMuted">
              Jour facile
            </ThemedText>
          </View>
        </View>
      ) : null}

      {ledger.totals.length > 0 ? (
        <View style={styles.totals}>
          {ledger.totals.map((total) => (
            <View key={total.sport} style={styles.total}>
              <SportIcon sport={total.sport} size={16} color={theme.inkMuted} />
              <ThemedText type="small" themeColor="inkMuted">
                {sportLabel(total.sport)}
              </ThemedText>
              <ThemedText type="figure" themeColor="ink" style={styles.totalFigure}>
                {formatDuration(total.minutes)}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Column({ day, peak }: { day: LedgerDay; peak: number }) {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={styles.column}>
      {/* Today's marker is a lane the width of the bars, not the width of the
          column: a full-column block read as a container around the day rather
          than as a mark on the axis. */}
      {day.isToday ? <View style={styles.todayLane} /> : null}
      <View style={styles.stack}>
        {day.entries.map((entry, index) => {
          const height = Math.max((entry.minutes / peak) * BAR_MAX, SEGMENT_MIN);
          return (
            <View
              key={`${entry.sport}-${index}`}
              style={[
                styles.segment,
                { height },
                entry.planned
                  ? { borderColor: theme.ruleStrong, borderWidth: 1, borderStyle: 'dashed' }
                  : { backgroundColor: theme.inkMuted },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

/** One atomic description for the whole drawing. A tree of bare Views announces
 * nothing at all to a screen reader, so the chart says its content in a sentence
 * rather than as thirty empty boxes. */
function ledgerDescription(ledger: WeekLedger): string {
  const days = ledger.days
    .filter((day) => day.doneMinutes > 0 || day.plannedMinutes > 0)
    .map((day) => {
      const done = day.doneMinutes > 0 ? `${day.doneMinutes} minutes faites` : '';
      const planned = day.plannedMinutes > 0 ? `${day.plannedMinutes} minutes prévues` : '';
      const state =
        day.state === 'go' ? 'séance clé' : day.state === 'recup' ? 'jour facile' : '';
      return `${DAY_LABELS[day.weekday]} : ${[done, planned, state].filter(Boolean).join(', ')}`;
    });
  if (days.length === 0) return 'Aucune séance cette semaine, ni faite ni prévue.';
  return `Charge de la semaine, en minutes par jour. ${days.join('. ')}.`;
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: Spacing.three,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.three,
    // The total drops to its own line at large text rather than both halves
    // wrapping inside their own column.
    flexWrap: 'wrap',
  },
  headFigure: {
    fontSize: typeSize(13),
    lineHeight: typeSize(18),
  },
  verdictRow: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  verdictTag: {
    borderWidth: 1,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
  },
  verdictText: {
    width: '100%',
  },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: BAR_MAX,
    gap: Spacing.one,
  },
  column: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  todayLane: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    maxWidth: 44,
    borderRadius: Rounded.sm,
    // Today is marked by its ground, not by a colour: colour is spent on load
    // state, and "which day is it" is not one.
    backgroundColor: t.raised,
  },
  stack: {
    flexDirection: 'column-reverse',
    gap: 2,
    // Capped and centred: a seventh of a desktop column is ~140px, and a bar
    // that wide stops reading as a bar.
    width: '100%',
    maxWidth: 44,
    alignSelf: 'center',
  },
  segment: {
    borderRadius: 2,
  },
  baseline: {
    height: 1,
    backgroundColor: t.ruleStrong,
  },
  axis: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  axisCell: {
    flex: 1,
    // Without an explicit zero basis a long label sets the cell's width and the
    // seven columns stop being equal — which is the whole premise of the chart.
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    gap: Spacing.one,
  },
  axisToday: {
    fontWeight: '700',
  },
  tick: {
    width: 16,
    height: 3,
    borderRadius: 2,
  },
  // Length is the second cue, so the two states stay apart in greyscale and for
  // a reader who can't separate the hues.
  tickShort: {
    width: 6,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    // `one` held at the default size but read as no gap at all once the text
    // doubled — "Basket1 h 32".
    gap: Spacing.two,
  },
  totalFigure: {
    fontSize: typeSize(13),
    lineHeight: typeSize(18),
  },
}));
