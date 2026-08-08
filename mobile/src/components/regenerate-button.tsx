import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';

/**
 * The one way to ask for a replan, with the note that says what it spares.
 *
 * This button used to rebuild the plan from scratch, current week included, and
 * an athlete who had just run and linked a session could lose the week they had
 * run it in. It no longer does: weeks up to and including the one under way are
 * frozen, and only what comes after is replanned. Hence a note about what is
 * *kept* rather than a warning about what is lost.
 *
 * The confirmation step stays, because this still costs minutes of generation
 * and changes weeks the athlete may have read and planned around — but it is
 * now a "here is what happens", not a "are you sure you accept the damage".
 *
 * It lives in one component rather than at each call site because there are two
 * of them — the weekly review and the replan banner — and the two must not
 * describe the same action differently.
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
          La semaine en cours et les précédentes sont conservées telles quelles — séances,
          déplacements, durées et séances liées. Seules les semaines suivantes sont replanifiées à
          partir de ta forme actuelle. Le plan actuel reste consultable dans Mes plans.
        </ThemedText>
      ) : null}
      <Button
        label={confirming ? 'Confirmer la replanification ?' : 'Replanifier les semaines suivantes'}
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
