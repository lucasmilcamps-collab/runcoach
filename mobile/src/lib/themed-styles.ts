import { StyleSheet } from 'react-native';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

import { Palettes, type Appearance, type Palette } from '@/constants/theme';
import { useAppearance } from '@/hooks/use-theme';

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * A `StyleSheet.create` that knows about Relay's two appearances.
 *
 * Colour cannot live in a module-level stylesheet any more — a hex there
 * resolves for exactly one appearance, and this app ships both as first-class
 * (DESIGN.md). Layout still belongs in a stylesheet, though: moving padding and
 * flex to the call site to chase one border colour is how a component ends up
 * with a hundred-line inline style prop.
 *
 * So the factory takes the palette and returns the same object it always did,
 * and the result is built once per appearance and cached — a component that
 * renders a hundred rows pays for two stylesheets in the life of the process,
 * not two per render.
 *
 *     const useStyles = makeStyles((t) => ({
 *       card: { backgroundColor: t.raised, padding: Spacing.four },
 *     }));
 *
 *     function Card() {
 *       const styles = useStyles();
 *       return <View style={styles.card} />;
 *     }
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (theme: Palette) => T): () => T {
  const cache = new Map<Appearance, T>();

  return function useStyles(): T {
    const appearance = useAppearance();
    let sheet = cache.get(appearance);
    if (!sheet) {
      sheet = StyleSheet.create(factory(Palettes[appearance]));
      cache.set(appearance, sheet);
    }
    return sheet;
  };
}
