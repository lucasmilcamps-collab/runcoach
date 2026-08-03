import type { Activity } from '@/lib/api/activities';
import type { PlanSession, PlanWeek, Weekday } from '@/lib/api/plans';
import type { SportType } from '@/lib/api/types';

/**
 * The data behind the Ledger — Relay's signature read-out (DESIGN.md).
 *
 * Seven day-columns on one shared baseline, every discipline posting to the same
 * account. The unit is **minutes**, deliberately: it is the one quantity that
 * exists for a planned session and a finished one alike, for a tempo run and for
 * a basket match, without anything being estimated into existence. Training load
 * proper (TRIMP → CTL/ATL/TSB) is computed server-side from heart rate and lives
 * in the Forme block; inventing a load figure for a padel match here so the bars
 * could be labelled "charge" would be a fabricated metric, not a better chart.
 */

export type LedgerEntry = {
  sport: SportType;
  minutes: number;
  /** Planned and not yet done — drawn as an outline rather than a fill. */
  planned: boolean;
};

/** What a day says about training load, and the only thing colour encodes here. */
export type DayState = 'go' | 'recup' | null;

export type LedgerDay = {
  weekday: Weekday;
  /** Monday = 0 — the column's position, not a calendar date. */
  index: number;
  isToday: boolean;
  isPast: boolean;
  entries: LedgerEntry[];
  doneMinutes: number;
  plannedMinutes: number;
  state: DayState;
};

export type SportTotal = { sport: SportType; minutes: number };

export type WeekLedger = {
  days: LedgerDay[];
  /** Tallest column, for scaling. Never zero, so an empty week still draws. */
  peakMinutes: number;
  /** Minutes per sport across the week, biggest first — the line that states
   * "cross-training is load" in words rather than in a colour legend. */
  totals: SportTotal[];
  doneMinutes: number;
  plannedMinutes: number;
};

const WEEKDAYS: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

/** Monday 00:00 of the week containing `d` (fr week starts Monday). */
function startOfWeek(d: Date): Date {
  const dayFromMonday = (d.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - dayFromMonday);
  return s;
}

/** Recovery-shaped session types — the days that are *supposed* to be quiet. */
const EASY_TYPES = new Set<PlanSession['type']>(['recovery', 'rest']);

function dayState(sessions: PlanSession[]): DayState {
  const live = sessions.filter((s) => s.type !== 'rest' && !s.skipped);
  if (live.length === 0) return 'recup';
  if (live.some((s) => s.priority === 'key')) return 'go';
  if (live.every((s) => EASY_TYPES.has(s.type))) return 'recup';
  return null;
}

/**
 * Build the current week's ledger from what was actually logged and what the
 * plan asks for.
 *
 * Realised minutes always win over planned ones on a given day and sport: once
 * Tuesday's basket is in, showing the planned outline beside it would double-
 * count the same session and make a normal week look like a crushing one.
 */
