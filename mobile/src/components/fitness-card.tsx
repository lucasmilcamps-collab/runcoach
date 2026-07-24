import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { Fitness } from '@/lib/api/fitness';

function openProfileEntry() {
  router.push('/fitness-profile');
}

// Form (TSB) bands, kept deliberately coarse — this is a directional cue, not a
// prescription (no medical advice, per the project's guardrails).
function formBand(tsb: number): { word: string; color: keyof typeof Colors } {
  if (tsb > 5) return { word: 'Frais', color: 'hydro' };
  if (tsb < -25) return { word: 'Fatigue élevée', color: 'flare' };
  return { word: 'Équilibré', color: 'text' };
}

function signed(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function FitnessCard({
  fitness,
  isLoading,
}: {
  fitness: Fitness | undefined;
  isLoading: boolean;
}) {
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
          <Pressable onPress={openProfileEntry} accessibilityRole="button" style={styles.cta}>
            <ThemedText type="waypointLabel" themeColor="blaze">
              Renseigner ma fréquence cardiaque
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const band = formBand(fitness.tsb);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          Forme
        </ThemedText>
        <ThemedText type="waypointLabel" themeColor={band.color}>
          {band.word}
        </ThemedText>
      </View>

      <View style={styles.formRow}>
        <ThemedText type="title" themeColor={band.color}>
          {signed(fitness.tsb)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          équilibre charge / récupération
        </ThemedText>
      </View>

      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Forme (fitness) — 90 jours
      </ThemedText>
      <FitnessSparkline series={fitness.series} />

      <View style={styles.statsRow}>
        <Stat label="Fitness 42j" value={Math.round(fitness.ctl)} />
        <View style={styles.statDivider} />
        <Stat label="Fatigue 7j" value={Math.round(fitness.atl)} />
      </View>

      {fitness.low_confidence ? (
        <ThemedText type="small" themeColor="textSecondary">
          Historique limité : l’estimation s’affinera au fil des semaines.
        </ThemedText>
      ) : null}

      <Pressable onPress={openProfileEntry} accessibilityRole="button" style={styles.cta}>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          {fitness.manual ? 'FC saisie manuellement · modifier' : 'Ajuster ma fréquence cardiaque'}
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
  formRow: {
    gap: Spacing.half,
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
    backgroundColor: Colors.blaze,
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
    paddingTop: Spacing.one,
  },
});
