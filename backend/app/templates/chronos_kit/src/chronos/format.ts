/**
 * Display formatting. Deterministic and locale-pinned so SSR-free SPA renders
 * and re-renders agree. Every formatter returns "—" for a missing, NaN or
 * otherwise invalid value instead of throwing or printing "NaN".
 */

import { toNum } from "./safe";

const EMPTY = "—";

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-US");

/** Integer 0..10 for toFixed; anything else uses the default. */
function places(value: unknown, fallback: number): number {
  const n = toNum(value);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : fallback;
}

export function usd(amount: number | null | undefined, opts: { cents?: boolean } = {}): string {
  const n = toNum(amount);
  if (Number.isNaN(n)) return EMPTY;
  return opts?.cents ? USD_CENTS.format(n) : USD_WHOLE.format(n);
}

/** Compact money for KPI tiles: $1.84M, $782K. */
export function usdCompact(amount: number | null | undefined): string {
  const n = toNum(amount);
  if (Number.isNaN(n)) return EMPTY;
  const abs = Math.abs(n);
  if (abs >= 999_500) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return USD_WHOLE.format(n);
}

export function count(n: number | null | undefined): string {
  const v = toNum(n);
  return Number.isNaN(v) ? EMPTY : NUM.format(v);
}

/** Expects a fraction: 0.42 becomes "42.0%". */
export function percent(fraction: number | null | undefined, digits: number = 1): string {
  const v = toNum(fraction);
  return Number.isNaN(v) ? EMPTY : `${(v * 100).toFixed(places(digits, 1))}%`;
}

/** Expects a percentage number: 4.2 becomes "+4.2%". */
export function signedPercent(pct: number | null | undefined, digits: number = 1): string {
  const v = toNum(pct);
  if (Number.isNaN(v)) return EMPTY;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(places(digits, 1))}%`;
}

/** "3m ago", "in 2h", "5d ago". `now` defaults to the current time. */
export function relativeTime(
  iso: string | Date | number | null | undefined,
  now: number = Date.now(),
): string {
  if (iso == null) return EMPTY;
  const time = new Date(iso).getTime();
  const reference = toNum(now);
  if (Number.isNaN(time)) return EMPTY;
  const diff = (Number.isNaN(reference) ? Date.now() : reference) - time;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

/** Fixed YYYY-MM-DD (UTC) so output does not depend on the viewer's locale. */
export function shortDate(iso: string | Date | number | null | undefined): string {
  if (iso == null) return EMPTY;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? EMPTY : date.toISOString().slice(0, 10);
}
