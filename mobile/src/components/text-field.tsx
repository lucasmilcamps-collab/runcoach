import { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { makeStyles } from '@/lib/themed-styles';

type TextFieldProps = TextInputProps & {
  label: string;
  error?: string;
};

export function TextField({
  label,
  error,
  style,
  onFocus,
  onBlur,
  accessibilityLabel,
  ...rest
}: TextFieldProps) {
  const styles = useStyles();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  // Focus is neutral Ink, not a signal ink: focus is chrome, and a green ring
  // here would read as a load state (DESIGN.md).
  const borderColor = error ? theme.alerte : focused ? theme.ink : theme.ruleStrong;

  return (
    <View style={styles.container}>
      <ThemedText type="label" themeColor="inkMuted">
        {label}
      </ThemedText>
      <TextInput
        style={[styles.input, { borderColor, borderWidth: focused ? 1.5 : 1 }, style]}
        placeholderTextColor={theme.inkMuted}
        // The visible label is a sibling <Text>, which assistive tech has no way
        // to associate with this input — so name the input explicitly, and let
        // the error be announced with it rather than read as loose text.
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={error}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...rest}
      />
      {error ? (
        <ThemedText type="small" themeColor="alerte">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: Spacing.one,
  },
  input: {
    minHeight: 48,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.three,
    backgroundColor: t.raised,
    color: t.ink,
    fontSize: 16,
  },
}));
