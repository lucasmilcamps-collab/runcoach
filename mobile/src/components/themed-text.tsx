import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'subtitle' | 'small' | 'link' | 'waypointLabel';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'subtitle' && styles.subtitle,
        type === 'small' && styles.small,
        type === 'link' && styles.link,
        type === 'waypointLabel' && styles.waypointLabel,
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
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 500,
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
  waypointLabel: {
    fontFamily: Fonts?.mono,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.04 * 12,
    textTransform: 'uppercase',
  },
});
