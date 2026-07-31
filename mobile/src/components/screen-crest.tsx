import { StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { useIsWide } from '@/hooks/use-breakpoint';

// Wide and tall enough for the whole mark: at 184×152 the two tiles could not
// both fit on the mark's diagonal, and one was always reduced to a fragment.
const FRAME_W = 200;
const FRAME_H = 190;

const TILE = 120;
// The same corner ratio as the mark (15 on a 54 tile), so the crest and the
// icon are one shape at two scales rather than two similar shapes.
const RADIUS = Math.round(TILE * (15 / 54));

/**
 * The screen crest: the Mosa mark at large scale, bleeding off the top-right
 * corner, behind the header.
 *
 * It used to be two topographic contour blobs — a motif from the design world
 * rather than from the brand, so the thing you saw on every screen and the
 * thing on the app icon had nothing to do with each other. It is now the same
 * two overlapping tiles, and the watermark and the mark are one drawing.
 *
 * The overlap is what makes it read as the mark rather than as two loose
 * squares, so it is filled — faintly, since it is the only solid area on a page
 * outside a card.
 *
 * Still restrained: it sits behind everything, never intercepts touches, and
 * carries no Blaze. It appears on every screen, and an accent repeated
 * everywhere stops meaning "act here". It also sits inside the content column
 * rather than at the viewport edge, so it holds the same alignment axis as the
 * rest of the page on wide screens.
 */
export function ScreenCrest() {
  // A phone's content column is ~342pt wide: at full size the mark covered more
  // than half of it and ran behind the name and the week range in the header.
  // The viewBox is unchanged, so this scales the drawing rather than redrawing
  // it — the crest and the icon stay the same shape at every width.
  const scale = useIsWide() ? 1 : 0.72;

  return (
    <View
      pointerEvents="none"
      style={[styles.crest, { width: FRAME_W * scale, height: FRAME_H * scale }]}>
      <Svg
        style={[styles.drawing, { top: -30 * scale, right: -40 * scale }]}
        width={240 * scale}
        height={220 * scale}
        viewBox="0 0 240 220"
        fill="none">
        <Defs>
          <ClipPath id="crest-a">
            <Rect x={30} y={10} width={TILE} height={TILE} rx={RADIUS} />
          </ClipPath>
        </Defs>
        {/* Same diagonal as the mark — upper-left tile, then lower-right — with
            each clipped just enough by the corner to sit in it rather than on
            it. An earlier pass ran the top tile off the corner and left a bare
            L-shaped fragment: two offcuts, not a monogram. */}
        <Rect
          x={30}
          y={10}
          width={TILE}
          height={TILE}
          rx={RADIUS}
          stroke={Colors.contour}
          strokeWidth={1.5}
          opacity={0.34}
        />
        <Rect
          x={104}
          y={84}
          width={TILE}
          height={TILE}
          rx={RADIUS}
          stroke={Colors.contour}
          strokeWidth={1.5}
          opacity={0.24}
        />
        <Rect
          x={104}
          y={84}
          width={TILE}
          height={TILE}
          rx={RADIUS}
          fill={Colors.contour}
          opacity={0.14}
          clipPath="url(#crest-a)"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  crest: {
    position: 'absolute',
    top: 0,
    right: 0,
    // The drawing bleeds off the corner, but it must not push the page wider:
    // hanging it on negative offsets added up to 36px of horizontal scroll on
    // every screen. The frame clips instead, so the bleed is free.
    overflow: 'hidden',
    // No negative zIndex: on react-native-web that can drop the crest behind
    // the parent's own background and make it vanish. Rendering it as the first
    // child is enough to keep it under everything else.
  },
  drawing: {
    position: 'absolute',
  },
});
