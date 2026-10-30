import type { Duration, DurationUnit } from "./types";

const HOURS: Record<DurationUnit, number> = {
  minutes: 1 / 60,
  hours: 1,
  // Calendar time: a day of waiting is a day, not 8 working hours.
  days: 24,
  weeks: 24 * 7,
};

export function toHours(d: Duration, which: "min" | "max" = "max"): number {
  return d[which] * HOURS[d.unit];
}

const SHORT: Record<DurationUnit, [string, string]> = {
  minutes: ["min", "min"],
  hours: ["hour", "hours"],
  days: ["day", "days"],
  weeks: ["week", "weeks"],
};

export function formatDuration(d: Duration | null | undefined): string {
  if (!d) return "None";
  const [one, many] = SHORT[d.unit];
  if (d.min === d.max) return `${d.min} ${d.min === 1 ? one : many}`;
  return `${d.min}–${d.max} ${many}`;
}

// Log scale so "20 minutes" and "8 weeks" can share one bar without the short one vanishing.
export function routeScale(hours: number): number {
  return Math.log10(1 + hours * 4);
}
