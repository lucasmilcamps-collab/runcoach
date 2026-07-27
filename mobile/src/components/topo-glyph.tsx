import Svg, { Circle, G, Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

/**
 * The empty-state signature: three hand-drawn topographic contour lines with a
 * single Trail Blaze waypoint pin on the highest ring — the Night-Trail world's
 * "you are here, the route reads the terrain" idea, abstracted to signage
 * (DESIGN.md). Not a literal illustrated map, not a generic icon.
 *
 * `pin` places the marker: 'summit' (default) or 'edge' — a small, deliberate
 * variation so recurring empty states don't read as one identical stamp.
 */
export function TopoGlyph({ size = 92, pin = 'summit' }: { size?: number; pin?: 'summit' | 'edge' }) {
  // Waypoint position on the contour, chosen per variant.
  const marker = pin === 'summit' ? { cx: 57, cy: 33 } : { cx: 20, cy: 55 };

  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" fill="none">
      {/* Three nested contour rings, hairline sienna — outer faint → inner solid,
          the way relief reads denser toward a summit. */}
      <G stroke={Colors.contour} strokeWidth={1.25} fill="none" strokeLinejoin="round">
        <Path
          d="M15 49 C13 32 33 18 50 20 C71 22 87 35 85 54 C83 73 62 85 43 81 C25 77 17 65 15 49 Z"
          opacity={0.45}
        />
        <Path
          d="M27 51 C26 39 40 31 53 33 C67 35 76 45 74 57 C72 70 57 76 44 72 C33 69 28 62 27 51 Z"
          opacity={0.7}
        />
        <Path d="M39 53 C39 45 47 40 54 43 C61 46 64 52 60 59 C56 66 47 66 42 61 C40 59 39 56 39 53 Z" />
      </G>

      {/* Waypoint pin: soft warm glow (the one named glow, DESIGN.md) + a true
          circle stroked in Trail Blaze. */}
      <Circle cx={marker.cx} cy={marker.cy} r={12} fill={Colors.blaze} opacity={0.1} />
      <Circle cx={marker.cx} cy={marker.cy} r={8} fill={Colors.blaze} opacity={0.14} />
      <Circle
        cx={marker.cx}
        cy={marker.cy}
        r={4.5}
        fill={Colors.background}
        stroke={Colors.blaze}
        strokeWidth={2}
      />
      <Circle cx={marker.cx} cy={marker.cy} r={1.4} fill={Colors.blaze} />
    </Svg>
  );
}
