import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import type { GenerationPhase } from '@/lib/use-plan-generation';

/**
 * What a plan generation looks like while you wait for it.
 *
 * Generation is three to six minutes of model time. A bare spinner over that
 * span reads as a crash — the user's next move is to reload or tap again, which
 * is the one thing that helps least. Three things fix that, and none of them is
 * a faster generation: a phase that changes ("En attente…" → "Génération en
 * cours…"), a counter that visibly moves, and an up-front order of magnitude,
 * because an announced three minutes is a wait and an unannounced one is a bug.
 *
 * Also says the wait can be abandoned, which is true: the job runs server-side,
 * the id survives a reload, and a notification lands when the plan is ready.
 */
export function GenerationProgress({
  phase,
  elapsedSeconds,
}: {
  phase: GenerationPhase;
  elapsedSeconds: number | null;
}) {
  if (phase === 'idle') return null;

  const heading = phase === 'queued' ? 'En attente…' : 'Génération en cours…';

  return (
    <View style={styles.card} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
      <View style={styles.headRow}>
        <ActivityIndicator size="small" color={Colors.blaze} />
        <ThemedText type="waypointLabel" themeColor="blaze" style={styles.heading}>
          {heading}
        </ThemedText>
        {elapsedSeconds != null ? (
          <ThemedText type="waypointLabel" themeColor="textSecondary">
            {formatElapsed(elapsedSeconds)}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {phase === 'queued'
          ? 'Ta demande est dans la file. Le modèle va écrire 12 à 16 semaines de séances : compte trois à six minutes.'
          : 'Le modèle écrit 12 à 16 semaines de séances, puis chaque semaine est vérifiée. Compte trois à six minutes — c’est normal.'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Tu peux fermer l’app : la génération continue et tu seras notifié quand le plan est prêt.
      </ThemedText>
    </View>
  );
}

/** "0:47", then "2 min 05". Seconds stay visible the whole way: they are the
 * proof that something is still moving. */
function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${seconds.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Rounded.md,
    borderWidth: 1,
    borderColor: Colors.contourFaint,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  heading: {
    flex: 1,
  },
});
