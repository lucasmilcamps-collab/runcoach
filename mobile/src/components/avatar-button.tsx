import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { typeSize } from '@/constants/theme';
import { getMe, initialsFromEmail } from '@/lib/api/auth';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
import { makeStyles } from '@/lib/themed-styles';

/** Avatar diameter. The compact size is the pinned-header one. */
export const AVATAR = 52;
export const AVATAR_COMPACT = 38;

/**
 * Round initials button (top-left of the main screens) that opens Réglages.
 *
 * The one true circle in a system of moderate corners: it is a portrait frame,
 * and a portrait frame reads wrong at any other radius.
 */
export function AvatarButton({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  const { data } = useQuery({ queryKey: qk.me(), queryFn: getMe, staleTime: Infinity });
  // No placeholder glyph while /me loads: a lone '·' reads as a broken avatar.
  // The empty ring is a calmer, honest loading state.
  const initials = initialsFromEmail(data?.email);
  const size = compact ? AVATAR_COMPACT : AVATAR;

  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel="Réglages"
      style={pressable([styles.avatar, { width: size, height: size, borderRadius: size / 2 }])}>
      <ThemedText
        type="label"
        themeColor="ink"
        style={compact ? styles.initialsCompact : styles.initials}>
        {initials}
      </ThemedText>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  avatar: {
    // Well past the 44pt minimum: this is the only way into Réglages.
    borderWidth: 1,
    borderColor: t.ruleStrong,
    backgroundColor: t.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontSize: typeSize(15),
    letterSpacing: 0.8,
  },
  initialsCompact: {
    fontSize: typeSize(12),
    letterSpacing: 0.6,
  },
}));
