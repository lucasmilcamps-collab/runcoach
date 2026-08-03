import Svg, { Line, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/**
 * The empty-state signature: an empty ledger.
 *
 * A baseline with the week's day ticks under it and a few outlined columns
 * standing on it — the shape the screen will have once there is something to
 * post to it. Signage drawn in the app's own vocabulary, not a generic
 * illustration and not a shrug emoji.
 *
 * `variant` gives recurring empty states a small, deliberate difference so they
 * don't read as one stamp repeated: 'ledger' is the week, 'handover' is the
 * mark's own exchange (used where the thing missing is a connection rather than
 * a week of training).
 */
export function LedgerGlyph({
  size = 96,
  variant = 'ledger',
}: {
  size?: number;
  variant?: 'ledger' | 'handover';
}) {
  const theme = useTheme();
  const height = Math.round(size * 0.75);

  if (variant === 'handover') {
    return (
      <Svg width={size} height={height} viewBox="0 0 96 72" fill="none">
        <Rect
          x={6}
          y={40}
          width={48}
          height={14}
          rx={4}
          stroke={theme.rule}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <Rect x={42} y={18} width={48} height={14} rx={4} fill={theme.ruleStrong} opacity={0.5} />
      </Svg>
    );
  }

  // Column heights are a plausible training week — a long one, two mid, a light
  // one — rather than an even comb, which reads as a placeholder pattern.
  const columns = [
    { x: 10, h: 20 },
    { x: 27, h: 34 },
    { x: 44, h: 14 },
    { x: 61, h: 40 },
    { x: 78, h: 24 },
  ];

  return (
    <Svg width={size} height={height} viewBox="0 0 96 72" fill="none">
      {columns.map((column) => (
        <Rect
          key={column.x}
          x={column.x}
          y={52 - column.h}
          width={11}
          height={column.h}
          rx={2}
          stroke={theme.ruleStrong}
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      ))}
      <Line x1={4} y1={53} x2={92} y2={53} stroke={theme.ruleStrong} strokeWidth={1.5} />
      {columns.map((column) => (
        <Line
          key={`tick-${column.x}`}
          x1={column.x + 2}
          y1={60}
          x2={column.x + 9}
          y2={60}
          stroke={theme.ruleStrong}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}
