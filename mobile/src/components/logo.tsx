import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The Relay mark: two bars, one exchange.
 *
 * The first leg ends; the second picks up where it left off and carries on past
 * it, and the gap between them is the handover. That is the product's argument
 * in two strokes — Tuesday's match hands its fatigue to Wednesday's tempo, and
 * what the app tracks is the single continuous load running through both, not a
 * headline discipline with some noise around it.
 *
 * Two bars and not a baton or a runner: the mark has to survive at 16px in a
 * browser tab, and a figurative silhouette does not. The incoming leg is drawn
 * in Ink Muted and the outgoing one in Ink, so the direction of the handover is
 * legible without a second hue — colour in this system means training load
 * (DESIGN.md), and a logo is not a load state.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  const theme = useTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* The legs overlap on x (42→58) and are separated on y: the exchange
          zone, drawn as the one place both bars are in play at once. */}
      <Rect x={6} y={58} width={52} height={20} rx={5} fill={theme.inkMuted} />
      <Rect x={42} y={22} width={52} height={20} rx={5} fill={theme.ink} />
    </Svg>
  );
}

/**
 * The mark with the name beside it.
 *
 * Set in Azeret Mono with wide tracking rather than a display face: the type
 * system already owns a signage face, and a wordmark is the app's own signage.
 * Bringing in a second face would be the first step of replacing the system.
 */
export function Logo({ size = 40 }: { size?: number }) {
  const fontSize = Math.round(size * 0.58);

  return (
    <View style={styles.row}>
      <LogoMark size={size} />
      {/* `label` already carries the mono face, the uppercase and the tracking —
          only the scale is overridden here. */}
      <ThemedText
        type="label"
        style={{
          fontSize,
          lineHeight: Math.round(fontSize * 1.15),
          letterSpacing: fontSize * 0.1,
        }}>
        Relay
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
