import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'ghost';
  loading?: boolean;
};

export function Button({ label, variant = 'primary', loading = false, disabled, style, ...rest }: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        isDisabled && styles.disabled,
        state.pressed && !isDisabled && (variant === 'primary' ? styles.primaryPressed : styles.ghostPressed),
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.background : Colors.text} />
      ) : (
        <ThemedText
          type="link"
          themeColor={variant === 'primary' ? 'background' : isDisabled ? 'textSecondary' : 'text'}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  primary: {
    backgroundColor: Colors.blaze,
  },
  primaryPressed: {
    backgroundColor: Colors.blazeDeep,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.contour,
  },
  ghostPressed: {
    backgroundColor: Colors.backgroundElement,
  },
  disabled: {
    backgroundColor: Colors.contourFaint,
    borderWidth: 0,
  },
});
