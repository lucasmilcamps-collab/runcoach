import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ChipRow, Field, FormScreen, FormSection, ToggleField } from '@/components/form';
import { GenerationProgress } from '@/components/generation-progress';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { makeStyles } from '@/lib/themed-styles';
import { createPlan, FixedSport, PlanRequest, PlanResponse, Weekday } from '@/lib/api/plans';
import type { SportType } from '@/lib/api/types';
import { weekRangeLabel } from '@/lib/plan-overview';
import { qk } from '@/lib/query-keys';
import { usePlanGeneration } from '@/lib/use-plan-generation';

type Objective = { label: string; goal: 'distance' | 'fitness'; distanceKm: number | null };
// Per sport: day → isFlexible. Flexibility is per DAY (e.g. basket Wed fixed +
// a match one of Fri/Sat/Sun), matching the backend's fixed/flexible split.
type FixedDays = Map<Weekday, boolean>;

const FIXED_SPORT_OPTIONS: { sport: SportType; label: string }[] = [
  { sport: 'PADEL', label: 'Padel' },
  { sport: 'BASKETBALL', label: 'Basket' },
  { sport: 'BIKE', label: 'Vélo' },
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
const STRENGTH_COUNTS = [1, 2];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** How many upcoming Mondays the athlete can choose from. Four covers "next
 * week" through "after my holiday" without turning a choice into a calendar. */
const START_CHOICES = 4;
// Latest weekday (Mon=0) on which starting this week still leaves room to
// train — mirrors the server's default, so the preselected chip is the one it
// would have picked anyway.
const LAST_DAY_TO_START_THIS_WEEK = 2; // Wednesday

function mondayOf(d: Date): Date {
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  // JS weeks start on Sunday; ours start on Monday.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function toIsoDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** The next `START_CHOICES` Mondays, this week's included. */
function upcomingMondays(today: Date): Date[] {
  const first = mondayOf(today);
  return Array.from({ length: START_CHOICES }, (_, i) => {
    const monday = new Date(first);
    monday.setDate(first.getDate() + i * 7);
    return monday;
  });
}

const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

function startChoiceLabel(index: number, monday: Date): string {
  if (index === 0) return 'Cette semaine';
  if (index === 1) return 'Lundi prochain';
  return SHORT_DATE.format(monday);
}

/** A weekday in the fixed-sport grid: off → fixed → flexible. "Flexible" takes a
 * dashed border and an "≈" prefix — the two selected states differ by shape and
 * by label, never by colour, and never by colour alone. */
function DayChip({
  label,
  state,
  onPress,
}: {
  label: string;
  state: 'off' | 'fixed' | 'flexible';
  onPress: () => void;
}) {
  return (
    <Chip
      label={state === 'flexible' ? `≈ ${label}` : label}
      selected={state !== 'off'}
      variant={state === 'flexible' ? 'dashed' : 'solid'}
      onPress={onPress}
      accessibilityLabel={
        state === 'off' ? label : `${label}, ${state === 'fixed' ? 'fixe' : 'variable'}`
      }
    />
  );
}

function objectiveIndexFor(request: PlanRequest | null): number {
  if (!request) return 1;
  if (request.goal_type === 'fitness') return OBJECTIVES.findIndex((o) => o.goal === 'fitness');
  const match = OBJECTIVES.findIndex((o) => o.distanceKm === request.distance_km);
  return match >= 0 ? match : 1;
}

function groupFixed(request: PlanRequest | null): Map<SportType, FixedDays> {
  const map = new Map<SportType, FixedDays>();
  for (const f of request?.fixed_sports ?? []) {
    const days = map.get(f.sport) ?? new Map<Weekday, boolean>();
    days.set(f.day, f.flexible);
    map.set(f.sport, days);
  }
  return map;
}

export default function PlanSetupScreen() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const prefill = queryClient.getQueryData<PlanResponse>(qk.plan())?.request ?? null;

  const [objectiveIndex, setObjectiveIndex] = useState(objectiveIndexFor(prefill));
  const [raceDate, setRaceDate] = useState(prefill?.race_date ?? '');

  // Computed once per mount: the list must not shift under the athlete's
  // selection if the app sits open across midnight.
  const [startChoices] = useState(() => upcomingMondays(new Date()));
  const [startIndex, setStartIndex] = useState(() => {
    // A previous plan's start is only meaningful if it's still on offer — a
    // regenerated plan can't start in a week that has already gone by.
    const previous = startChoices.findIndex((m) => toIsoDate(m) === prefill?.start_date);
    if (previous !== -1) return previous;
    // Same rule as the server: this week while it still has room, else the next.
    return (new Date().getDay() + 6) % 7 <= LAST_DAY_TO_START_THIS_WEEK ? 0 : 1;
  });
  const [days, setDays] = useState<Set<Weekday>>(
    new Set<Weekday>(prefill?.available_days ?? ['TUESDAY', 'THURSDAY', 'SATURDAY']),
  );
  // 2 → 3, not 3 → 3: with min == max every run is a key session and none is
  // ever optional, which is exactly what the key/optional split exists for.
  const [minRuns, setMinRuns] = useState(prefill?.min_run_sessions_per_week ?? 2);
  const [maxRuns, setMaxRuns] = useState(prefill?.max_run_sessions_per_week ?? 3);
  const [crossTraining, setCrossTraining] = useState(prefill?.include_cross_training ?? false);
  const [strengthOn, setStrengthOn] = useState(prefill?.strength?.enabled ?? false);
  const [strengthPerWeek, setStrengthPerWeek] = useState(prefill?.strength?.sessions_per_week ?? 1);
  const [fixedSports, setFixedSports] = useState<Map<SportType, FixedDays>>(groupFixed(prefill));
  const [dateError, setDateError] = useState<string | undefined>();

  const objective = OBJECTIVES[objectiveIndex];

  function pickMin(n: number) {
    setMinRuns(n);
    if (n > maxRuns) setMaxRuns(n);
  }
  function pickMax(n: number) {
    setMaxRuns(n);
    if (n < minRuns) setMinRuns(n);
  }

  // Cycle a day through: unset → fixed → flexible → unset.
  function cycleFixedDay(sport: SportType, day: Weekday) {
    setFixedSports((prev) => {
      const next = new Map(prev);
      const days = new Map(next.get(sport) ?? new Map<Weekday, boolean>());
      const state = days.get(day);
      if (state === undefined) days.set(day, false); // fixed
      else if (state === false) days.set(day, true); // flexible
      else days.delete(day); // off
      if (days.size === 0) next.delete(sport);
      else next.set(sport, days);
      return next;
    });
  }

  const generation = usePlanGeneration(createPlan, { onDone: () => router.back() });

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
    const fixed: FixedSport[] = [];
    for (const [sport, days] of fixedSports) {
      for (const [day, flexible] of days) fixed.push({ sport, day, flexible });
    }
    const request: PlanRequest = {
      goal_type: hasDate ? 'race' : objective.goal,
      distance_km: objective.distanceKm,
      race_date: hasDate ? trimmedDate : null,
      target_time_min: null,
      start_date: toIsoDate(startChoices[startIndex]),
      available_days: DAYS.map((d) => d.value).filter((v) => days.has(v)),
      min_run_sessions_per_week: minRuns,
      max_run_sessions_per_week: maxRuns,
      fixed_sports: fixed,
      include_cross_training: crossTraining,
      strength: { enabled: strengthOn, sessions_per_week: strengthPerWeek, duration_min: 20 },
    };
    generation.generate(request);
  }

  const errorMessage = generation.errorMessage;

  const canSubmit = days.size >= 2 && !generation.isGenerating;

  return (
    <FormScreen
      kicker="Mon plan"
      title="Configurer mon plan"
      blurb="Le plan s’adapte à ta forme et à ta fatigue réelles. Ces réglages écrivent un plan complet, à partir de la semaine 1 — pour réajuster la suite d’un plan déjà en cours sans perdre ce que tu as couru, c’est « Replanifier » dans l’onglet Plan."
      actions={[
        <Button
          key="submit"
          label="Générer mon plan"
          onPress={handleGenerate}
          loading={generation.isGenerating}
          disabled={!canSubmit}
        />,
        <Button
          key="cancel"
          label="Annuler"
          variant="ghost"
          disabled={generation.isGenerating}
          onPress={() => router.back()}
        />
      ]}>
      {/* Three questions, not ten fields: what you are training for, how often
          you can run, and what else is already in the week. */}
      <FormSection title="L’objectif">
        <Field label="Distance">
          <ChipRow>
            {OBJECTIVES.map((o, i) => (
              <Chip
                key={o.label}
                label={o.label}
                selected={i === objectiveIndex}
                onPress={() => setObjectiveIndex(i)}
              />
            ))}
          </ChipRow>
        </Field>

        {objective.goal !== 'fitness' ? (
          <TextField
            label="Date de course (optionnel)"
            value={raceDate}
            onChangeText={(t) => {
              setRaceDate(t);
              setDateError(undefined);
              generation.reset();
            }}
            error={dateError}
            placeholder="AAAA-MM-JJ"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />
        ) : null}

        <Field
          label="Début du plan"
          hint="La semaine 1 commence toujours un lundi. Générer en fin de semaine et démarrer tout de suite, c’est hériter d’une semaine déjà passée aux trois quarts.">
          <ChipRow>
            {startChoices.map((monday, i) => (
              <Chip
                key={toIsoDate(monday)}
                label={startChoiceLabel(i, monday)}
                selected={i === startIndex}
                onPress={() => setStartIndex(i)}
                accessibilityLabel={`Commencer le lundi ${SHORT_DATE.format(monday)}`}
              />
            ))}
          </ChipRow>
          {/* The chips say "next Monday"; this says which days that actually
              covers, so the choice is never made on a guess. */}
          <ThemedText type="small" themeColor="inkMuted">
            Semaine 1 : {weekRangeLabel(toIsoDate(startChoices[startIndex]), 0)}
          </ThemedText>
        </Field>
      </FormSection>

      <FormSection title="Le rythme">
        <Field label="Jours disponibles">
          <ChipRow>
            {DAYS.map((d) => (
              <Chip
                key={d.value}
                label={d.label}
                selected={days.has(d.value)}
                onPress={() => toggleDay(d.value)}
              />
            ))}
          </ChipRow>
        </Field>

        <Field
          label="Séances de course par semaine"
          hint={`Je m’engage sur ${minRuns} séance${minRuns > 1 ? 's' : ''} par semaine — elles seront marquées « clés » — et je peux en faire jusqu’à ${maxRuns} si la semaine le permet.`}>
          <View style={styles.dualRow}>
            <View style={styles.dualCol}>
              <ThemedText type="small" themeColor="inkMuted">
                Je m’engage sur
              </ThemedText>
              <ChipRow>
                {RUN_COUNTS.map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    selected={n === minRuns}
                    onPress={() => pickMin(n)}
                    accessibilityLabel={`Au moins ${n} séances par semaine`}
                  />
                ))}
              </ChipRow>
            </View>
            <View style={styles.dualCol}>
              <ThemedText type="small" themeColor="inkMuted">
                Jusqu’à
              </ThemedText>
              <ChipRow>
                {RUN_COUNTS.map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    selected={n === maxRuns}
                    onPress={() => pickMax(n)}
                    accessibilityLabel={`Au plus ${n} séances par semaine`}
                  />
                ))}
              </ChipRow>
            </View>
          </View>
        </Field>
      </FormSection>

      <FormSection title="Autour de la course">
        <ToggleField
          label="Renforcement (Freeletics)"
          hint="Le plan réserve le créneau et l’intention (~20 min) ; tu fais la séance dans Freeletics."
          value={strengthOn}
          onValueChange={setStrengthOn}
        />
        {strengthOn ? (
          <Field label="Séances de renfo par semaine">
            <ChipRow>
              {STRENGTH_COUNTS.map((n) => (
                <Chip
                  key={n}
                  label={`${n}/sem`}
                  selected={n === strengthPerWeek}
                  onPress={() => setStrengthPerWeek(n)}
                />
              ))}
            </ChipRow>
          </Field>
        ) : null}

        <ToggleField
          label="Cross-training prescrit"
          hint="Ajoute des séances de cross-training au plan. Tes sports pratiqués comptent déjà dans ta charge, quoi qu’il arrive."
          value={crossTraining}
          onValueChange={setCrossTraining}
        />

        <Field
          label="Sports fixes (optionnel)"
          hint="Un sport récurrent : le plan est construit autour (pas de séance intense le lendemain). Appuie sur un jour pour le rendre fixe, encore une fois pour « ≈ variable » — un des jours variables suffit, ex. le match du week-end — encore une fois pour l’enlever.">
          {FIXED_SPORT_OPTIONS.map((option) => {
            const days = fixedSports.get(option.sport);
            return (
              <View key={option.sport} style={styles.fixedRow}>
                <ThemedText type="default">{option.label}</ThemedText>
                <ChipRow>
                  {DAYS.map((d) => (
                    <DayChip
                      key={d.value}
                      label={d.label}
                      state={days?.has(d.value) ? (days.get(d.value) ? 'flexible' : 'fixed') : 'off'}
                      onPress={() => cycleFixedDay(option.sport, d.value)}
                    />
                  ))}
                </ChipRow>
              </View>
            );
          })}
        </Field>
      </FormSection>

      <GenerationProgress phase={generation.phase} elapsedSeconds={generation.elapsedSeconds} />
      {errorMessage ? (
        <ThemedText type="small" themeColor="alerte">
          {errorMessage}
        </ThemedText>
      ) : null}
    </FormScreen>
  );
}

const useStyles = makeStyles(() => ({
  dualRow: { flexDirection: 'row', gap: Spacing.four, flexWrap: 'wrap' },
  dualCol: { gap: Spacing.two },
  fixedRow: { gap: Spacing.two, paddingTop: Spacing.two },
}));
