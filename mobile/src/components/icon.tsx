import Svg, { Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-left';

// Stroke icons on a 24px grid, one consistent stroke width — the vector
// replacement for the Unicode glyphs (‹ › ← ▾) so arrows render crisply and
// share the app's hairline visual language (ui-ux-pro-max: icon-style-consistent).
const PATHS: Record<IconName, string> = {
  'chevron-left': 'M15 6 9 12l6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
};

export function Icon({
  name,
  size = 20,
  color = Colors.text,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
