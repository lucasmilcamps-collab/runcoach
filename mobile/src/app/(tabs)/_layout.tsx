import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

/**
 * A single tab for now (Dashboard). Plan / activity / settings screens land
 * as their own stack routes reachable from here (api-conventions), not as
 * additional tabs invented ahead of the surfaces they'd belong to.
 */
export default function TabsLayout() {
  // The bar height must include the bottom safe-area inset (iPhone home
  // indicator, drawn under the app because of viewport-fit=cover +
  // black-translucent): without it the labels sit behind the indicator and
  // vanish on mobile / installed PWA.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // No icons in this app: hide the reserved icon slot so the label gets
        // the full height and stays centered (otherwise the empty icon + label
        // stack overflows the bar height and the text is clipped away).
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarActiveTintColor: Colors.blaze,
        tabBarInactiveTintColor: Colors.textSecondary,
        // The active tab must not rely on color alone (WCAG 1.4.1): the focused
        // label also carries more weight, so it reads as active without color.
        tabBarLabel: ({ focused, color, children }) => (
          <Text style={{ fontSize: 15, fontWeight: focused ? '700' : '500', color }}>
            {children}
          </Text>
        ),
        tabBarStyle: {
          backgroundColor: Colors.backgroundElement,
          borderTopColor: Colors.contour,
          borderTopWidth: 1,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
      }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="plan" options={{ title: 'Séances' }} />
      <Tabs.Screen name="activities" options={{ title: 'Activités' }} />
    </Tabs>
  );
}
