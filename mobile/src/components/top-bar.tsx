import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { AvatarButton } from '@/components/avatar-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { displayNameFromEmail, getMe } from '@/lib/api/auth';
import { qk } from '@/lib/query-keys';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The header of the three main tabs: the avatar, then who you are and which week
 * you're in, as one left-aligned group. No wordmark — the tab bar already says
 * where you are, and an app does not need to tell you daily which app you opened.
 *
 * `compact` is the scrolled state: the same row with a smaller avatar and a
 * single line, so a pinned header costs a thin strip rather than a tenth of the
 * screen.
 */
export function TopBar({ subtitle, compact = false }: { subtitle?: string; compact?: boolean }) {
  const styles = useStyles();
  // Shares the cache with AvatarButton — same key, so this costs no request.
  const { data } = useQuery({ queryKey: qk.me(), queryFn: getMe, staleTime: Infinity });
  const name = displayNameFromEmail(data?.email) ?? 'Relay';

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
              <ThemedText type="label" themeColor="inkMuted" numberOfLines={1}>
                {subtitle}
              </ThemedText>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
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
    borderBottomColor: t.rule,
  },
  block: {
    flex: 1,
    gap: Spacing.half,
  },
}));
