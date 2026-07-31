import { StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

/**
 * The Mosa mark: two tiles that overlap.
 *
 * A mosaic is many pieces reading as one picture, which is this product's whole
 * argument — running and everything else you do are one training load, not a
 * headline plus some noise. Four separate tiles in a grid say the opposite:
 * four things side by side. So the pieces overlap, and the overlap is drawn in
 * its own tone: the part where the sports stop being separate.
 *
 * One blaze tile, one contour tile — the app's existing palette, not the light
 * warm one from the identity board, because only the name and the mark are
 * changing. Two shapes and not four is also what survives 16px in a browser tab.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  // A single clip of tile A, reused to paint exactly the intersection: the
  // corners where the two tiles meet are rounded on both shapes, and a plain
  // rectangle laid over the top would miss them by a pixel or two.
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id="mosa-a">
          <Rect x={6} y={6} width={54} height={54} rx={15} />
        </ClipPath>
      </Defs>
      <Rect x={6} y={6} width={54} height={54} rx={15} fill={Colors.blaze} />
      <Rect x={40} y={40} width={54} height={54} rx={15} fill={Colors.contour} />
      <Rect
        x={40}
        y={40}
        width={54}
        height={54}
        rx={15}
        fill={Colors.text}
        clipPath="url(#mosa-a)"
      />
    </Svg>
  );
}

/**
 * The mark with the name beside it.
 *
 * Set in IBM Plex Mono with wide tracking rather than a display face: the
 * design system reserves that font for things that are a measurement or a
 * position, and a wordmark is the app's own signage. Bringing in a fourth
 * typeface would be the start of replacing the type system, which is not what
 * this change is.
 */
export function Logo({ size = 40 }: { size?: number }) {
  const fontSize = Math.round(size * 0.62);
  return (
    <View style={styles.row}>
      <LogoMark size={size} />
      {/* `waypointLabel` already carries the mono face, the uppercase and the
          tracking — the wordmark is signage, so it inherits the signage type
          rather than declaring its own. Only the scale is overridden. */}
      <ThemedText
        type="waypointLabel"
        style={{ fontSize, lineHeight: Math.round(fontSize * 1.15), letterSpacing: fontSize * 0.08 }}>
        MOSA
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
});
