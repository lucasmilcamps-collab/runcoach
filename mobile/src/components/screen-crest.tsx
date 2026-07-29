import { StyleSheet, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

/**
 * The screen crest: two topographic contour lines bleeding off the top-right
 * corner, behind the header. The app's signature mark, in one place and one
 * drawing — the welcome screen used to build its own out of bordered `View`
 * ellipses while the session detail drew real contours in SVG, so the same
 * intent read as two unrelated ornaments.
 *
 * Deliberately near-subliminal: you should have to look for it. A motif at the
 * same strength on every screen stops signifying anything and turns into
 * wallpaper, and any texture behind numbers costs legibility. It sits inside
 * the content column (not the viewport edge) so it holds the same alignment
 * axis as everything else on wide screens, and never intercepts touches.
 */
export function ScreenCrest() {
  return (
    <View pointerEvents="none" style={styles.crest}>
      <Svg style={styles.drawing} width={220} height={180} viewBox="0 0 220 180" fill="none">
        <G stroke={Colors.contour} strokeWidth={1} fill="none" strokeLinejoin="round">
          <Path
            d="M30 90 C25 45 80 15 130 22 C185 30 215 70 205 115 C196 158 130 175 80 160 C40 148 35 120 30 90Z"
            opacity={0.1}
          />
          <Path
            d="M60 92 C56 60 95 40 135 47 C172 54 190 82 182 112 C174 143 128 154 90 143 C62 135 63 116 60 92Z"
            opacity={0.07}
          />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  crest: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 184,
    height: 152,
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
    top: -28,
    right: -36,
  },
});
