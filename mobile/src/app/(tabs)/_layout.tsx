import { useQuery } from '@tanstack/react-query';
import { Redirect, Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';
import { MaxContentWidthWide, TabBarHeight, typeSize } from '@/constants/theme';
import { useClampedFontScale } from '@/hooks/use-font-scale';
import { getReconciliation } from '@/lib/api/reconcile';
import { qk } from '@/lib/query-keys';

/**
 * Three tabs (Accueil / Séances / Activités). Settings and the detail screens
 * land as their own stack routes reachable from here (api-conventions), not as
 * additional tabs invented ahead of the surfaces they'd belong to.
 */
/** Tab glyph: stroke icon that inherits the bar's active/inactive tint, so the
 * icon and its label always read as one state. Decorative — the label beside it
 * is the accessible name, so the icon must not add a second one. */
function tabIcon(name: IconName) {
  return function TabBarIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={24} color={String(color)} />;
  };
}

export default function TabsLayout() {
  const theme = useTheme();
  // The bar height must include the bottom safe-area inset (iPhone home
  // indicator, drawn under the app because of viewport-fit=cover +
  // black-translucent): without it the labels sit behind the indicator and
  // vanish on mobile / installed PWA.
  const insets = useSafeAreaInsets();
  // The bar grows with the labels inside it, up to a point — see
  // `useClampedFontScale`.
  const fontScale = useClampedFontScale();

  // A week left unsettled makes the plan react to decisions the athlete never
  // took — adherence counts an untouched session as missed. So the tabs wait
  // until it is settled.
  //
  // Only the tabs. Settings and the other root routes stay reachable on purpose:
  // if the queue ever failed to clear, gating those too would shut someone
  // inside the app with no way even to sign out.
  //
  // And never while the query is still in flight — redirecting on `undefined`
  // would flash this screen on every cold start.
  const reconcile = useQuery({ queryKey: qk.reconcile(), queryFn: getReconciliation });
  if (reconcile.data?.has_pending) return <Redirect href="/week-reconcile" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.ink,
        tabBarInactiveTintColor: theme.inkMuted,
        // The active tab must not rely on color alone (WCAG 1.4.1): the focused
        // label also carries more weight, so it reads as active without color.
        tabBarLabel: ({ focused, color, children }) => (
          <Text style={{ fontSize: typeSize(12), fontWeight: focused ? '700' : '500', color }}>
            {children}
          </Text>
        ),
        tabBarStyle: {
          backgroundColor: theme.raised,
          borderTopColor: theme.ruleStrong,
          borderTopWidth: 1,
          height: TabBarHeight * fontScale + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom,
          // On desktop web the bar would otherwise stretch its three items
          // across the whole viewport while the content sits in a centred
          // column — the tabs then line up with nothing above them. Capping the
          // bar to the same width centres it on the same axis as the content.
          // Below the cap (phones, the PWA) this is a no-op and the bar stays
          // edge to edge.
          maxWidth: MaxContentWidthWide,
          width: '100%',
          alignSelf: 'center',
        },
      }}>
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Accueil', tabBarIcon: tabIcon('tab-home') }}
      />
      <Tabs.Screen
        name="plan"
        options={{ title: 'Séances', tabBarIcon: tabIcon('tab-sessions') }}
      />
      <Tabs.Screen
        name="activities"
        options={{ title: 'Activités', tabBarIcon: tabIcon('tab-activities') }}
      />
    </Tabs>
  );
}
