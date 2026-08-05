import type { Activity } from '@/lib/api/activities';
import type { PlanSession, PlanWeek, Weekday } from '@/lib/api/plans';
import type { SportType } from '@/lib/api/types';
import { buildWeekLedger, overloadVerdict } from '@/lib/week-ledger';

/**
 * The ledger is Accueil's signature read-out, and every number on it is derived
 * rather than fetched — which is exactly the kind of code that breaks silently.
 * Two things are load-bearing and neither is visible in a screenshot: where a
 * day boundary falls, and the rule that a realised session replaces the planned
 * one instead of stacking on top of it.
 *
 * Dates are always passed in explicitly (`now`), so nothing here depends on when
 * the suite runs.
 */

// Wednesday 5 August 2026, 09:00 local. Its week runs Mon 3 → Sun 9.
const WEDNESDAY = new Date(2026, 7, 5, 9, 0, 0);

function activity(over: Partial<Activity> & { start_time: string }): Activity {
  return {
    id: Math.random().toString(36).slice(2),
    garmin_activity_id: null,
    sport: 'RUN',
    garmin_type_key: null,
    duration_s: 45 * 60,
    distance_m: null,
    avg_hr: null,
    max_hr: null,
    training_load: null,
    manual: false,
    rpe: null,
    note: null,
    ...over,
  };
}

function session(over: Partial<PlanSession> = {}): PlanSession {
  return {
    day: 'WEDNESDAY',
    sport: 'RUN',
    type: 'easy',
    duration_min: 45,
    structure: [],
    pace_range: null,
    hr_zone: 2,
    priority: 'optional',
    slot: 'primary',
    rationale: '',
    skipped: false,
    ...over,
  };
}

function week(sessions: PlanSession[]): PlanWeek {
  return { index: 6, is_deload: false, target_load: 300, sessions };
}

/** The column for a weekday, by name rather than by index. */
function day(ledger: ReturnType<typeof buildWeekLedger>, weekday: Weekday) {
  return ledger.days.find((d) => d.weekday === weekday)!;
}

describe('buildWeekLedger — day boundaries', () => {
  it('always lays out Monday first through Sunday', () => {
    const ledger = buildWeekLedger([], null, WEDNESDAY);
    expect(ledger.days.map((d) => d.weekday)).toEqual([
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ]);
  });

  it('files Sunday in the last column, not the first', () => {
    // The JS week starts on Sunday and ours starts on Monday; getting this
    // wrong moves a long run to the far side of the chart.
    const ledger = buildWeekLedger(
      [activity({ start_time: new Date(2026, 7, 9, 10, 0).toISOString(), duration_s: 90 * 60 })],
      null,
      WEDNESDAY,
    );
    expect(day(ledger, 'SUNDAY').doneMinutes).toBe(90);
    expect(day(ledger, 'MONDAY').doneMinutes).toBe(0);
  });

  it('keeps Monday 00:05 inside the week and Sunday 23:55 of the week before outside it', () => {
    const ledger = buildWeekLedger(
      [
        activity({ start_time: new Date(2026, 7, 3, 0, 5).toISOString(), duration_s: 30 * 60 }),
        activity({ start_time: new Date(2026, 7, 2, 23, 55).toISOString(), duration_s: 60 * 60 }),
      ],
      null,
      WEDNESDAY,
    );
    expect(day(ledger, 'MONDAY').doneMinutes).toBe(30);
    expect(ledger.doneMinutes).toBe(30);
  });

  it('marks today and the days already gone', () => {
    const ledger = buildWeekLedger([], null, WEDNESDAY);
    expect(day(ledger, 'WEDNESDAY').isToday).toBe(true);
    expect(day(ledger, 'TUESDAY').isPast).toBe(true);
    expect(day(ledger, 'THURSDAY').isPast).toBe(false);
  });
});

