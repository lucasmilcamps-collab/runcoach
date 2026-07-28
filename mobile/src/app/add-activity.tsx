import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { createManualActivity, ManualActivityCreate } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import type { SportType } from '@/lib/api/types';
import { pressable } from '@/lib/pressable';

const SPORT_OPTIONS: { sport: SportType; label: string }[] = [
  { sport: 'RUN', label: 'Course' },
  { sport: 'PADEL', label: 'Padel' },
  { sport: 'BASKETBALL', label: 'Basket' },
  { sport: 'BIKE', label: 'Vélo' },
  { sport: 'STRENGTH', label: 'Renfo' },
  { sport: 'OTHER', label: 'Autre' },
];

const DURATIONS = [15, 30, 45, 60, 75, 90, 120];
const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={pressable([styles.chip, selected && styles.chipSelected])}>
      <ThemedText type="default" themeColor={selected ? 'background' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function nearestDuration(n: number): number {
  return DURATIONS.reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best), DURATIONS[0]);
}

export default function AddActivityScreen() {
  const queryClient = useQueryClient();
  // Optional prefill when arriving from a plan session ("J'ai fait cette séance").
  const params = useLocalSearchParams<{ sport?: string; duration?: string }>();
  const prefillSport = SPORT_OPTIONS.find((o) => o.sport === params.sport)?.sport ?? 'RUN';
  const prefillDuration = params.duration ? nearestDuration(Number(params.duration)) : 45;

  const [sport, setSport] = useState<SportType>(prefillSport);
  const [date, setDate] = useState(todayISO());
  const [durationMin, setDurationMin] = useState(prefillDuration);
  const [rpe, setRpe] = useState(5);
  const [note, setNote] = useState('');
  const [dateError, setDateError] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: (payload: ManualActivityCreate) => createManualActivity(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['fitness'] });
      router.back();
    },
  });

  function handleSubmit() {
    const trimmedDate = date.trim();
    if (!ISO_DATE.test(trimmedDate)) {
      setDateError('Format attendu : AAAA-MM-JJ.');
      return;
    }
    setDateError(undefined);
    mutation.mutate({
      sport,
      start_time: `${trimmedDate}T12:00:00Z`,
      duration_min: durationMin,
      rpe,
      note: note.trim() || null,
    });
  }

  const errorMessage = (() => {
    if (mutation.error instanceof ApiError) return mutation.error.message;
    if (mutation.isError) return 'Impossible d’enregistrer la séance. Réessayez.';
    return undefined;
  })();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              Ajouter une séance
            </ThemedText>
            <ThemedText type="title">Séance manuelle</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Pour une séance que Garmin n’a pas captée. Sa charge est estimée depuis l’effort
              ressenti (RPE), et elle compte dans ta forme comme les autres.
            </ThemedText>
          </View>

          <Field label="Sport">
            <View style={styles.chipRow}>
              {SPORT_OPTIONS.map((o) => (
                <Chip
                  key={o.sport}
                  label={o.label}
                  selected={o.sport === sport}
                  onPress={() => setSport(o.sport)}
                />
              ))}
            </View>
          </Field>

          <TextField
            label="Date"
            value={date}
            onChangeText={(t) => {
              setDate(t);
              setDateError(undefined);
              mutation.reset();
            }}
            error={dateError}
            placeholder="AAAA-MM-JJ"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />

          <Field label="Durée">
            <View style={styles.chipRow}>
              {DURATIONS.map((d) => (
                <Chip
                  key={d}
                  label={`${d} min`}
                  selected={d === durationMin}
                  onPress={() => setDurationMin(d)}
                />
              ))}
            </View>
          </Field>

          <Field label={`Effort ressenti (RPE) : ${rpe}/10`}>
            <View style={styles.chipRow}>
              {RPE_VALUES.map((r) => (
                <Chip key={r} label={String(r)} selected={r === rpe} onPress={() => setRpe(r)} />
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              1 = très facile · 5 = modéré · 10 = effort maximal
            </ThemedText>
          </Field>

          <TextField
            label="Note (optionnel)"
            value={note}
            onChangeText={setNote}
            placeholder="ex. sortie avec le club"
            autoCapitalize="sentences"
          />

          {errorMessage ? (
            <ThemedText type="small" themeColor="flare">
              {errorMessage}
            </ThemedText>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <Button
            label="Enregistrer la séance"
            onPress={handleSubmit}
            loading={mutation.isPending}
            disabled={mutation.isPending}
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
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
