import type { Activity } from '@/lib/api/activities';
import type { SportType } from '@/lib/api/types';

// Fallback labels by sport, used for manually-logged sessions (no Garmin type key).
const SPORT_LABELS: Record<SportType, string> = {
  RUN: 'Course à pied',
  PADEL: 'Padel',
  BASKETBALL: 'Basket',
  BIKE: 'Vélo',
  STRENGTH: 'Renforcement',
  OTHER: 'Autre',
};

// French labels for the Garmin activity type keys we've seen; anything not
// listed falls back to the prettified key so the UI never just says "Autre".
const GARMIN_TYPE_LABELS: Record<string, string> = {
  running: 'Course à pied',
  treadmill_running: 'Tapis de course',
  trail_running: 'Trail',
  track_running: 'Piste',
  virtual_run: 'Course virtuelle',
  walking: 'Marche',
  hiking: 'Randonnée',
  cycling: 'Vélo',
  road_biking: 'Vélo route',
  mountain_biking: 'VTT',
  gravel_cycling: 'Gravel',
  indoor_cycling: 'Vélo indoor',
  virtual_ride: 'Vélo virtuel',
  lap_swimming: 'Natation',
  open_water_swimming: 'Natation eau libre',
  strength_training: 'Renforcement',
  indoor_cardio: 'Cardio',
  cardio: 'Cardio',
  yoga: 'Yoga',
  pilates: 'Pilates',
  elliptical: 'Elliptique',
  stair_climbing: 'Escaliers',
  tennis: 'Tennis',
  padel: 'Padel',
  paddelball: 'Padel',
  paddle_ball: 'Padel',
  basketball: 'Basket',
  soccer: 'Football',
  fitness_equipment: 'Musculation',
  multi_sport: 'Multisport',
};

/** Short sport name (manual/fallback label by sport type). */
export function sportLabel(sport: SportType): string {
  return SPORT_LABELS[sport] ?? 'Activité';
}

function prettifyKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function activityLabel(activity: Pick<Activity, 'garmin_type_key' | 'sport'>): string {
  const key = activity.garmin_type_key;
  if (!key) return SPORT_LABELS[activity.sport] ?? 'Activité';
  return GARMIN_TYPE_LABELS[key.toLowerCase()] ?? prettifyKey(key);
}
