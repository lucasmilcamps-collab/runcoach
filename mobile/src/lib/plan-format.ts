import { sportLabel } from '@/lib/activity-labels';
import type { PaceRange, PlanBlock, PlanPhase, PlanSession, Weekday } from '@/lib/api/plans';

export const PHASE_LABELS: Record<PlanPhase['name'], string> = {
  base: 'Base',
  build: 'Développement',
  peak: 'Pic',
  taper: 'Affûtage',
};

export const SESSION_LABELS: Record<PlanSession['type'], string> = {
  easy: 'Footing',
  long_run: 'Sortie longue',
  tempo: 'Tempo',
  threshold: 'Seuil',
  intervals: 'Fractionné',
  recovery: 'Récupération',
  cross_training: 'Cross-training',
  strength: 'Renforcement',
  test: 'Test',
  race: 'Course',
  rest: 'Repos',
};

/**
 * What a session should be called on screen.
 *
 * A running plan distinguishes its runs by training type — Footing, Tempo,
 * Sortie longue — so that's the useful name for them. Every other sport is
 * named by the sport itself, because "Cross-training" is the label that hides
 * precisely what the athlete needs to tell apart: a basket session from a padel
 * one. The sport is already on every session; only the UI was dropping it.
 *
 * OTHER keeps its type label — "Autre" would say less than "Cross-training".
 */
export function sessionTitle(session: Pick<PlanSession, 'sport' | 'type'>): string {
  if (session.sport === 'RUN' || session.sport === 'OTHER') return SESSION_LABELS[session.type];
  return sportLabel(session.sport);
}

const WEEKDAY_ORDER: Record<Weekday, number> = {
  MONDAY: 0,
  TUESDAY: 1,
  WEDNESDAY: 2,
  THURSDAY: 3,
  FRIDAY: 4,
  SATURDAY: 5,
  SUNDAY: 6,
};

/**
 * A week's sessions in calendar order (Monday first), with each day's add-on
 * (renfo…) right after the main session it hangs off.
 *
 * The plan's `sessions` array arrives in whatever order the generator emitted —
 * nothing upstream sorts it — so a Thursday session could render above a
 * Wednesday one, and the "Séance n/N" numbering followed that same wrong order.
 * Returns a new array: the source lives in the query cache and must not be
 * sorted in place.
 */
export function sortSessionsByDay<T extends Pick<PlanSession, 'day' | 'slot'>>(
  sessions: readonly T[],
): T[] {
  return [...sessions].sort((a, b) => {
    const byDay = WEEKDAY_ORDER[a.day] - WEEKDAY_ORDER[b.day];
    if (byDay !== 0) return byDay;
    return (a.slot === 'addon' ? 1 : 0) - (b.slot === 'addon' ? 1 : 0);
  });
}

export const DAY_LABELS: Record<Weekday, string> = {
  MONDAY: 'Lun',
  TUESDAY: 'Mar',
  WEDNESDAY: 'Mer',
  THURSDAY: 'Jeu',
  FRIDAY: 'Ven',
  SATURDAY: 'Sam',
  SUNDAY: 'Dim',
};

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest}`;
}

// --- Intensity: the Night-Trail "thermal" ramp (contour → blaze). One accent
// that heats up with zone, rather than a rainbow (DESIGN.md: one accent). ---

const ZONE_COLORS: Record<number, string> = {
  1: '#6B5A3E',
  2: '#8A6F47',
  3: '#B5722F',
  4: '#D66A28',
  5: '#E8792C',
};
const ZONE_HEIGHT_PCT: Record<number, number> = { 1: 22, 2: 36, 3: 55, 4: 78, 5: 100 };

export function zoneColor(zone: number): string {
  return ZONE_COLORS[Math.min(5, Math.max(1, zone))] ?? ZONE_COLORS[2];
}

export function zoneHeightPct(zone: number): number {
  return ZONE_HEIGHT_PCT[Math.min(5, Math.max(1, zone))] ?? 36;
}

const TYPE_ZONE: Record<PlanSession['type'], number> = {
  easy: 2,
  recovery: 1,
  long_run: 2,
  tempo: 3,
  threshold: 4,
  intervals: 5,
  cross_training: 2,
  strength: 2,
  test: 5,
  race: 4,
  rest: 1,
};

const TYPE_DIFFICULTY: Record<PlanSession['type'], number> = {
  recovery: 1,
  easy: 1,
  cross_training: 2,
  strength: 2,
  long_run: 3,
  tempo: 3,
  threshold: 4,
  intervals: 4,
  test: 4,
  race: 4,
  rest: 0,
};

/** Difficulty on a 0–4 lightning scale, derived from the session type. */
export function sessionDifficulty(type: PlanSession['type']): number {
  return TYPE_DIFFICULTY[type] ?? 2;
}

// On easy days the HR is a ceiling, not a target: you run by feel/pace and
// simply keep the heart rate under a cap (training-science: ~80% of volume in
// Z1–Z2). On quality sessions the zone is the actual target.
const HR_CEILING_TYPES = new Set<PlanSession['type']>([
  'easy',
  'recovery',
  'long_run',
  'cross_training',
]);

/** True when the HR zone should be shown as a ceiling ("≤ Zx") rather than a
 * target — i.e. on easy/recovery/long-run days. */
export function hrIsCeiling(type: PlanSession['type']): boolean {
  return HR_CEILING_TYPES.has(type);
}

function zoneFromLabel(label: string): number | null {
  const l = label.toLowerCase();
  if (/récup|recup|calme|cool|repos/.test(l)) return 1;
  if (/vma|fractionn|interval|sprint|répét|repet|\b800|\b400|\b200/.test(l)) return 5;
  if (/seuil|threshold/.test(l)) return 4;
  if (/tempo/.test(l)) return 3;
  if (/échauff|echauff|warm|footing|endurance|facile|easy|allure ef/.test(l)) return 2;
  return null;
}

/** Best zone estimate for a block: its own value, else the label, else the
 * session's zone, else the type's default. */
export function blockZone(block: PlanBlock, session: PlanSession): number {
  return block.hr_zone ?? zoneFromLabel(block.label) ?? session.hr_zone ?? TYPE_ZONE[session.type] ?? 2;
}

function paceMidSeconds(pace: PaceRange): number | null {
  const toSec = (v: string): number | null => {
    const m = v.match(/^(\d+):(\d{1,2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const low = toSec(pace.min_per_km_low);
  const high = toSec(pace.min_per_km_high);
  if (low == null && high == null) return null;
  if (low == null) return high;
  if (high == null) return low;
  return (low + high) / 2;
}

/** Rough distance (km) from a session's average pace × duration. */
export function estimateDistanceKm(durationMin: number, pace: PaceRange | null): number | null {
  if (!pace) return null;
  const secPerKm = paceMidSeconds(pace);
  if (!secPerKm) return null;
  return Math.round(((durationMin * 60) / secPerKm) * 10) / 10;
}
