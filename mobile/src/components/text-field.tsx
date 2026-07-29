import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Rounded, Spacing } from '@/constants/theme';

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
  const [focused, setFocused] = useState(false);

  const borderColor = error ? Colors.flare : focused ? Colors.blaze : Colors.contour;

  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        style={[
          styles.input,
          { borderColor, borderWidth: focused ? 1.5 : 1 },
          style,
        ]}
        placeholderTextColor={Colors.textSecondary}
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
        <ThemedText type="small" themeColor="flare">
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
  },
  input: {
    minHeight: 48,
    borderRadius: Rounded.sm,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.backgroundElement,
    color: Colors.text,
    fontSize: 16,
  },
});
