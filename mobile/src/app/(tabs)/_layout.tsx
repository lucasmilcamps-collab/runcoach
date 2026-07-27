import { Tabs } from 'expo-router';
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
        tabBarIcon: () => null,
        tabBarActiveTintColor: Colors.blaze,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: {
          fontSize: 15,
          fontWeight: '600',
        },
        tabBarStyle: {
          backgroundColor: Colors.backgroundElement,
          borderTopColor: Colors.contour,
          borderTopWidth: 1,
          height: 58 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
      }}>
      <Tabs.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
    </Tabs>
  );
}
