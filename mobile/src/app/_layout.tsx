import { useEffect } from 'react';
import { useFonts, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
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

  useEffect(() => {
    if (fontsLoaded && isHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, isHydrated]);

  if (!fontsLoaded || !isHydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
        }}
      />
    </QueryClientProvider>
  );
}
