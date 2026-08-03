import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Every piece of text in Relay comes from this table — six steps and no seventh
 * (DESIGN.md). `label` and `figure` are the two jobs Azeret Mono carries:
 * uppercase signage, and numbers under comparison.
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
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 400,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 600,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
    letterSpacing: -0.2,
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: 400,
  },
  link: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  label: {
    fontFamily: Fonts?.mono,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.06 * 12,
    textTransform: 'uppercase',
  },
  figure: {
    fontFamily: Fonts?.mono,
    fontSize: 20,
    lineHeight: 26,
    // The functional reason the mono is in the system at all: a week of loads
    // stacked in a column has to align, and a proportional face makes "112"
    // narrower than "998" (DESIGN.md, The Measurement Rule).
    fontVariant: ['tabular-nums'],
  },
});
