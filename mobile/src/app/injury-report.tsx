import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/api/client';
import { InjuryReport, reportInjury } from '@/lib/api/plans';

type Severity = InjuryReport['severity'];

const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  { value: 'gene', label: 'Gêne légère', hint: 'Je peux courir prudemment' },
  { value: 'douleur', label: 'Douleur', hint: 'Courir aggrave la douleur' },
  { value: 'arret', label: 'Arrêt', hint: 'Je ne peux pas courir' },
];

const DAYS_OFF = [0, 3, 5, 7, 10, 14, 21];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}>
      <ThemedText type="default" themeColor={selected ? 'background' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function InjuryReportScreen() {
  const queryClient = useQueryClient();

  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState<Severity>('gene');
  const [daysOff, setDaysOff] = useState(7);

  const mutation = useMutation({
    mutationFn: (injury: InjuryReport) => reportInjury(injury),
    onSuccess: (data) => {
      queryClient.setQueryData(['plan'], data);
      queryClient.invalidateQueries({ queryKey: ['plan-today'] });
      queryClient.invalidateQueries({ queryKey: ['plan-progress'] });
      router.back();
    },
  });

  function handleSubmit() {
    mutation.mutate({ area: area.trim(), severity, days_off: daysOff });
  }

  const errorMessage = (() => {
    if (mutation.data?.status === 'failed') return mutation.data.error_message ?? undefined;
    if (mutation.error instanceof ApiError) return mutation.error.message;
    if (mutation.isError) return 'Impossible d’adapter le plan. Réessayez.';
    return undefined;
  })();

  const canSubmit = area.trim().length > 0 && !mutation.isPending;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
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
              mutation.reset();
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
                  style={[styles.severityRow, severity === s.value && styles.severityRowSelected]}>
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

          {mutation.isPending ? (
            <ThemedText type="small" themeColor="textSecondary">
              Régénération du plan en cours… l’IA reconstruit la reprise, ça peut prendre une
              trentaine de secondes.
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
            loading={mutation.isPending}
            disabled={!canSubmit}
          />
          <Button
            label="Annuler"
            variant="ghost"
            disabled={mutation.isPending}
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
    maxWidth: MaxContentWidth,
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
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: Colors.contour,
    backgroundColor: Colors.backgroundElement,
  },
  chipSelected: {
    backgroundColor: Colors.blaze,
    borderColor: Colors.blaze,
  },
  actions: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
});
