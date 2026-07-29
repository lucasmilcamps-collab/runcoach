import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useIsWide } from '@/hooks/use-breakpoint';

/**
 * Lays a stack of cards out in a single column on phones and two balanced
 * columns on wide viewports (desktop web / tablet). Cards are distributed by
 * index parity (0,2,4 → left · 1,3,5 → right) so a tall card on one side
 * doesn't drag the whole layout.
 *
 * Falls back to a single column when wide but there's only one card, so a lone
 * card never sits in a half-width strip beside dead space.
 */
export function CardColumns({
  children,
  gap = Spacing.four,
}: {
  children: ReactNode;
  gap?: number;
}) {
  const wide = useIsWide();
  const items = Children.toArray(children).filter(Boolean);

  if (!wide || items.length < 2) {
    return <View style={{ gap }}>{items}</View>;
  }

  const left = items.filter((_, i) => i % 2 === 0);
  const right = items.filter((_, i) => i % 2 === 1);

  return (
    <View style={[styles.row, { gap }]}>
      <View style={[styles.col, { gap }]}>{left}</View>
      <View style={[styles.col, { gap }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  col: {
    flex: 1,
  },
});
