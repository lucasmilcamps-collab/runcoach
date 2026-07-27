import type { PlanPhase, PlanSession, Weekday } from '@/lib/api/plans';

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
  rest: 'Repos',
};

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
