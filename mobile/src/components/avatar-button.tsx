import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';

/** Avatar diameter. Bigger now that it heads a block rather than floating alone
 * in a corner; the compact size is the pinned-header one. */
export const AVATAR = 60;
export const AVATAR_COMPACT = 40;
import { getMe, initialsFromEmail } from '@/lib/api/auth';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';

/**
 * Round initials button (top-left of the main screens) that opens Settings —
 * the Campus-style entry point that replaces the Réglages tab.
 */
export function AvatarButton({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery({ queryKey: qk.me(), queryFn: getMe, staleTime: Infinity });
  // No placeholder glyph while /me loads: a lone '·' reads as a broken
  // avatar. The empty ring is a calmer, honest loading state.
  const initials = initialsFromEmail(data?.email);
  const size = compact ? AVATAR_COMPACT : AVATAR;

  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Réglages"
      style={pressable([
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ])}>
      <ThemedText
        type="waypointLabel"
        themeColor="text"
        style={compact ? styles.initialsCompact : styles.initials}>
        {initials}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    // Well past the 44pt minimum: this is the only way into Settings. Circular,
    // not the Rounded.lg squircle, which stops looking round as the box grows.
    // A 1.5px ring rather than a hairline — at 60px a 1px outline reads as a
    // faint smudge instead of a deliberate edge.
    borderWidth: 1.5,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: 17,
    letterSpacing: 0.5,
  },
  initialsCompact: {
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
