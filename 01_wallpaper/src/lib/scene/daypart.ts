// Daypart (Stage D, 2026-07-01) — minimal day/night visual switch.
//
// Deliberately binary (day | night), not the richer morning/midday/evening/
// night model from docs/LIFE_MODE_DESIGN_2026-06-12.md — that model governs
// Director *behavior* bias; this one only picks which background/lighting
// variant to show. Framework-agnostic (no THREE/DOM import) so it stays
// Node-testable like the rest of src/lib/scene and src/lib/motion.

export type Daypart = 'day' | 'night';

/** Local-clock day window: [dayStartHour, dayEndHour). Outside it is night. */
export const DAY_START_HOUR = 6;
export const DAY_END_HOUR = 18;

/** Local-time day/night from a Date's own hour (whatever timezone the host is in). */
export function getDaypart(date: Date): Daypart {
  const h = date.getHours();
  return h >= DAY_START_HOUR && h < DAY_END_HOUR ? 'day' : 'night';
}

/**
 * Resolve the effective daypart: an explicit override wins (the hook a future
 * Companion "display" setting can use — e.g. force night for a screenshot —
 * without this module or its callers changing shape), 'auto'/undefined falls
 * back to the local clock.
 */
export function resolveDaypart(override: Daypart | 'auto' | undefined, date: Date): Daypart {
  if (override === 'day' || override === 'night') return override;
  return getDaypart(date);
}
