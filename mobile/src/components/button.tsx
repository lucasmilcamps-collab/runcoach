import { ActivityIndicator, Pressable, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';

type ButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  variant?: 'primary' | 'ghost';
  loading?: boolean;
};

/**
 * The primary action is a neutral high-contrast fill — Ink on Graphite,
 * near-black on Sable — never one of the signal inks.
 *
 * That is the rule the whole palette rests on (DESIGN.md, The Signal Is Never A
 * Command): Go, Prudence and Récup say something about the athlete's training
 * load, and the moment a button is green, "green" stops meaning "this is today's
 * key session" and starts meaning "tap me". A screen can then carry three
 * signals at once without any of them competing with its one action.
 */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const styles = useStyles();
  const theme = useTheme();
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
        state.pressed &&
          !isDisabled &&
          (variant === 'primary' ? styles.primaryPressed : styles.ghostPressed),
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.surface : theme.ink} />
      ) : (
        <ThemedText
          type="link"
          // Disabled is checked first: a disabled primary would otherwise keep
          // the Ink fill's surface-coloured label on the muted disabled fill,
          // which is all but invisible.
          themeColor={isDisabled ? 'inkMuted' : variant === 'primary' ? 'surface' : 'ink'}
          // The Pressable centres the text block, not the lines inside it — so a
          // label that wraps ("Synchroniser Garmin" in a half-width button) came
          // out ragged-left against a centred box.
          style={styles.label}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  label: {
    textAlign: 'center',
  },
  base: {
    minHeight: 52,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  primary: {
    backgroundColor: t.ink,
  },
  primaryPressed: {
    backgroundColor: t.inkPressed,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: t.ruleStrong,
  },
  ghostPressed: {
    backgroundColor: t.inset,
  },
  disabled: {
    backgroundColor: t.inset,
    borderWidth: 0,
  },
}));
