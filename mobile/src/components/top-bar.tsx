import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { AvatarButton } from '@/components/avatar-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { displayNameFromEmail, getMe } from '@/lib/api/auth';

/**
 * The header of the three main tabs: the avatar, then who you are and which
 * week you're in, as one left-aligned group.
 *
 * It used to centre a "RUNCOACH" wordmark with the avatar floating alone in the
 * far corner — a small circle adrift in a wide empty band, above an app telling
 * you daily which app you had opened. The wordmark is gone from the tabs (the
 * tab bar already says where you are); the avatar now anchors a block carrying
 * the only two things worth a permanent line.
 *
 * `compact` is the scrolled state: the same row with a smaller avatar and a
 * single line, so a pinned header costs a thin strip rather than a tenth of the
 * screen.
 */
export function TopBar({ subtitle, compact = false }: { subtitle?: string; compact?: boolean }) {
  // Shares the cache with AvatarButton — same key, so this costs no request.
  const { data } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: Infinity });
  const name = displayNameFromEmail(data?.email) ?? 'RunCoach';

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <AvatarButton compact={compact} />
      <View style={styles.block}>
        {compact ? (
          // Collapsed, the week range takes the one remaining line: it is the
          // half that changes, and the avatar already carries who you are.
          <ThemedText type="default" numberOfLines={1}>
            {subtitle ?? name}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="subtitle" numberOfLines={1}>
              {name}
            </ThemedText>
            {subtitle ? (
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {subtitle}
              </ThemedText>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  rowCompact: {
    paddingTop: Spacing.one,
    paddingBottom: Spacing.one,
    // A hairline is what tells a pinned bar from content that happens to sit at
    // the top — without it, a stuck header just looks like it failed to scroll.
    borderBottomWidth: 1,
    borderBottomColor: Colors.contourFaint,
  },
  block: {
    flex: 1,
    gap: Spacing.half,
  },
});
