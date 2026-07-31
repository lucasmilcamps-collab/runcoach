import type { Plan, PlanPhase, PlanWeek } from '@/lib/api/plans';
import { estimateDistanceKm } from '@/lib/plan-format';

/** One week's planned running volume, for the volume chart. */
export type WeekVolume = {
  index: number;
  km: number;
  isDeload: boolean;
};

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
  return planWeeks(plan).map((week) => ({
    index: week.index,
    isDeload: week.is_deload,
    km: week.sessions.reduce((total, session) => {
      if (session.sport !== 'RUN' || session.type === 'rest') return total;
      return total + (estimateDistanceKm(session.duration_min, session.pace_range) ?? 0);
    }, 0),
  }));
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
