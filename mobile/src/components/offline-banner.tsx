import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { useOfflineStore } from '@/lib/stores/offline-store';

/**
 * "Hors-ligne · données du …" — shown whenever the screen is rendering a copy
 * the service worker kept rather than something just fetched.
 *
 * This is the other half of the offline cache, and the half that makes it
 * honest. A plan that adapts to yesterday's recovery is worth nothing if a
 * three-day-old session can be read as this morning's, so the cache never
 * appears without saying how old it is. Nothing here is an error state: the
 * content below is usable, it simply has a date on it.
 *
 * Renders nothing when the last read came from the network, which is the
 * normal case — including on native, where no service worker exists and
 * `cachedAt` therefore never leaves null.
 */
export function OfflineBanner() {
  const cachedAt = useOfflineStore((s) => s.cachedAt);
  if (!cachedAt) return null;

  return (
    <View
      style={styles.banner}
      accessibilityRole="alert"
      accessibilityLabel={`Hors-ligne. Données enregistrées le ${formatCachedAt(cachedAt)}.`}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        Hors-ligne · données du {formatCachedAt(cachedAt)}
      </ThemedText>
    </View>
  );
}

/** Day and time both matter here: "du 2 août" alone reads as current on the day
 * itself, which is exactly the morning this banner exists for. */
function formatCachedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'date inconnue';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    // Contour hairline on the elevated ground, like every other read-out in the
    // app. Not flare: being offline is a fact about the network, not a fault to
    // colour red, and the accent belongs to the screen's one action.
    borderColor: Colors.contourFaint,
    backgroundColor: Colors.backgroundElement,
  },
  text: {
    flex: 1,
  },
});
