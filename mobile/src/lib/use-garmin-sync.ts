import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { ApiError } from '@/lib/api/client';
import { syncGarmin } from '@/lib/api/garmin';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/lib/stores/auth-store';

/**
 * Garmin sync shared by Accueil and Activités: one throttled mutation that
 * auto-fires whenever the screen gains focus (the backend rate-limits to
 * SYNC_MIN_INTERVAL and returns "skipped" instantly within the cooldown, so
 * firing on every focus is cheap), plus a derived, user-facing error message.
 */
export function useGarminSync() {
  const garminConnected = useAuthStore((s) => s.garminConnected);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: syncGarmin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.activities() });
      queryClient.invalidateQueries({ queryKey: qk.fitness() });
    },
  });

  // Written from an effect, never during render: a ref assigned mid-render is
  // not safe under a render React discards. One frame of staleness is harmless
  // here — on the first focus nothing is in flight yet.
  const syncingRef = useRef(false);
  useEffect(() => {
    syncingRef.current = mutation.isPending;
  }, [mutation.isPending]);
  useFocusEffect(
    useCallback(() => {
      if (garminConnected && !syncingRef.current) mutation.mutate();
      // mutation.mutate is stable; the ref avoids a stale isPending here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [garminConnected]),
  );

  const errorMessage = (() => {
    if (mutation.error instanceof ApiError) {
      if (mutation.error.code === 'GARMIN_UPSTREAM_ERROR') {
        return 'Garmin limite temporairement les connexions. Réessayez dans quelques minutes.';
      }
      return mutation.error.message;
    }
    if (mutation.data?.status === 'failed') {
      return mutation.data.error_message ?? 'La synchronisation a échoué.';
    }
    if (mutation.isError) return 'Impossible de contacter le serveur. Réessayez.';
    return undefined;
  })();

  return {
    sync: () => mutation.mutate(),
    isSyncing: mutation.isPending,
    errorMessage,
  };
}
