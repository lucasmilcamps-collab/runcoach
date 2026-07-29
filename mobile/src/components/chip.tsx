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
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: ChipTone;
  accessibilityLabel?: string;
}) {
  const accent = tone === 'hydro' ? 'hydro' : 'blaze';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={pressable([
        styles.chip,
        selected && styles.chipSelected,
        selected && { borderColor: Colors[accent] },
      ])}>
      <ThemedText type={selected ? 'link' : 'default'} themeColor={selected ? accent : 'text'}>
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
});
