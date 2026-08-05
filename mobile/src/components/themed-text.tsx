import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, typeSize, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Every piece of text in Relay comes from this table — six steps and no seventh
 * (DESIGN.md). `label` and `figure` are the two jobs Azeret Mono carries:
 * uppercase signage, and numbers under comparison.
 *
 * Every size goes through `typeSize`, so the whole scale follows the reader's
 * own text-size setting on both platforms rather than only on native.
 */
export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'subtitle' | 'small' | 'link' | 'label' | 'figure';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'ink'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'subtitle' && styles.subtitle,
        type === 'small' && styles.small,
        type === 'link' && styles.link,
        type === 'label' && styles.label,
        type === 'figure' && styles.figure,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: typeSize(16),
    lineHeight: typeSize(22),
    fontWeight: 400,
  },
  title: {
    fontSize: typeSize(28),
    lineHeight: typeSize(34),
    fontWeight: 600,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: typeSize(20),
    lineHeight: typeSize(26),
    fontWeight: 600,
    letterSpacing: -0.2,
  },
  small: {
    fontSize: typeSize(13),
    lineHeight: typeSize(18),
    fontWeight: 400,
  },
  link: {
    fontSize: typeSize(16),
    lineHeight: typeSize(22),
    fontWeight: 600,
  },
  label: {
    fontFamily: Fonts?.mono,
    fontSize: typeSize(12),
    lineHeight: typeSize(16),
    letterSpacing: 0.06 * 12,
    textTransform: 'uppercase',
  },
  figure: {
    fontFamily: Fonts?.mono,
    fontSize: typeSize(20),
    lineHeight: typeSize(26),
    // The functional reason the mono is in the system at all: a week of loads
    // stacked in a column has to align, and a proportional face makes "112"
    // narrower than "998" (DESIGN.md, The Measurement Rule).
    fontVariant: ['tabular-nums'],
  },
});