export function buildWeekLedger(
  activities: Activity[],
  week: PlanWeek | null,
  now: Date = new Date(),
): WeekLedger {
  const start = startOfWeek(now);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const todayIndex = (now.getDay() + 6) % 7;

  const done: Map<number, Map<SportType, number>> = new Map();
  for (const activity of activities) {
    const t = new Date(activity.start_time);
    if (t < start || t >= end) continue;
    const index = (t.getDay() + 6) % 7;
    const bySport = done.get(index) ?? new Map<SportType, number>();
    bySport.set(activity.sport, (bySport.get(activity.sport) ?? 0) + activity.duration_s / 60);
    done.set(index, bySport);
  }

  const planned: Map<number, PlanSession[]> = new Map();
  for (const session of week?.sessions ?? []) {
    const index = WEEKDAYS.indexOf(session.day);
    if (index < 0) continue;
    planned.set(index, [...(planned.get(index) ?? []), session]);
  }

  const days: LedgerDay[] = WEEKDAYS.map((weekday, index) => {
    const doneBySport = done.get(index) ?? new Map<SportType, number>();
    const daySessions = planned.get(index) ?? [];

    const entries: LedgerEntry[] = [...doneBySport.entries()]
      .map(([sport, minutes]) => ({ sport, minutes: Math.round(minutes), planned: false }))
      .sort((a, b) => b.minutes - a.minutes);

    for (const session of daySessions) {
      if (session.type === 'rest' || session.skipped) continue;
      // Already logged in that sport today → the realised bar is the truth.
      if (doneBySport.has(session.sport)) continue;
      entries.push({ sport: session.sport, minutes: session.duration_min, planned: true });
    }

    const doneMinutes = entries.reduce((sum, e) => sum + (e.planned ? 0 : e.minutes), 0);
    const plannedMinutes = entries.reduce((sum, e) => sum + (e.planned ? e.minutes : 0), 0);

    return {
      weekday,
      index,
      isToday: index === todayIndex,
      isPast: index < todayIndex,
      entries,
      doneMinutes,
      plannedMinutes,
      state: dayState(daySessions),
    };
  });

  const totalsBySport = new Map<SportType, number>();
  for (const day of days) {
    for (const entry of day.entries) {
      if (entry.planned) continue;
      totalsBySport.set(entry.sport, (totalsBySport.get(entry.sport) ?? 0) + entry.minutes);
    }
  }

  return {
    days,
    peakMinutes: Math.max(...days.map((d) => d.doneMinutes + d.plannedMinutes), 30),
    totals: [...totalsBySport.entries()]
      .map(([sport, minutes]) => ({ sport, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    doneMinutes: days.reduce((sum, d) => sum + d.doneMinutes, 0),
    plannedMinutes: days.reduce((sum, d) => sum + d.plannedMinutes, 0),
  };
}

export type OverloadLevel = 'low' | 'moderate' | 'high';

export type OverloadVerdict = {
  level: OverloadLevel;
  /** "Faible", "Modéré", "Élevé" — the tag beside the sentence. */
  word: string;
  /** The whole conclusion in plain French, including what is driving it. */
  sentence: string;
};

const OVERLOAD_LABEL: Record<OverloadLevel, string> = {
  low: 'Faible',
  moderate: 'Modéré',
  high: 'Élevé',
};

/**
 * The surcharge read-out above the ledger.
 *
 * The level comes straight from form (TSB) on the same thresholds the plan
 * engine uses (training-science: TSB < −25 is high fatigue, TSB > 5 is fresh) —
 * no second, prettier model invented for the UI. The clause after the dash names
 * the heaviest cross-training session of the last two days when there is one,
 * because that is the thing the athlete is actually weighing up, and it is a
 * fact read off their own log rather than an inference.
 *
 * Nothing here is medical: it reports load and recommends easing off, and the
 * app never diagnoses (PRODUCT.md).
 */
export function overloadVerdict(
  tsb: number | null,
  activities: Activity[],
  now: Date = new Date(),
): OverloadVerdict {
  const level: OverloadLevel = tsb == null ? 'moderate' : tsb > 5 ? 'low' : tsb < -25 ? 'high' : 'moderate';

  const since = new Date(now);
  since.setDate(since.getDate() - 2);
  const recentCross = activities
    .filter((a) => a.sport !== 'RUN' && new Date(a.start_time) >= since)
    .sort((a, b) => b.duration_s - a.duration_s)[0];

  const head =
    level === 'high'
      ? 'Fatigue marquée : allège les prochains jours'
      : level === 'low'
        ? 'Tu es frais : la semaine peut encaisser une séance dure'
        : 'Charge et récupération à l’équilibre';

  const because = recentCross
    ? ` — ${CROSS_LABEL[recentCross.sport] ?? 'ta séance'} ${when(recentCross.start_time, now)} pèse encore.`
    : '.';

  return { level, word: OVERLOAD_LABEL[level], sentence: `${head}${because}` };
}

const CROSS_LABEL: Partial<Record<SportType, string>> = {
  PADEL: 'le padel',
  BASKETBALL: 'le basket',
  BIKE: 'le vélo',
  STRENGTH: 'le renfo',
  OTHER: 'ta séance',
};

/** "de ce matin" / "d'hier" / "d'il y a 2 jours" — reads as part of the sentence
 * it is dropped into, rather than as a duration stitched onto it. */
function when(iso: string, now: Date): string {
  const then = new Date(iso);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((midnight.getTime() - then.getTime()) / 86_400_000) + 1;
  if (days <= 0) return 'de ce matin';
  if (days === 1) return 'd’hier';
  return `d’il y a ${days} jours`;
}
