import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Rounded, Spacing } from '@/constants/theme';
import { pressable } from '@/lib/pressable';
import { ApiError } from '@/lib/api/client';
import { createPlan, FixedSport, PlanRequest, PlanResponse, Weekday } from '@/lib/api/plans';
import type { SportType } from '@/lib/api/types';

type Objective = { label: string; goal: 'distance' | 'fitness'; distanceKm: number | null };

const FIXED_SPORT_OPTIONS: { sport: SportType; label: string }[] = [
  { sport: 'PADEL', label: 'Padel' },
  { sport: 'STRENGTH', label: 'Renforcement' },
  { sport: 'BIKE', label: 'Vélo' },
  { sport: 'BASKETBALL', label: 'Basket' },
];

const OBJECTIVES: Objective[] = [
  { label: '10 km', goal: 'distance', distanceKm: 10 },
  { label: 'Semi', goal: 'distance', distanceKm: 21.1 },
  { label: 'Marathon', goal: 'distance', distanceKm: 42.2 },
  { label: 'Forme', goal: 'fitness', distanceKm: null },
];

const DAYS: { label: string; value: Weekday }[] = [
  { label: 'Lun', value: 'MONDAY' },
  { label: 'Mar', value: 'TUESDAY' },
  { label: 'Mer', value: 'WEDNESDAY' },
  { label: 'Jeu', value: 'THURSDAY' },
  { label: 'Ven', value: 'FRIDAY' },
  { label: 'Sam', value: 'SATURDAY' },
  { label: 'Dim', value: 'SUNDAY' },
];

const RUN_COUNTS = [2, 3, 4, 5];

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function objectiveIndexFor(request: PlanRequest | null): number {
  if (!request) return 1; // Semi by default
  if (request.goal_type === 'fitness') return OBJECTIVES.findIndex((o) => o.goal === 'fitness');
  const match = OBJECTIVES.findIndex((o) => o.distanceKm === request.distance_km);
  return match >= 0 ? match : 1;
}

export default function PlanSetupScreen() {
  const queryClient = useQueryClient();
  // Prefill from the current plan (already cached by the Plan tab) so "change my
  // objective" is a quick edit rather than re-entering everything.
  const prefill = queryClient.getQueryData<PlanResponse>(['plan'])?.request ?? null;

  const [objectiveIndex, setObjectiveIndex] = useState(objectiveIndexFor(prefill));
  const [raceDate, setRaceDate] = useState(prefill?.race_date ?? '');
  const [days, setDays] = useState<Set<Weekday>>(
    new Set<Weekday>(prefill?.available_days ?? ['TUESDAY', 'THURSDAY', 'SATURDAY']),
  );
  const [runCount, setRunCount] = useState(prefill?.max_run_sessions_per_week ?? 3);
  const [fixedSports, setFixedSports] = useState<Map<SportType, Weekday>>(
    new Map((prefill?.fixed_sports ?? []).map((f) => [f.sport, f.day])),
  );
  const [dateError, setDateError] = useState<string | undefined>();

  const objective = OBJECTIVES[objectiveIndex];

  function toggleFixedSport(sport: SportType, day: Weekday) {
    setFixedSports((prev) => {
      const next = new Map(prev);
      if (next.get(sport) === day) next.delete(sport);
      else next.set(sport, day);
      return next;
    });
  }

  const mutation = useMutation({
    mutationFn: (request: PlanRequest) => createPlan(request),
    onSuccess: (data) => {
      queryClient.setQueryData(['plan'], data);
      queryClient.invalidateQueries({ queryKey: ['plan-today'] });
      router.back();
    },
  });

  function toggleDay(day: Weekday) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function handleGenerate() {
    const trimmedDate = raceDate.trim();
    if (trimmedDate && !ISO_DATE.test(trimmedDate)) {
      setDateError('Format attendu : AAAA-MM-JJ (ex. 2026-11-15).');
      return;
    }
    setDateError(undefined);

    const hasDate = trimmedDate.length > 0 && objective.goal !== 'fitness';
    const fixed: FixedSport[] = Array.from(fixedSports, ([sport, day]) => ({ sport, day }));
    const request: PlanRequest = {
      goal_type: hasDate ? 'race' : objective.goal,
      distance_km: objective.distanceKm,
      race_date: hasDate ? trimmedDate : null,
      target_time_min: null,
      available_days: DAYS.map((d) => d.value).filter((v) => days.has(v)),
      max_run_sessions_per_week: runCount,
      fixed_sports: fixed,
    };
    mutation.mutate(request);
  }

  const errorMessage = (() => {
    if (mutation.data?.status === 'failed') return mutation.data.error_message ?? undefined;
    if (mutation.error instanceof ApiError) return mutation.error.message;
    if (mutation.isError) return 'Impossible de générer le plan. Réessayez.';
    return undefined;
  })();

  const canSubmit = days.size >= 2 && !mutation.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="waypointLabel" themeColor="textSecondary">
              Mon plan
            </ThemedText>
            <ThemedText type="title">Configurer mon plan</ThemedText>
            <ThemedText type="default" themeColor="textSecondary">
              Le plan s’adapte à votre forme et votre fatigue réelles. Vous pourrez le régénérer à
              tout moment en changeant ces réglages.
            </ThemedText>
          </View>

          <Field label="Objectif">
            <View style={styles.chipRow}>
              {OBJECTIVES.map((o, i) => (
                <Chip
                  key={o.label}
                  label={o.label}
                  selected={i === objectiveIndex}
                  onPress={() => setObjectiveIndex(i)}
                />
              ))}
            </View>
          </Field>

          {objective.goal !== 'fitness' ? (
            <TextField
              label="Date de course (optionnel)"
              value={raceDate}
              onChangeText={(t) => {
                setRaceDate(t);
                setDateError(undefined);
                mutation.reset();
              }}
              error={dateError}
              placeholder="AAAA-MM-JJ"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
          ) : null}

          <Field label="Jours disponibles">
            <View style={styles.chipRow}>
              {DAYS.map((d) => (
                <Chip
                  key={d.value}
                  label={d.label}
                  selected={days.has(d.value)}
                  onPress={() => toggleDay(d.value)}
                />
              ))}
            </View>
          </Field>

          <Field label="Séances de course par semaine">
            <View style={styles.chipRow}>
              {RUN_COUNTS.map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  selected={n === runCount}
                  onPress={() => setRunCount(n)}
                />
              ))}
            </View>
          </Field>

          <Field label="Sports fixes (optionnel)">
            <ThemedText type="small" themeColor="textSecondary">
              Choisis un jour pour un sport récurrent : le plan sera construit autour (pas de
              séance intense le lendemain), il ne le déplacera jamais.
            </ThemedText>
            {FIXED_SPORT_OPTIONS.map((option) => (
              <View key={option.sport} style={styles.fixedRow}>
                <ThemedText type="default" style={styles.fixedLabel}>
                  {option.label}
                </ThemedText>
                <View style={styles.chipRow}>
                  {DAYS.map((d) => (
                    <Chip
                      key={d.value}
                      label={d.label}
                      selected={fixedSports.get(option.sport) === d.value}
                      onPress={() => toggleFixedSport(option.sport, d.value)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </Field>

          {mutation.isPending ? (
            <ThemedText type="small" themeColor="textSecondary">
              Génération du plan en cours… l’IA construit et vérifie chaque semaine, ça peut prendre
              une trentaine de secondes.
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
            label="Générer mon plan"
            onPress={handleGenerate}
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
  fixedRow: { gap: Spacing.one, paddingTop: Spacing.two },
  fixedLabel: { marginBottom: Spacing.half },
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
