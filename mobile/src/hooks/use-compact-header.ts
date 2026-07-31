import { useCallback, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// Hysteresis, not a single threshold: a bare `offset > N` flips back and forth
// while a finger rests near the boundary, and the header flickers.
const COLLAPSE_AT = 20;
const EXPAND_AT = 6;

/**
 * Drives the pinned header's collapsed state on the three main tabs.
 *
 * The header lives outside the ScrollView so it stays put while the body moves
 * — that part is layout, not scroll handling. This only decides whether it
 * shows its full two-line self or the thin strip.
 */
export function useCompactHeader() {
  const [compact, setCompact] = useState(false);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    setCompact((was) => (was ? offset > EXPAND_AT : offset > COLLAPSE_AT));
  }, []);

  return { compact, onScroll };
}
