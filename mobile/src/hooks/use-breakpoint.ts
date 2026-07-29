import { useWindowDimensions } from 'react-native';

import { WideBreakpoint } from '@/constants/theme';

/**
 * True when the viewport is wide enough (tablet landscape / desktop web) for a
 * two-column dashboard layout. Reacts to window resize on web and to rotation
 * on native via `useWindowDimensions`.
 */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WideBreakpoint;
}
