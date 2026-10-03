// Durations written as `<n><unit>` with a whole number and one unit:
// s (seconds), m (minutes), h (hours), d (days), e.g. "90s", "5m", "28d".

const UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

const DURATION_PATTERN = /^(\d{1,9})([smhd])$/;

// Milliseconds, or null when `raw` is not in the format above. Surrounding
// whitespace is ignored; units are lower case only.
export function parseDuration(raw: string): number | null {
  const match = DURATION_PATTERN.exec(raw.trim());
  if (!match) return null;
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS];
}

// The shortest exact form of `ms` in the same notation (e.g. 300000 -> "5m"),
// for log lines.
export function formatDuration(ms: number): string {
  for (const unit of ["d", "h", "m"] as const) {
    if (ms % UNIT_MS[unit] === 0) return `${ms / UNIT_MS[unit]}${unit}`;
  }
  return `${Math.round(ms / UNIT_MS.s)}s`;
}
