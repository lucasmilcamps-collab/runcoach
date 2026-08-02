import { useEffect } from 'react';
import { useFonts, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { registerServiceWorker } from '@/lib/push';
import { queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ IBMPlexMono_500Medium });
  const hydrate = useAuthStore((state) => state.hydrate);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);

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

  useEffect(() => {
    if (fontsLoaded && isHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isHydrated]);

  if (!fontsLoaded || !isHydrated) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.background },
          }}
        />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
