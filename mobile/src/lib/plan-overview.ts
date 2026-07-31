import type { Plan, PlanPhase, PlanWeek } from '@/lib/api/plans';
import { estimateDistanceKm } from '@/lib/plan-format';

/** One week's planned running volume, for the volume chart. */
export type WeekVolume = {
  index: number;
  km: number;
  minutes: number;
  isDeload: boolean;
};

/** Which measure the volume views are showing. Minutes are what the plan
 * actually prescribes; kilometres are derived from the target pace. */
export type VolumeMetric = 'km' | 'minutes';

/** A phase and the span of weeks it covers, for the cycles bar. */
export type PhaseSpan = {
  name: PlanPhase['name'];
  weeks: number;
  firstWeek: number;
  lastWeek: number;
};

export function planWeeks(plan: Plan): PlanWeek[] {
  return plan.phases.flatMap((phase) => phase.weeks);
}

/**
 * Planned running kilometres per week.
 *
 * Distance is an estimate off each session's target pace — the plan prescribes
 * minutes — so a session without a pace range contributes nothing. That makes
 * the total a floor rather than a guess: better a bar that under-reports than
 * one that invents kilometres from an assumed pace.
 */
export function weeklyVolume(plan: Plan): WeekVolume[] {
  return planWeeks(plan).map((week) => {
    const runs = week.sessions.filter((s) => s.sport === 'RUN' && s.type !== 'rest');
    return {
      index: week.index,
      isDeload: week.is_deload,
      km: runs.reduce(
        (total, s) => total + (estimateDistanceKm(s.duration_min, s.pace_range) ?? 0),
        0,
      ),
      minutes: runs.reduce((total, s) => total + s.duration_min, 0),
    };
  });
}

export function volumeValue(week: WeekVolume, metric: VolumeMetric): number {
  return metric === 'km' ? week.km : week.minutes;
}

/**
 * What each phase of a plan is for, in the athlete's words.
 *
 * Straight from the project's training-science reference (periodisation), not
 * invented copy: base builds aerobic volume, build introduces threshold then
 * VO2 work, peak sharpens at goal pace, taper cuts volume while keeping
 * intensity so freshness peaks on race day.
 */
export const PHASE_PURPOSE: Record<PlanPhase['name'], string> = {
  base:
    'Construire le moteur : du volume en endurance fondamentale, avec une seule ' +
    'séance de qualité légère par semaine. C’est la phase la plus longue, et la ' +
    'plus ingrate — c’est aussi celle qui rend les suivantes possibles.',
  build:
    'Ajouter de la vitesse sur la base construite : d’abord du seuil, puis du ' +
    'travail plus court et plus vif. Deux séances de qualité par semaine au ' +
    'maximum — au-delà, c’est la récupération qui casse, pas les jambes.',
  peak:
    'Courir à l’allure de l’objectif, pour que le jour J n’ait rien d’une ' +
    'découverte. Le volume se maintient, l’intensité devient spécifique.',
  taper:
    'Baisser le volume de 40 à 60 % en gardant l’intensité. Tu ne gagnes plus de ' +
    'forme ici : tu la laisses remonter à la surface pour le jour de course.',
};

/** Monday–Sunday range of a plan week, e.g. "22 – 28 juin". */
export function weekRangeLabel(startDateIso: string, weekPosition: number): string {
  const start = new Date(startDateIso);
  start.setDate(start.getDate() + weekPosition * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric' });
  const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  // Drop the month on the left side when both ends share it: "22 – 28 juin"
  // rather than "22 juin – 28 juin".
  const sameMonth = start.getMonth() === end.getMonth();
  return `${sameMonth ? day.format(start) : dayMonth.format(start)} – ${dayMonth.format(end)}`;
}

/** The plan's phases with the weeks each one spans. */
export function phaseSpans(plan: Plan): PhaseSpan[] {
  return plan.phases
    .filter((phase) => phase.weeks.length > 0)
    .map((phase) => ({
      name: phase.name,
      weeks: phase.weeks.length,
      firstWeek: phase.weeks[0].index,
      lastWeek: phase.weeks[phase.weeks.length - 1].index,
    }));
}

/**
 * Running sessions per week, as a range when the plan varies.
 *
 * A plan that runs 3 then 4 then 3 is a "3 à 4 séances" plan; reporting a mean
 * of 3.3 would describe no week that actually exists.
 */
export function runsPerWeek(plan: Plan): { min: number; max: number } | null {
  const counts = planWeeks(plan).map(
    (week) =>
      week.sessions.filter(
        (s) => s.sport === 'RUN' && s.type !== 'rest' && s.slot === 'primary',
      ).length,
  );
  if (counts.length === 0) return null;
  return { min: Math.min(...counts), max: Math.max(...counts) };
}
