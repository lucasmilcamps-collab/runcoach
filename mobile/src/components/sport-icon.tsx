import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';
import type { SportType } from '@/lib/api/types';

/**
 * One stroke glyph per sport, so a week of sessions can be scanned rather than
 * read: the running sessions form a recognisable column and the cross-training
 * days break it. Same in-house vocabulary as `icon.tsx` — 24px grid, 1.75
 * stroke, no emoji and no icon font (DESIGN.md).
 *
 * The glyph never carries the meaning on its own: every card that shows one
 * also names the sport in text, so this is a scanning aid, not a label.
 */
export function SportIcon({
  sport,
  size = 22,
  color,
}: {
  sport: SportType;
  size?: number;
  color?: string;
}) {
  const theme = useTheme();
  const tint = color ?? theme.inkMuted;
  const stroke = {
    stroke: tint,
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {sport === 'RUN' ? (
        <>
          <Circle cx={14.8} cy={5} r={2.1} {...stroke} />
          <Path d="M10.5 11.5 13.6 9.6 15.6 12.4 13.9 15.6" {...stroke} />
          <Path d="M13.9 15.6 10.6 20.8" {...stroke} />
          <Path d="M13.9 15.6 17.4 17.6 17.6 21" {...stroke} />
          <Path d="M15.6 12.4 19.2 11.2" {...stroke} />
        </>
      ) : null}

      {sport === 'BASKETBALL' ? (
        <>
          <Circle cx={12} cy={12} r={8.2} {...stroke} />
          <Path d="M3.8 12H20.2" {...stroke} />
          <Path d="M12 3.8V20.2" {...stroke} />
          <Path d="M6.2 6.2c2.6 2.6 2.6 9 0 11.6" {...stroke} />
          <Path d="M17.8 6.2c-2.6 2.6-2.6 9 0 11.6" {...stroke} />
        </>
      ) : null}

      {sport === 'PADEL' ? (
        <>
          <Circle cx={12} cy={8.6} r={5.6} {...stroke} />
          <Path d="M12 14.2V20.4" {...stroke} />
          <Path d="M10.1 20.4h3.8" {...stroke} />
        </>
      ) : null}

      {sport === 'BIKE' ? (
        <>
          <Circle cx={5.6} cy={16.6} r={3.6} {...stroke} />
          <Circle cx={18.4} cy={16.6} r={3.6} {...stroke} />
          <Path d="M5.6 16.6h4.8L14.6 9l3.8 7.6" {...stroke} />
          <Path d="M13 9h3.4" {...stroke} />
        </>
      ) : null}

      {sport === 'STRENGTH' ? (
        <>
          <Path d="M3.6 9.6v4.8" {...stroke} />
          <Path d="M6.8 7.4v9.2" {...stroke} />
          <Path d="M17.2 7.4v9.2" {...stroke} />
          <Path d="M20.4 9.6v4.8" {...stroke} />
          <Path d="M6.8 12h10.4" {...stroke} />
        </>
      ) : null}

      {/* Anything the backend files under OTHER (ski, natation, rando…) gets the
          neutral dot rather than a wrong sport's glyph. */}
      {sport === 'OTHER' ? (
        <>
          <Circle cx={12} cy={12} r={7.2} {...stroke} />
          <Circle cx={12} cy={12} r={1.9} fill={tint} />
        </>
      ) : null}
    </Svg>
  );
}
