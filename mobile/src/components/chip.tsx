import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';

export type ChipTone = 'blaze' | 'hydro';

/**
 * The app's one selectable chip (objectives, weekdays, durations, RPE…).
 *
 * Selected state is an **outline**, not a blaze fill: these controls appear a
 * dozen at a time on the setup forms, and filling each one drowned the screen's
 * primary action in orange (DESIGN.md, The One Blaze Rule — the single blaze
 * fill per screen belongs to the CTA). Selection is carried by three cues at
 * once — accent border, accent text, heavier weight — so it never rests on
 * color alone, plus `accessibilityState` for assistive tech.
 *
 * `tone` picks the accent: blaze for a normal selection, hydro for the
 * "flexible / variable" day state in the plan setup.
 */
export function Chip({
  label,
  selected,
  onPress,
  tone = 'blaze',
  disabled = false,
  fill = false,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: ChipTone;
  /** Not choosable — e.g. the day a session already sits on. Still shows its
   * selected state, so "you are here" reads without being an offer. */
  disabled?: boolean;
  /** Share the row equally with its siblings instead of hugging its label —
   * for a fixed set that should fit on one line (the 7 weekdays). */
  fill?: boolean;
  accessibilityLabel?: string;
}) {
  const accent = tone === 'hydro' ? 'hydro' : 'blaze';
  const color = selected ? accent : disabled ? 'textSecondary' : 'text';

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
        selected && { borderColor: Colors[accent] },
      ])}>
      <ThemedText type={selected ? 'link' : 'default'} themeColor={color}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
  },
  chipSelected: {
    borderWidth: 1.5,
    backgroundColor: Colors.backgroundSelected,
  },
  chipFill: {
    // Width comes from the row, so the label-hugging padding would only stop
    // the set fitting on one line.
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.one,
  },
  chipDisabled: {
    borderColor: Colors.contourFaint,
  },
});
