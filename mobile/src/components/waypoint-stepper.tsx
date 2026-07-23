import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

const STEPS = ['Bienvenue', 'Connexion', 'Garmin', 'Dashboard'] as const;

type WaypointStepperProps = {
  currentStep: number; // 0-indexed
};

/**
 * The onboarding trail: four waypoints connected by a contour path. This is
 * the surface's signature component (DESIGN.md) — a literal trail marker,
 * not a generic progress bar.
 */
export function WaypointStepper({ currentStep }: WaypointStepperProps) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {STEPS.map((step, index) => {
          const isCurrent = index === currentStep;
          const isDone = index < currentStep;
          return (
            <View key={step} style={styles.stepGroup}>
              <View
                style={[
                  styles.dot,
                  isCurrent && styles.dotCurrent,
                  isDone && styles.dotDone,
                  !isCurrent && !isDone && styles.dotUpcoming,
                ]}
              />
              {index < STEPS.length - 1 && <View style={styles.connector} />}
            </View>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        <ThemedText type="waypointLabel" themeColor="text">
          {String(currentStep + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </ThemedText>
        <ThemedText type="waypointLabel" themeColor="textSecondary">
          {STEPS[currentStep]}
        </ThemedText>
      </View>
    </View>
  );
}

const DOT_SIZE = 12;

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1.5,
    borderColor: Colors.contour,
    backgroundColor: 'transparent',
  },
  dotCurrent: {
    // Stroke + glow, not a fill — the primary CTA is this screen's one
    // permitted Trail Blaze fill (DESIGN.md: The One Blaze Rule).
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: Colors.blaze,
    shadowColor: Colors.blaze,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  dotDone: {
    backgroundColor: Colors.textSecondary,
    borderColor: Colors.textSecondary,
  },
  dotUpcoming: {},
  connector: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.contour,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
