import { useEffect } from 'react';
import { useFonts, AzeretMono_500Medium } from '@expo-google-fonts/azeret-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppearance, useTheme } from '@/hooks/use-theme';
import { registerServiceWorker } from '@/lib/push';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ AzeretMono_500Medium });
  const hydrate = useAuthStore((state) => state.hydrate);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);
  const preferencesHydrated = usePreferencesStore((state) => state.isHydrated);
  const appearance = useAppearance();
  const theme = useTheme();

  useEffect(() => {
    hydrate();
    hydratePreferences();
  }, [hydrate, hydratePreferences]);

  // Registered here rather than on the dashboard: the worker caches the app
  // shell, so it has to be installed whichever screen the PWA was opened on —
  // a user who lands on Séances and then loses the network was previously left
  // with no cache at all. No-op on native.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // The web shell lives outside React's tree: the document background (visible
  // when the standalone PWA rubber-bands past its content), the browser/OS UI
  // tint, and the CSS focus ring all have to follow the active appearance, and
  // none of them can read a JS palette on their own. `+html.tsx` sets the boot
  // values from `prefers-color-scheme`; this moves them when the athlete pins an
  // appearance in Réglages.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.setProperty('--focus-ring', theme.ink);
    root.style.backgroundColor = theme.surface;
    document.body.style.backgroundColor = theme.surface;
    root.style.colorScheme = appearance === 'sable' ? 'light' : 'dark';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme.surface);
  }, [appearance, theme.ink, theme.surface]);

  const ready = fontsLoaded && isHydrated && preferencesHydrated;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Preferences are awaited too: rendering before they land would paint the
  // whole app in the system appearance and then flip it a frame later for
  // anyone who pinned the other one.
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={appearance === 'sable' ? 'dark' : 'light'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.surface },
          }}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
