import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ChipRow, Field, FormScreen } from '@/components/form';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { createManualActivity, ManualActivityCreate } from '@/lib/api/activities';
import { ApiError } from '@/lib/api/client';
import type { SportType } from '@/lib/api/types';
import { qk } from '@/lib/query-keys';

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
      queryClient.invalidateQueries({ queryKey: qk.activities() });
      queryClient.invalidateQueries({ queryKey: qk.fitness() });
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
    if (mutation.isError) return 'Impossible d’enregistrer la séance. Réessaie.';
    return undefined;
  })();

  return (
    <FormScreen
      kicker="Ajouter une séance"
      title="Séance manuelle"
      blurb="Pour une séance que Garmin n’a pas captée. Sa charge est estimée depuis l’effort ressenti (RPE), et elle compte dans ta forme comme les autres."
      actions={[
        <Button
          key="submit"
          label="Enregistrer la séance"
          onPress={handleSubmit}
          loading={mutation.isPending}
          disabled={mutation.isPending}
        />,
        <Button
          key="cancel"
          label="Annuler"
          variant="ghost"
          disabled={mutation.isPending}
          onPress={() => router.back()}
        />
      ]}>
      <Field label="Sport">
        <ChipRow>
          {SPORT_OPTIONS.map((o) => (
            <Chip
              key={o.sport}
              label={o.label}
              selected={o.sport === sport}
              onPress={() => setSport(o.sport)}
            />
          ))}
        </ChipRow>
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
        <ChipRow>
          {DURATIONS.map((d) => (
            <Chip
              key={d}
              label={`${d} min`}
              selected={d === durationMin}
              onPress={() => setDurationMin(d)}
            />
          ))}
        </ChipRow>
      </Field>

      <Field
        label={`Effort ressenti — ${rpe}/10`}
        hint="1 = très facile · 5 = modéré · 10 = effort maximal">
        <ChipRow>
          {RPE_VALUES.map((r) => (
            <Chip
              key={r}
              label={String(r)}
              selected={r === rpe}
              onPress={() => setRpe(r)}
              accessibilityLabel={`Effort ${r} sur 10`}
            />
          ))}
        </ChipRow>
      </Field>

      <TextField
        label="Note (optionnel)"
        value={note}
        onChangeText={setNote}
        placeholder="ex. sortie avec le club"
        autoCapitalize="sentences"
      />

      {errorMessage ? (
        <ThemedText type="small" themeColor="alerte">
          {errorMessage}
        </ThemedText>
      ) : null}
    </FormScreen>
  );
}
