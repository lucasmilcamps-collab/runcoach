import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Standard pressed feedback (a short opacity dip) for custom Pressables, so
 * every tappable surface reacts to touch like the Button does — react-native
 * Pressable has no default feedback (ui-ux-pro-max: press-feedback / Touch).
 *
 *   <Pressable style={pressable(styles.card)} onPress={…} />
 */
export function pressable(base: StyleProp<ViewStyle>) {
  return ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> =>
    pressed ? [base, { opacity: 0.6 }] : base;
}
