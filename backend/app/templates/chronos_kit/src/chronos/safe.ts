/**
 * Internal guards for props that come from generated code. Not re-exported
 * from index.ts; components import these directly.
 */

/** Table lookup that only returns own keys, so "toString" or "__proto__" fall back. */
export function pick<V>(table: Readonly<Record<string, V>>, key: unknown, fallback: V): V {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rows or columns that are not an array become []. */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Finite number, or NaN. Accepts numeric strings ("42", "3.5"). */
export function toNum(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** Plain text for a label-like prop. Anything that is not a string or number becomes "". */
export function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
