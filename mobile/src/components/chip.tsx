import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The app's one selectable chip (objectives, weekdays, durations, RPE…).
 *
 * Selected is an **outline plus weight**, never a filled accent: these appear a
 * dozen at a time on the setup forms, and a signal ink spent on "you picked
 * this" is a signal ink that no longer means anything about training load
 * (DESIGN.md). Selection is carried by three cues at once — a stronger border,
 * a raised ground and a heavier label — so it never rests on colour alone, plus
 * `accessibilityState` for assistive tech.
 */
export function Chip({
  label,
  selected,
  onPress,
  variant = 'solid',
  disabled = false,
  fill = false,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** 'dashed' marks a selection that is deliberately loose — the plan setup's
   * "jour variable". A second selected state has to be distinguishable from the
   * first without colour, so the difference is the border's shape. */
  variant?: 'solid' | 'dashed';
  /** Not choosable — e.g. the day a session already sits on. Still shows its
   * selected state, so "you are here" reads without being an offer. */
  disabled?: boolean;
  /** Share the row equally with its siblings instead of hugging its label —
   * for a fixed set that should fit on one line (the 7 weekdays). */
  fill?: boolean;
  accessibilityLabel?: string;
}) {
  const styles = useStyles();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={pressable([
        styles.chip,
        fill && styles.chipFill,
        disabled && !selected && styles.chipDisabled,
        selected && styles.chipSelected,
        selected && variant === 'dashed' && styles.chipDashed,
      ])}>
      <ThemedText
        type={selected ? 'link' : 'default'}
        themeColor={disabled && !selected ? 'inkMuted' : 'ink'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  chip: {
    minHeight: 44,
    // A one-character label ("2", "9") only comes to 43pt wide from its padding
    // alone — a pixel under the target on the narrow axis.
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.rule,
    backgroundColor: 'transparent',
  },
  chipSelected: {
    borderWidth: 1.5,
    borderColor: t.ruleStrong,
    backgroundColor: t.inset,
  },
  chipDashed: {
    borderStyle: 'dashed',
  },
  chipFill: {
    // Width comes from the row, so the label-hugging padding would only stop
    // the set fitting on one line.
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.one,
  },
  chipDisabled: {
    borderColor: t.rule,
    backgroundColor: 'transparent',
  },
}));
