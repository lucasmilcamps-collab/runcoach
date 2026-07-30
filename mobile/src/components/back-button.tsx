import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/components/icon';
import { Colors } from '@/constants/theme';
import { pressable } from '@/lib/pressable';

/**
 * The way out of a stack screen. Every screen pushed outside the tab navigator
 * needs one: the tab bar isn't rendered there, and the installed PWA has no
 * browser chrome and no swipe-back — so a screen without this is a dead end
 * (plan history and a plan version both were).
 *
 * Falls back to the dashboard when there's nothing to go back to, so a deep
 * link or a refresh never strands the user either.
 */
export function BackButton() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/dashboard'))}
      accessibilityRole="button"
      accessibilityLabel="Retour"
      style={pressable(styles.button)}>
      <Icon name="arrow-left" size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    // A real 44pt target — hitSlop is inert on react-native-web (PWA).
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.contour,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
