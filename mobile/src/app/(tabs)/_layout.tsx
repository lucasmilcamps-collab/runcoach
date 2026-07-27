import { Tabs } from 'expo-router';

import { Colors } from '@/constants/theme';

/**
 * A single tab for now (Dashboard). Plan / activity / settings screens land
 * as their own stack routes reachable from here (api-conventions), not as
 * additional tabs invented ahead of the surfaces they'd belong to.
 */
export default function TabsLayout() {
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
          height: 68,
          paddingTop: 10,
          paddingBottom: 12,
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
