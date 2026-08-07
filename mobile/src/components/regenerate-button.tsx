import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The one way to ask for a regenerated plan, with the confirmation it needs.
 *
 * Regenerating rebuilds the plan from scratch — the current week included, and
 * the athlete's per-week moves and duration edits with it. That used to happen
 * on a single tap, under copy that said "les semaines restantes", which is not
 * what it does. An athlete who had just run and linked a session could lose the
 * week they had run it in, with no warning and no way back through the app.
 *
 * So: two taps, and the second one states plainly what changes. Same pattern as
 * deleting a session (an Alert barely exists on react-native-web).
 *
 * It lives in one component rather than at each call site because there are two
 * of them — the weekly review and the replan banner — and a warning that exists
 * on one button and not the other is worse than none: it teaches that the
 * unwarned button is the safe one.
 */
export function RegenerateButton({
  onConfirm,
  isRegenerating,
}: {
  onConfirm: () => void;
  isRegenerating: boolean;
}) {
  const styles = useStyles();
  const [confirming, setConfirming] = useState(false);

  return (
    <View style={styles.wrap}>
      {confirming ? (
        <ThemedText type="small" themeColor="inkMuted">
          Le plan est reconstruit entièrement, semaine en cours comprise : tes déplacements de
          séances et tes durées personnalisées seront perdus. Le plan actuel reste consultable dans
          Mes plans, et tu peux le restaurer.
        </ThemedText>
      ) : null}
      <Button
        label={confirming ? 'Confirmer la régénération ?' : 'Régénérer un plan adapté'}
        variant="ghost"
        loading={isRegenerating}
        onPress={() => {
          if (confirming) onConfirm();
          else setConfirming(true);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: Spacing.two },
}));
