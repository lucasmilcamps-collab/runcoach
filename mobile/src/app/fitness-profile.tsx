import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxFormWidth, Rounded, Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import { ApiError } from '@/lib/api/client';
import { getFitness, updateFitnessProfile } from '@/lib/api/fitness';
import { pressable } from '@/lib/pressable';
import { qk } from '@/lib/query-keys';
import { PrimaryMetric, usePreferencesStore } from '@/lib/stores/preferences-store';

// Kept in sync with the backend bounds (FitnessProfileUpdate). Client-side
// checks give an instant, French message; the server still validates.
const HR_MAX_MIN = 120;
const HR_MAX_MAX = 230;
const HR_REST_MIN = 25;
const HR_REST_MAX = 120;
const MIN_RESERVE = 20;

function parseHr(value: string): number | null {
  const n = Number.parseInt(value.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

export default function FitnessProfileScreen() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const fitnessQuery = useQuery({ queryKey: qk.fitness(), queryFn: getFitness });

  const primaryMetric = usePreferencesStore((s) => s.primaryMetric);
  const setPrimaryMetric = usePreferencesStore((s) => s.setPrimaryMetric);

  const [hrMax, setHrMax] = useState('');
  const [hrRest, setHrRest] = useState('');
  const [hrMaxError, setHrMaxError] = useState<string | undefined>();
  const [hrRestError, setHrRestError] = useState<string | undefined>();

  // Prefill with whatever we already know (Garmin-derived or a prior manual
  // entry), so editing starts from the current values instead of blank.
  useEffect(() => {
    const data = fitnessQuery.data;
    if (!data) return;
    if (data.hr_max != null && hrMax === '') setHrMax(String(data.hr_max));
    if (data.hr_rest != null && hrRest === '') setHrRest(String(data.hr_rest));
    // Only seed once, when data first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitnessQuery.data]);

  const saveMutation = useMutation({
    mutationFn: ({ max, rest }: { max: number; rest: number }) => updateFitnessProfile(max, rest),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.fitness(), data);
      router.back();
    },
  });

  function handleSave() {
    const max = parseHr(hrMax);
    const rest = parseHr(hrRest);

    const nextMaxError =
      max == null || max < HR_MAX_MIN || max > HR_MAX_MAX
        ? `Entre une FC max réaliste (${HR_MAX_MIN}–${HR_MAX_MAX}).`
        : undefined;
    const nextRestError =
      rest == null || rest < HR_REST_MIN || rest > HR_REST_MAX
        ? `Entre une FC de repos réaliste (${HR_REST_MIN}–${HR_REST_MAX}).`
        : max != null && rest != null && max - rest < MIN_RESERVE
          ? 'La FC max doit être nettement au-dessus de la FC de repos.'
          : undefined;

    setHrMaxError(nextMaxError);
    setHrRestError(nextRestError);
    if (nextMaxError || nextRestError || max == null || rest == null) return;

    saveMutation.mutate({ max, rest });
  }

  const serverError =
    saveMutation.error instanceof ApiError
      ? saveMutation.error.message
      : saveMutation.isError
        ? 'Impossible d’enregistrer. Réessaie.'
        : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <View style={styles.header}>
            <ThemedText type="label" themeColor="inkMuted">
              Fréquence cardiaque
            </ThemedText>
            <ThemedText type="title">Vos repères cardiaques</ThemedText>
            <ThemedText type="default" themeColor="inkMuted">
              Garmin ne fournit pas ta fréquence de repos (montre non portée en continu ?).
              Renseigne tes deux repères : ils servent à calculer tes zones et ta charge, et une
              synchronisation Garmin ne les écrasera pas.
            </ThemedText>
          </View>

          <View style={styles.form}>
            <TextField
              label="FC maximale (bpm)"
              value={hrMax}
              onChangeText={(text) => {
                setHrMax(text.replace(/[^0-9]/g, ''));
                setHrMaxError(undefined);
                saveMutation.reset();
              }}
              error={hrMaxError}
              keyboardType="number-pad"
              placeholder="ex. 190"
              maxLength={3}
            />
            <TextField
              label="FC de repos (bpm)"
              value={hrRest}
              onChangeText={(text) => {
                setHrRest(text.replace(/[^0-9]/g, ''));
                setHrRestError(undefined);
                saveMutation.reset();
              }}
              error={hrRestError}
              keyboardType="number-pad"
              placeholder="ex. 50"
              maxLength={3}
            />
            <ThemedText type="small" themeColor="inkMuted">
              Astuce : la FC de repos se mesure le matin au réveil, allongé. La FC max est la plus
              haute vue en fin d’effort intense.
            </ThemedText>
            {serverError ? (
              <ThemedText type="small" themeColor="alerte">
                {serverError}
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.form}>
            <ThemedText type="label" themeColor="inkMuted">
              Repère principal
            </ThemedText>
            <Segmented
              value={primaryMetric}
              onChange={setPrimaryMetric}
              options={[
                { value: 'pace', label: 'Allure' },
                { value: 'hr', label: 'Fréquence cardiaque' },
              ]}
            />
            <ThemedText type="small" themeColor="inkMuted">
              {primaryMetric === 'pace'
                ? 'Chaque séance affiche l’allure en premier ; la zone FC reste indiquée, en plafond sur les séances faciles.'
                : 'Chaque séance affiche la zone FC en premier ; l’allure reste indiquée en secondaire.'}
            </ThemedText>
          </View>
        </View>

        <View style={styles.actions}>
          <Button label="Enregistrer" onPress={handleSave} loading={saveMutation.isPending} />
          <Button
            label="Annuler"
            variant="ghost"
            disabled={saveMutation.isPending}
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: PrimaryMetric;
  onChange: (v: PrimaryMetric) => void;
  options: { value: PrimaryMetric; label: string }[];
}) {
  const styles = useStyles();
  return (
    <View style={styles.segmented}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={pressable([styles.segment, selected && styles.segmentSelected])}>
            <ThemedText type={selected ? 'link' : 'default'} themeColor={selected ? 'ink' : 'inkMuted'}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  flex: {
    flex: 1,
  },
  segmented: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Rounded.sm,
    borderWidth: 1,
    borderColor: t.ruleStrong,
    backgroundColor: t.raised,
  },
  segmentSelected: {
    // Outline-selected, matching the shared Chip: the screen's one filled button
    // stays with the primary action (DESIGN.md, The One Blaze Rule).
    borderWidth: 1.5,
    borderColor: t.ink,
    backgroundColor: t.inset,
  },
  safeArea: {
    flex: 1,
    backgroundColor: t.surface,
    paddingHorizontal: Spacing.four,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    gap: Spacing.five,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
    paddingTop: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  form: {
    gap: Spacing.three,
  },
  actions: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
    maxWidth: MaxFormWidth,
    alignSelf: 'center',
    width: '100%',
  },
}));
