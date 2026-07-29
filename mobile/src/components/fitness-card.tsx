import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

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
          hitSlop={12}
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

      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Caisse de fond — 90 jours
      </ThemedText>
      <FitnessSparkline series={fitness.series} />

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

      <Pressable
        onPress={openProfileEntry}
        accessibilityRole="button"
        accessibilityLabel={
          fitness.manual ? 'Modifier ma fréquence cardiaque' : 'Ajuster ma fréquence cardiaque'
        }
        style={pressable(styles.cta)}>
        <ThemedText type="link" themeColor="text">
          {fitness.manual ? 'FC saisie manuellement — modifier' : 'Ajuster ma fréquence cardiaque'}
        </ThemedText>
        <ThemedText type="link" themeColor="textSecondary">
          ›
        </ThemedText>
      </Pressable>
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

function FitnessSparkline({ series }: { series: Fitness['series'] }) {
  // Plot CTL (fitness) — the smooth trend that reads as "form over 90 days",
  // rather than spiky daily load.
  const maxCtl = Math.max(...series.map((d) => d.ctl), 1);
  const lastIndex = series.length - 1;

  return (
    <View style={styles.sparkline} accessibilityLabel="Forme (fitness) sur 90 jours">
      {series.map((day, index) => {
        const heightPct = Math.max((day.ctl / maxCtl) * 100, 3);
        const isLast = index === lastIndex;
        return (
          <View key={day.day} style={styles.barSlot}>
            <View
              style={[styles.bar, { height: `${heightPct}%` }, isLast ? styles.barLast : styles.barActive]}
            />
          </View>
        );
      })}
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
    minHeight: 24,
    justifyContent: 'center',
  },
  sparkline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 44,
    gap: 1,
  },
  barSlot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 1,
    minHeight: 2,
  },
  barActive: {
    backgroundColor: Colors.contour,
  },
  barLast: {
    // "Today" reads through brightness, not the blaze accent — blaze stays
    // reserved for the current position / primary action on the screen.
    backgroundColor: Colors.text,
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
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  ctaButton: {
    paddingTop: Spacing.two,
  },
});
