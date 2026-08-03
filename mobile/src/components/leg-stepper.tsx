import { View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import { ThemedText } from '@/components/themed-text';

const LEGS = ['Bienvenue', 'Connexion', 'Garmin', 'Accueil'] as const;

/**
 * Onboarding progress, drawn as the relay's own legs: one baseline cut into
 * four segments, filled as each is handed over.
 *
 * A segmented bar rather than dots on a path — the segments have length, and
 * length is what a leg has. The count is named ("02 / 04") because the sequence
 * itself is the information here: an onboarding flow that doesn't say how much
 * is left is the one people abandon.
 *
 * Neutral throughout: progress is not a training-load state, so it gets no
 * signal ink (DESIGN.md).
 */
export function LegStepper({ currentStep }: { currentStep: number }) {
  const styles = useStyles();

  return (
    <View
      style={styles.wrapper}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: LEGS.length, now: currentStep + 1 }}
      accessibilityLabel={`Étape ${currentStep + 1} sur ${LEGS.length} : ${LEGS[currentStep]}`}>
      <View style={styles.track}>
        {LEGS.map((leg, index) => (
          <View key={leg} style={[styles.leg, index <= currentStep && styles.legDone]} />
        ))}
      </View>
      <View style={styles.labelRow}>
        <ThemedText type="label">
          {String(currentStep + 1).padStart(2, '0')} / {String(LEGS.length).padStart(2, '0')}
        </ThemedText>
        <ThemedText type="label" themeColor="inkMuted">
          {LEGS[currentStep]}
        </ThemedText>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrapper: {
    gap: Spacing.two,
  },
  track: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  leg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: t.rule,
  },
  legDone: {
    backgroundColor: t.ink,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
}));
