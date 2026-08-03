import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'tab-home'
  | 'tab-sessions'
  | 'tab-activities';

// Stroke icons on a 24px grid at one consistent weight — the app draws its own
// rather than pulling in an icon font, so the glyphs share the hairline of the
// rules and bars around them (DESIGN.md: structure comes from lines).
//
// The three `tab-*` glyphs come from Relay's own vocabulary: the ledger itself
// (loads standing on one baseline), a week of days, and a logbook.
const PATHS: Record<IconName, string> = {
  'chevron-left': 'M15 6 9 12l6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  check: 'M4 12.5 9.5 18 20 6.5',
  // The ledger: three loads standing on one shared baseline — the product's
  // whole argument, at 24px.
  'tab-home': 'M4 20h16M8 20v-6M12 20v-11M16 20v-4',
  // A week: seven days in a frame, with one of them marked.
  'tab-sessions': 'M4 6.5h16v13H4zM4 10.5h16M8 4v3M16 4v3M7.5 15h3',
  // A logbook: entries against a margin rule.
  'tab-activities': 'M7 4v16M10.5 8h9M10.5 12h9M10.5 16h5.5',
};

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const theme = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={color ?? theme.ink}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
