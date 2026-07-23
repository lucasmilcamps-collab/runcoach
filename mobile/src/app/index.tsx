import { Redirect } from 'expo-router';

import { useAuthStore } from '@/lib/stores/auth-store';

export default function Index() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const onboardingComplete = useAuthStore((state) => state.onboardingComplete);

  if (!accessToken) return <Redirect href="/welcome" />;
  if (!onboardingComplete) return <Redirect href="/garmin-connect" />;
  return <Redirect href="/dashboard" />;
}
