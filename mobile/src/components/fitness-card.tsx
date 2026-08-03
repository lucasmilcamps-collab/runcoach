import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pressable } from '@/lib/pressable';
import { makeStyles } from '@/lib/themed-styles';
import type { Fitness } from '@/lib/api/fitness';

function openProfileEntry() {
  router.push('/fitness-profile');
}

/**
 * The trend read-out behind the form figure: caisse de fond over 90 days, plus
 * the two averages it is made of.
 *
 * It no longer states the verdict — that lives once, on Accueil, next to the
 * ledger it explains (DESIGN.md: a screen that says "Forme +14 · Frais" twice
 * reads as unfinished).
 */
export function FitnessCard({
  fitness,
  isLoading,
  style,
}: {
  fitness: Fitness | undefined;
  isLoading: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [showHelp, setShowHelp] = useState(false);

  if (isLoading && !fitness) {
    return (
      <View style={[styles.block, styles.centered, style]}>
        <ActivityIndicator color={theme.inkMuted} />
      </View>
    );
  }

  if (!fitness || !fitness.has_profile || fitness.series.length === 0) {
    const missingProfile = fitness ? !fitness.has_profile : false;
    return (
      <View style={[styles.block, style]}>
        <ThemedText type="label" themeColor="inkMuted">
          Forme
        </ThemedText>
        <ThemedText type="small" themeColor="inkMuted">
          {missingProfile
            ? 'Pour calculer ta forme, il faut ta fréquence cardiaque de repos et maximale. Garmin ne les fournit pas ici — renseigne-les à la main.'
            : 'Pas encore assez de séances avec fréquence cardiaque pour estimer ta forme.'}
        </ThemedText>
        {/* With no profile there is nothing to show, so this is a blocker, not a
            shortcut. Editing an existing profile lives in Réglages. */}
        {missingProfile ? (
          <View style={styles.ctaButton}>
            <Button label="Renseigner ma fréquence cardiaque" onPress={openProfileEntry} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.block, style]}>
      <View style={styles.headerRow}>
        <ThemedText type="label" themeColor="inkMuted">
          Caisse de fond — 90 jours
        </ThemedText>
        <Pressable
          onPress={() => setShowHelp((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Qu’est-ce que la forme ?"
          accessibilityState={{ expanded: showHelp }}
          style={pressable(styles.help)}>
          <ThemedText type="small" themeColor="inkMuted">
            {showHelp ? 'Masquer' : 'C’est quoi ?'}
          </ThemedText>
        </Pressable>
      </View>

      {showHelp ? (
        <ThemedText type="small" themeColor="inkMuted">
          Ta forme = ta caisse de fond (l’endurance accumulée) moins ta fatigue récente. Positif :
          tu es reposé ; négatif : tu encaisses encore la charge des dernières séances.
        </ThemedText>
      ) : null}

      {/* The shape alone left the reader to work out the direction. The chart
          says it outright and the curve backs it up. */}
      <ThemedText type="default">{trendSentence(fitness.series)}</ThemedText>
      <FitnessTrend series={fitness.series} />

      <View style={styles.statsRow}>
        <Stat label="Base 42 j" value={Math.round(fitness.ctl)} />
        <View style={styles.statDivider} />
        <Stat label="Fatigue 7 j" value={Math.round(fitness.atl)} />
      </View>

      {fitness.low_confidence ? (
        <ThemedText type="small" themeColor="inkMuted">
          Historique limité : l’estimation s’affinera au fil des semaines.
        </ThemedText>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const styles = useStyles();

  return (
    <View style={styles.stat}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      <ThemedText type="figure">{value}</ThemedText>
    </View>
  );
}

/** The 90-day change in fitness, in words. A shape shows *that* it moved; this
 * says which way and by how much — the part the reader was left to infer. */
function trendSentence(series: Fitness['series']): string {
  if (series.length < 2) return 'Trop tôt pour dégager une tendance';
  const delta = Math.round(series[series.length - 1].ctl - series[0].ctl);
  // Under 2 points across three months is noise in a 42-day average, not a trend.
  if (Math.abs(delta) < 2) return 'Stable sur 90 jours';
  return delta > 0 ? `En hausse · +${delta} sur 90 jours` : `En baisse · −${-delta} sur 90 jours`;
}

// The curve's floor, not its height: side by side with a taller block the plot
// grows into whatever the column has left over.
const MinChartHeight = 72;
// Room for the endpoint marker, which the viewport would otherwise clip on the
// right and at the top when the series peaks on its last day.
const MarkerRadius = 4;
const ChartPad = MarkerRadius + 1;
// Smallest CTL window the chart will scale to. Fitness moves by a couple of
// points over a quiet month, and fitting the view to that would blow the noise
// up into a mountain range — a flat stretch has to keep looking flat.
const MinRange = 6;

function FitnessTrend({ series }: { series: Fitness['series'] }) {
  const styles = useStyles();
  const theme = useTheme();
  // Both dimensions come from layout: the block stretches from a phone column to
  // the content cap, and the geometry has to be in real pixels for the stroke to
  // stay 2px (a viewBox scaled to fit would stretch it along with the chart).
  const [size, setSize] = useState({ width: 0, height: MinChartHeight });

  function onLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height: Math.max(height, MinChartHeight) });
  }

  // CTL is a 42-day exponential average — already smooth, and continuous from
  // one day to the next. A line reads that as a single movement.
  //
  // The window is the series' own range rather than zero-based: three months of
  // fitness live inside a narrow band, and anchoring to zero pressed the whole
  // story into the top fifth of the box. That licence belongs to lines alone —
  // a filled area or a bar states its value through its height and would be
  // lying on a cropped scale (DESIGN.md). The size of the move is written above
  // the curve in plain numbers, so the shape never carries the magnitude alone.
  const values = series.map((day) => day.ctl);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, MinRange);
  const floor = (low + high) / 2 - range / 2;

  const lastIndex = series.length - 1;
  const plotWidth = Math.max(size.width - ChartPad, 1);

  const x = (index: number) => (lastIndex === 0 ? plotWidth : (index / lastIndex) * plotWidth);
  const y = (ctl: number) => ChartPad + (1 - (ctl - floor) / range) * (size.height - 2 * ChartPad);

  const points = series.map((day, index) => `${x(index).toFixed(1)},${y(day.ctl).toFixed(1)}`);
  const line = `M${points.join('L')}`;

  return (
    <View
      style={styles.chart}
      onLayout={onLayout}
      accessibilityRole="image"
      accessibilityLabel={`Caisse de fond sur 90 jours. ${trendSentence(series)}.`}>
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height}>
          <Path
            d={line}
            stroke={theme.ruleStrong}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Today reads through brightness, never a signal ink: a trend line is
              a read-out, not a load state. */}
          <Circle cx={x(lastIndex)} cy={y(series[lastIndex].ctl)} r={MarkerRadius} fill={theme.ink} />
        </Svg>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: Spacing.two,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  help: {
    // 44pt for real — hitSlop doesn't apply on web.
    minHeight: 44,
    justifyContent: 'center',
  },
  chart: {
    minHeight: MinChartHeight,
    flexGrow: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: t.rule,
  },
  stat: {
    gap: Spacing.half,
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: t.rule,
  },
  ctaButton: {
    paddingTop: Spacing.two,
  },
}));
