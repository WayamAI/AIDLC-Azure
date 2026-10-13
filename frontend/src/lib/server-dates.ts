/**
 * The API stores every timestamp in UTC, but MongoDB hands them back without an
 * offset ("2026-10-13T07:25:00.123"). `new Date()` reads such a string as local
 * time, so every stored time would be shown shifted by the viewer's UTC offset.
 * The axios response interceptor runs this over each payload once, so pages can
 * keep using `new Date(value)` and get the right instant.
 *
 * Only fields that are named like a timestamp are touched, and user or generated
 * content (synthetic data rows, pasted series, file contents) is never entered:
 * a date-like string in someone's data must come back exactly as it was stored.
 */

const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?$/;

/** created_at, timestamp, started, last_run_time, date … */
const TIMESTAMP_KEY = /(^|_)(at|on|timestamp|time|date|datetime|created|updated|started|completed|finished|resolved|triggered)$/i;

/** Subtrees that hold content rather than records. */
const CONTENT_KEYS = new Set(["rows", "series", "content", "files", "preview", "schema_fields", "steps", "payload", "data"]);

/** "…T07:25:00" becomes "…T07:25:00Z"; anything else is returned unchanged. */
export function asUtcIso(value: string): string {
  return value.length >= 19 && value.length <= 29 && NAIVE_ISO.test(value) ? `${value}Z` : value;
}

/** Marks offset-less ISO values of timestamp-named fields in a JSON payload as UTC, in place. */
export function markServerDatesUtc<T>(data: T, depth = 0): T {
  if (!data || typeof data !== "object" || depth > 12) return data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object") markServerDatesUtc(item, depth + 1);
    }
    return data;
  }
  // Only plain JSON objects: leave Blob, ArrayBuffer and friends alone.
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return data;
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const item = record[key];
    if (typeof item === "string") {
      if (TIMESTAMP_KEY.test(key)) record[key] = asUtcIso(item);
    } else if (item && typeof item === "object" && !CONTENT_KEYS.has(key)) {
      markServerDatesUtc(item, depth + 1);
    }
  }
  return data;
}
