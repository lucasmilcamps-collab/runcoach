import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Icon } from '@/components/icon';
import { Rounded } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The way out of a stack screen. Every screen pushed outside the tab navigator
 * needs one: the tab bar isn't rendered there, and the installed PWA has no
 * browser chrome and no swipe-back — so a screen without this is a dead end.
 *
 * Falls back to the dashboard when there's nothing to go back to, so a deep
 * link or a refresh never strands the user either.
 */
export function BackButton() {
  const styles = useStyles();

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

const useStyles = makeStyles((t) => ({
  button: {
    // A real 44pt target — hitSlop is inert on react-native-web (PWA).
    width: 44,
    height: 44,
    // Moderate corners, like everything else in the system: the app's one true
    // circle is the avatar.
    borderRadius: Rounded.md,
    borderWidth: 1,
    borderColor: t.ruleStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