describe('buildWeekLedger — realised versus planned', () => {
  it('drops the planned bar once that sport is logged on the day', () => {
    // Otherwise Tuesday's basket is counted twice and an ordinary week draws as
    // a crushing one — the single most misleading thing this chart could do.
    const ledger = buildWeekLedger(
      [
        activity({
          sport: 'BASKETBALL',
          start_time: new Date(2026, 7, 4, 20, 0).toISOString(),
          duration_s: 92 * 60,
        }),
      ],
      week([session({ day: 'TUESDAY', sport: 'BASKETBALL', duration_min: 90 })]),
      WEDNESDAY,
    );

    const tuesday = day(ledger, 'TUESDAY');
    expect(tuesday.entries).toHaveLength(1);
    expect(tuesday.doneMinutes).toBe(92);
    expect(tuesday.plannedMinutes).toBe(0);
  });

  it('keeps a planned session in another sport on a day that already has one logged', () => {
    const ledger = buildWeekLedger(
      [
        activity({
          sport: 'RUN',
          start_time: new Date(2026, 7, 6, 7, 0).toISOString(),
          duration_s: 40 * 60,
        }),
      ],
      week([
        session({ day: 'THURSDAY', sport: 'RUN', duration_min: 45 }),
        session({ day: 'THURSDAY', sport: 'STRENGTH', duration_min: 30, slot: 'addon' }),
      ]),
      WEDNESDAY,
    );

    const thursday = day(ledger, 'THURSDAY');
    expect(thursday.doneMinutes).toBe(40);
    expect(thursday.plannedMinutes).toBe(30);
    expect(thursday.entries.map((e) => e.sport)).toEqual(['RUN', 'STRENGTH']);
  });

  it('ignores rest days and sessions the athlete declared skipped', () => {
    const ledger = buildWeekLedger(
      [],
      week([
        session({ day: 'MONDAY', type: 'rest', duration_min: 0 }),
        session({ day: 'FRIDAY', duration_min: 50, skipped: true }),
      ]),
      WEDNESDAY,
    );
    expect(day(ledger, 'MONDAY').entries).toHaveLength(0);
    expect(day(ledger, 'FRIDAY').entries).toHaveLength(0);
    expect(ledger.plannedMinutes).toBe(0);
  });

  it('sums two activities in the same sport on the same day', () => {
    const ledger = buildWeekLedger(
      [
        activity({ start_time: new Date(2026, 7, 5, 7, 0).toISOString(), duration_s: 30 * 60 }),
        activity({ start_time: new Date(2026, 7, 5, 18, 0).toISOString(), duration_s: 25 * 60 }),
      ],
      null,
      WEDNESDAY,
    );
    expect(day(ledger, 'WEDNESDAY').doneMinutes).toBe(55);
  });
});

describe('buildWeekLedger — scale and totals', () => {
  it('never scales to zero, so an empty week still draws its baseline', () => {
    expect(buildWeekLedger([], null, WEDNESDAY).peakMinutes).toBe(30);
  });

  it('scales to the tallest column, planned included', () => {
    const ledger = buildWeekLedger(
      [
        activity({
          sport: 'BASKETBALL',
          start_time: new Date(2026, 7, 4, 20, 0).toISOString(),
          duration_s: 92 * 60,
        }),
      ],
      week([session({ day: 'SUNDAY', duration_min: 110 })]),
      WEDNESDAY,
    );
    expect(ledger.peakMinutes).toBe(110);
  });

  it('totals realised minutes per sport, biggest first, and never counts a planned one', () => {
    const ledger = buildWeekLedger(
      [
        activity({ start_time: new Date(2026, 7, 3, 7, 0).toISOString(), duration_s: 40 * 60 }),
        activity({
          sport: 'BASKETBALL',
          start_time: new Date(2026, 7, 4, 20, 0).toISOString(),
          duration_s: 92 * 60,
        }),
      ],
      week([session({ day: 'SUNDAY', duration_min: 110 })]),
      WEDNESDAY,
    );

    expect(ledger.totals).toEqual([
      { sport: 'BASKETBALL' as SportType, minutes: 92 },
      { sport: 'RUN' as SportType, minutes: 40 },
    ]);
    expect(ledger.doneMinutes).toBe(132);
    expect(ledger.plannedMinutes).toBe(110);
  });

  it('never folds cross-training into one bucket', () => {
    // The product's whole argument: padel and basket post to the same account,
    // as themselves.
    const ledger = buildWeekLedger(
      [
        activity({
          sport: 'PADEL',
          start_time: new Date(2026, 7, 3, 19, 0).toISOString(),
          duration_s: 60 * 60,
        }),
        activity({
          sport: 'BASKETBALL',
          start_time: new Date(2026, 7, 4, 20, 0).toISOString(),
          duration_s: 90 * 60,
        }),
      ],
      null,
      WEDNESDAY,
    );
    expect(ledger.totals.map((t) => t.sport)).toEqual(['BASKETBALL', 'PADEL']);
  });
});

