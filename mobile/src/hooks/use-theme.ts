import { useColorScheme } from 'react-native';

import { Palettes, ZoneRamp, type Appearance, type Palette } from '@/constants/theme';
import { usePreferencesStore } from '@/lib/stores/preferences-store';

/**
 * Which of Relay's two appearances is active.
 *
 * Neither is the "real" theme with the other as a fallback (DESIGN.md): the app
 * is read at 6am in a dark bedroom and again at 22h after a match, so the
 * system's own choice is the honest default. Réglages can pin one.
 */
export function useAppearance(): Appearance {
  const mode = usePreferencesStore((state) => state.themeMode);
  // Called unconditionally, before the branch — react-native's hook subscribes
  // to OS appearance changes (and to `prefers-color-scheme` on web), so pinning
  // 'system' repaints the app live when the phone flips at sunset.
  const system = useColorScheme();

  if (mode === 'light') return 'sable';
  if (mode === 'dark') return 'graphite';
  return system === 'light' ? 'sable' : 'graphite';
}

/** The active palette. Every component reads colour through this — a hex in a
 * StyleSheet only resolves for one appearance, which is the bug this prevents. */
export function useTheme(): Palette {
  return Palettes[useAppearance()];
}

/** The Z1→Z5 intensity ramp for the active appearance. */
export function useZoneRamp(): readonly [string, string, string, string, string] {
  return ZoneRamp[useAppearance()];
}
