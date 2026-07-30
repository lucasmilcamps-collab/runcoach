import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import type { Fitness } from '@/lib/api/fitness';

function openProfileEntry() {
  router.push('/fitness-profile');
}

export function FitnessCard({
  fitness,
  isLoading,
}: {
  fitness: Fitness | undefined;
  isLoading: boolean;
}) {
  const [showHelp, setShowHelp] = useState(false);

  if (isLoading && !fitness) {
    return (
      <View style={[styles.card, styles.centered]}>
        <ActivityIndicator color={Colors.contour} />
      </View>
    );
  }

  if (!fitness || !fitness.has_profile || fitness.series.length === 0) {
    const missingProfile = fitness ? !fitness.has_profile : false;
    return (
      <View style={styles.card}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Forme
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {missingProfile
            ? 'Pour calculer votre forme, il faut votre fréquence cardiaque de repos et maximale. Garmin ne les fournit pas ici — renseignez-les à la main.'
            : 'Pas encore assez de séances avec fréquence cardiaque pour estimer votre forme.'}
        </ThemedText>
        {/* The only heart-rate entry point left on this card, and it stays: with
            no profile there is nothing to show, so this is a blocker, not a
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
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Forme
        </ThemedText>
        <Pressable
          onPress={() => setShowHelp((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Qu’est-ce que la forme ?"
          accessibilityState={{ expanded: showHelp }}
          style={pressable(styles.help)}>
          <ThemedText type="small" themeColor="textSecondary">
            {showHelp ? 'Masquer' : 'C’est quoi ?'}
          </ThemedText>
        </Pressable>
      </View>

      {/* The readiness hero states the current form value and verdict; this card
          is the trend read-out behind it, so it doesn't repeat that line. */}
      {showHelp ? (
        <ThemedText type="small" themeColor="textSecondary">
          Ta forme = ta caisse de fond (l’endurance accumulée) moins ta fatigue récente. Positif :
          tu es reposé ; négatif : tu encaisses encore la charge des dernières séances.
        </ThemedText>
      ) : null}

      <View style={styles.chartBlock}>
        <View style={styles.chartHeader}>
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            Caisse de fond — 90 jours
          </ThemedText>
          {/* The shape alone left the reader to work out the direction. The
              chart now says it outright and the curve backs it up. */}
          <ThemedText type="small" themeColor="text">
            {trendSentence(fitness.series)}
          </ThemedText>
        </View>
        <FitnessTrend series={fitness.series} />
      </View>

      <View style={styles.statsRow}>
        <Stat label="Base 42 j" value={Math.round(fitness.ctl)} />
        <View style={styles.statDivider} />
        <Stat label="Fatigue 7 j" value={Math.round(fitness.atl)} />
      </View>

      {fitness.low_confidence ? (
        <ThemedText type="small" themeColor="textSecondary">
          Historique limité : l’estimation s’affinera au fil des semaines.
        </ThemedText>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle">{value}</ThemedText>
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

const ChartHeight = 60;
// Room for the endpoint marker, which the viewport would otherwise clip on the
// right and at the top when the series peaks on its last day.
const MarkerRadius = 4;
const ChartPad = MarkerRadius + 1;
// Smallest CTL window the chart will scale to. Fitness moves by a couple of
// points over a quiet month, and fitting the view to that would blow the noise
// up into a mountain range — a flat stretch has to keep looking flat.
const MinRange = 6;

function FitnessTrend({ series }: { series: Fitness['series'] }) {
  // Width comes from layout: the card stretches from a phone column to the
  // content cap, and the geometry has to be in real pixels for the stroke to
  // stay 2px (a viewBox scaled to fit would stretch it along with the chart).
  const [width, setWidth] = useState(0);

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  // CTL is a 42-day exponential average — already smooth, and continuous from
  // one day to the next. A line reads that as a single movement; the 90 bars it
  // replaces implied 90 separate quantities you were meant to compare one by one.
  //
  // The window is the series' own range rather than zero-based: three months of
  // fitness live inside a narrow band, and anchoring to zero pressed the whole
  // story into the top fifth of the box. That licence belongs to lines alone —
  // a filled area or a bar states its value through its height and would be
  // lying on a cropped scale, which is why neither appears here. The size of the
  // move is written above the curve in plain numbers, so the shape never has to
  // carry the magnitude on its own.
  const values = series.map((day) => day.ctl);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, MinRange);
  const floor = (low + high) / 2 - range / 2;

  const lastIndex = series.length - 1;
  const plotWidth = Math.max(width - ChartPad, 1);

  const x = (index: number) => (lastIndex === 0 ? plotWidth : (index / lastIndex) * plotWidth);
  const y = (ctl: number) =>
    ChartPad + (1 - (ctl - floor) / range) * (ChartHeight - 2 * ChartPad);

  const points = series.map((day, index) => `${x(index).toFixed(1)},${y(day.ctl).toFixed(1)}`);
  const line = `M${points.join('L')}`;

  return (
    <View
      style={styles.chart}
      onLayout={onLayout}
      accessibilityRole="image"
      accessibilityLabel={`Caisse de fond sur 90 jours. ${trendSentence(series)}.`}>
      {width > 0 ? (
        <Svg width={width} height={ChartHeight}>
          <Path
            d={line}
            stroke={Colors.contour}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Today reads through brightness, not the blaze accent — blaze stays
              reserved for the current position / primary action on the screen. */}
          <Circle
            cx={x(lastIndex)}
            cy={y(series[lastIndex].ctl)}
            r={MarkerRadius}
            fill={Colors.text}
          />
        </Svg>
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
  chartBlock: {
    // The caption belongs to the chart, so it sits closer to it than the card's
    // section gap — one block, not two neighbours.
    gap: Spacing.two,
  },
  chartHeader: {
    gap: Spacing.half,
  },
  chart: {
    height: ChartHeight,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
  },
  stat: {
    gap: Spacing.half,
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: Colors.contourFaint,
  },
  ctaButton: {
    paddingTop: Spacing.two,
  },
});
