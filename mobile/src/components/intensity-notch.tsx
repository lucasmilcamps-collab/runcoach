import { View } from 'react-native';

import { useTheme, useZoneRamp } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';

/**
 * A session's intensity, as four notches on a rising step.
 *
 * It replaces a row of lightning bolts — gym-poster shorthand for "hard", and
 * exactly the register this product does not speak in. Notches are a
 * measurement: they rise, they are countable, and they read the same way the
 * ledger's bars do.
 *
 * The filled notches take their tone from the Z1→Z5 ramp, so intensity is
 * encoded once in the whole app rather than twice with two different palettes.
 * The level is always stated in text beside it — colour never carries a value
 * alone (DESIGN.md).
 */
export function IntensityNotch({ level, total = 4 }: { level: number; total?: number }) {
  const styles = useStyles();
  const theme = useTheme();
  const ramp = useZoneRamp();
  // Difficulty runs 0–4, the ramp Z1–Z5: a level of 4 is the top of both.
  const tone = ramp[Math.min(Math.max(level - 1, 0), 4)];

  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.notch,
            { height: 5 + i * 3, backgroundColor: i < level ? tone : theme.rule },
          ]}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  notch: {
    width: 3,
    borderRadius: 1,
  },
}));
