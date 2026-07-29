import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { Fitness } from '@/lib/api/fitness';
import type { TodaySession } from '@/lib/api/plans';
import { formBand, signed } from '@/lib/fitness-format';
import { SESSION_LABELS, formatDuration } from '@/lib/plan-format';
import { pressable } from '@/lib/pressable';

/**
 * The Accueil hero: answers the one question a Home tab exists to answer —
 * "suis-je prêt à courir, et qu'est-ce que je fais aujourd'hui ?" — in plain
 * language, before any number. The form verdict lives here (not in the trend
 * card), and today's session is the single next move, tappable through to
 * Séances. No blaze fill: the accent stays on the current-week waymarker below
 * (the One Blaze Rule); here blaze is only the "Aujourd'hui" text kicker.
 */
export function ReadinessHero({
  fitness,
  today,
}: {
  fitness: Fitness | undefined;
  today: TodaySession | undefined;
}) {
  const hasForm = !!fitness?.has_profile && (fitness?.series.length ?? 0) > 0;
  const band = hasForm ? formBand(fitness!.tsb) : null;

  // Not-yet-connected is handled by the screen's EmptyState, so the only
  // fallback needed here is "connected, but not enough history yet".
  const verdict = band?.verdict ?? 'Ta forme s’affinera au fil de tes prochaines séances.';

  return (
    <View style={styles.card}>
      <ThemedText type="waypointLabel" themeColor="textSecondary">
        Prêt à courir ?
      </ThemedText>
      <ThemedText type="subtitle" themeColor={band?.color ?? 'text'}>
        {verdict}
      </ThemedText>
      {band ? (
        <ThemedText type="small" themeColor="textSecondary">
          Forme {signed(fitness!.tsb)} · {band.word}
        </ThemedText>
      ) : null}

      {today?.has_plan ? (
        <Pressable
          onPress={() => router.push('/plan')}
          accessibilityRole="button"
          accessibilityLabel="Voir la séance du jour"
          style={pressable(styles.today)}>
          <View style={styles.todayText}>
            <ThemedText type="waypointLabel" themeColor="blaze">
              Aujourd’hui
            </ThemedText>
            <ThemedText type="default">{nextMove(today)}</ThemedText>
          </View>
          <Icon name="chevron-right" size={20} color={Colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** One-line summary of today's move: the (possibly adjusted) session and its
 * duration, or the rest/coach message when there's no session. */
function nextMove(today: TodaySession): string {
  if (!today.has_session) return today.message ?? 'Repos aujourd’hui.';
  const adj = today.adjustment;
  const primary = today.sessions[0] ?? null;
  const type = adj?.adjusted ? adj.suggested_type : (primary?.type ?? 'easy');
  const duration = primary ? ` · ${formatDuration(primary.duration_min)}` : '';
  return `${SESSION_LABELS[type]}${duration}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    minHeight: 44,
    marginTop: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.contourFaint,
  },
  todayText: {
    flex: 1,
    gap: Spacing.half,
  },
});
