import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

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

  const left = items.filter((_, i) => i % 2 === 0).map(grow);
  const right = items.filter((_, i) => i % 2 === 1).map(grow);

  return (
    <View style={[styles.row, { gap }]}>
      <View style={[styles.col, { gap }]}>{left}</View>
      <View style={[styles.col, { gap }]}>{right}</View>
    </View>
  );
}

/**
 * Both columns end flush. Read side by side, a card that stops a hundred pixels
 * short of its neighbour looks like a layout that gave up rather than a pair —
 * so each card takes a share of whatever height its column has left over. Cards
 * absorb that space in their own way (the fitness curve grows into it, the week
 * ring re-centres in it); this only hands it to them.
 *
 * `flexGrow`, never `flex: 1`: the shorthand sets a zero flex-basis, which
 * would throw away the cards' content heights and split a column evenly between
 * them — a two-line strip stretched to match a chart.
 */
function grow(item: ReactNode): ReactNode {
  if (!isValidElement<{ style?: StyleProp<ViewStyle> }>(item)) return item;
  return cloneElement(item, { style: [item.props.style, styles.grow] });
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // `stretch`, so a short column still spans the row and its cards have
    // leftover height to grow into.
    alignItems: 'stretch',
  },
  col: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
});
