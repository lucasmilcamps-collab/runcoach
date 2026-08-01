import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ScreenCrest } from '@/components/screen-crest';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxFormWidth, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import { usePlanGeneration } from '@/lib/use-plan-generation';
import { ApiError } from '@/lib/api/client';
import { InjuryReport, reportInjury } from '@/lib/api/plans';

type Severity = InjuryReport['severity'];

const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  { value: 'gene', label: 'Gêne légère', hint: 'Je peux courir prudemment' },
  { value: 'douleur', label: 'Douleur', hint: 'Courir aggrave la douleur' },
  { value: 'arret', label: 'Arrêt', hint: 'Je ne peux pas courir' },
];

const DAYS_OFF = [0, 3, 5, 7, 10, 14, 21];

export default function InjuryReportScreen() {

  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState<Severity>('gene');
  const [daysOff, setDaysOff] = useState(7);

  const generation = usePlanGeneration(reportInjury, { onDone: () => router.back() });

  function handleSubmit() {
    generation.generate({ area: area.trim(), severity, days_off: daysOff });
  }

  const errorMessage = (() => {
    return generation.errorMessage;
    return undefined;
  })();

  const canSubmit = area.trim().length > 0 && !generation.isGenerating;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScreenCrest />
          <View style={styles.header}>
            <ThemedText type="waypointLabel" themeColor="flare">
              Signaler une blessure
            </ThemedText>
            <ThemedText type="title">Adapter mon plan</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Le plan sera régénéré en reprise progressive : une période allégée puis une remontée
              douce de la charge. Ce n’est pas un avis médical — en cas de doute ou de douleur qui
              persiste, consulte un professionnel de santé.
            </ThemedText>
          </View>

          <TextField
            label="Zone touchée"
            value={area}
            onChangeText={(t) => {
              setArea(t);
              generation.reset();
            }}
            placeholder="ex. mollet droit, genou gauche…"
            autoCapitalize="none"
          />

          <Field label="Gravité">
            <View style={styles.severityCol}>
              {SEVERITIES.map((s) => (
                <Pressable
                  key={s.value}
                  onPress={() => setSeverity(s.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: severity === s.value }}
                  style={pressable([styles.severityRow, severity === s.value && styles.severityRowSelected])}>
                  <ThemedText type="default" themeColor={severity === s.value ? 'blaze' : 'text'}>
                    {s.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {s.hint}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </Field>

          <Field label="Jours sans courir">
            <View style={styles.chipRow}>
              {DAYS_OFF.map((n) => (
                <Chip
                  key={n}
                  label={n === 0 ? 'Aucun' : `${n} j`}
                  selected={n === daysOff}
                  onPress={() => setDaysOff(n)}
                />
              ))}
            </View>
          </Field>

          {generation.isGenerating ? (
            <ThemedText type="small" themeColor="textSecondary">
              Régénération en cours… l’IA reconstruit la reprise. Compte deux à cinq minutes pour
              un plan long — tu peux quitter l’écran, le plan t’attendra.
            </ThemedText>
          ) : null}
          {errorMessage ? (
            <ThemedText type="small" themeColor="flare">
              {errorMessage}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Button
            label="Adapter mon plan"
            onPress={handleSubmit}
            loading={generation.isGenerating}
            disabled={!canSubmit}
          />
          <Button
            label="Annuler"
            variant="ghost"
            disabled={generation.isGenerating}
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  content: {
    gap: Spacing.four,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  header: { gap: Spacing.two },
  field: { gap: Spacing.two },
  severityCol: { gap: Spacing.two },
  severityRow: {
    padding: Spacing.three,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
    gap: Spacing.half,
  },
  severityRowSelected: {
    borderColor: Colors.blaze,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  actions: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
  },
});