describe('buildWeekLedger — day state', () => {
  it('marks a day carrying a key session as Go', () => {
    const ledger = buildWeekLedger(
      [],
      week([session({ day: 'SATURDAY', type: 'tempo', priority: 'key' })]),
      WEDNESDAY,
    );
    expect(day(ledger, 'SATURDAY').state).toBe('go');
  });

  it('marks an empty day and an all-recovery day as Récup', () => {
    const ledger = buildWeekLedger(
      [],
      week([session({ day: 'FRIDAY', type: 'recovery' })]),
      WEDNESDAY,
    );
    expect(day(ledger, 'MONDAY').state).toBe('recup');
    expect(day(ledger, 'FRIDAY').state).toBe('recup');
  });

  it('leaves an ordinary session day unmarked', () => {
    const ledger = buildWeekLedger([], week([session({ day: 'THURSDAY' })]), WEDNESDAY);
    expect(day(ledger, 'THURSDAY').state).toBeNull();
  });

  it('treats a skipped key session as no longer keying the day', () => {
    const ledger = buildWeekLedger(
      [],
      week([session({ day: 'SATURDAY', priority: 'key', skipped: true })]),
      WEDNESDAY,
    );
    expect(day(ledger, 'SATURDAY').state).toBe('recup');
  });
});

describe('overloadVerdict', () => {
  // These thresholds mirror plan_adaptation's own (training-science: TSB < −25
  // is high fatigue, TSB > 5 is fresh). If they drift apart, the app tells the
  // athlete they are fresh while the engine quietly downgrades their session.
  it('reads above +5 as low risk', () => {
    expect(overloadVerdict(12, [], WEDNESDAY).level).toBe('low');
  });

  it('reads below −25 as high risk', () => {
    expect(overloadVerdict(-30, [], WEDNESDAY).level).toBe('high');
  });

  it('reads the band between as moderate, boundaries included', () => {
    expect(overloadVerdict(5, [], WEDNESDAY).level).toBe('moderate');
    expect(overloadVerdict(-25, [], WEDNESDAY).level).toBe('moderate');
    expect(overloadVerdict(0, [], WEDNESDAY).level).toBe('moderate');
  });

  it('falls back to moderate when there is no form yet', () => {
    const verdict = overloadVerdict(null, [], WEDNESDAY);
    expect(verdict.level).toBe('moderate');
    expect(verdict.word).toBe('Modéré');
  });

  it('names the recent cross-training session that is driving the fatigue', () => {
    const verdict = overloadVerdict(
      -30,
      [
        activity({
          sport: 'BASKETBALL',
          start_time: new Date(2026, 7, 4, 20, 0).toISOString(),
          duration_s: 90 * 60,
        }),
      ],
      WEDNESDAY,
    );
    expect(verdict.sentence).toContain('le basket');
    expect(verdict.sentence).toContain('d’hier');
  });

  it('ignores runs — the athlete is weighing up the other sports', () => {
    const verdict = overloadVerdict(
      -30,
      [
        activity({
          sport: 'RUN',
          start_time: new Date(2026, 7, 4, 7, 0).toISOString(),
          duration_s: 60 * 60,
        }),
      ],
      WEDNESDAY,
    );
    expect(verdict.sentence).not.toContain('pèse encore');
  });

  it('ignores a cross-training session older than two days', () => {
    const verdict = overloadVerdict(
      -30,
      [
        activity({
          sport: 'PADEL',
          start_time: new Date(2026, 6, 28, 19, 0).toISOString(),
          duration_s: 60 * 60,
        }),
      ],
      WEDNESDAY,
    );
    expect(verdict.sentence).not.toContain('le padel');
  });
});
