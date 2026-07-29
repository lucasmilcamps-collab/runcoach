import Svg, { Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-left'
  | 'tab-home'
  | 'tab-sessions'
  | 'tab-activities';

// Stroke icons on a 24px grid, one consistent stroke width — the vector
// replacement for the Unicode glyphs (‹ › ← ▾) so arrows render crisply and
// share the app's hairline visual language (ui-ux-pro-max: icon-style-consistent).
//
// The three `tab-*` glyphs are drawn from the Night-Trail vocabulary rather than
// a generic icon set: a waypoint pin on a contour (home / "you are here"), a
// week grid (sessions), and a stacked list with a trail marker (activities).
const PATHS: Record<IconName, string> = {
  'chevron-left': 'M15 6 9 12l6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  // Waypoint pin above a contour line — the app's own "you are here" mark.
  'tab-home': 'M12 4a4 4 0 0 1 4 4c0 3-4 7-4 7s-4-4-4-7a4 4 0 0 1 4-4ZM4 18c2.5-1.2 5-1.2 8 0s5.5 1.2 8 0',
  // A week: a calendar grid with the current day marked.
  'tab-sessions': 'M4 6.5h16v13H4zM4 10h16M8.5 4v3M15.5 4v3M8 14.5h3',
  // Stacked entries with a leading marker — a logbook, not a bullet list.
  'tab-activities': 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01',
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
