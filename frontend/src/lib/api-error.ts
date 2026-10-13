/**
 * One place that turns a failed API call into a sentence a person can read.
 *
 * FastAPI sends `detail` as a string for our own errors, as a list of
 * `{loc, msg}` objects for validation errors (422), and occasionally as an
 * object. Pages read `error.response.data.detail` directly, so the axios
 * interceptor in `api.ts` rewrites it to the string produced here: no page can
 * end up rendering "[object Object]" or a JSON dump.
 */

type ValidationItem = { loc?: unknown; msg?: unknown };

const FIELD_NOISE = new Set(["body", "query", "path", "header", "cookie"]);

function fieldLabel(loc: unknown): string {
  if (!Array.isArray(loc)) return "";
  const parts = loc.filter((p) => typeof p === "string" && !FIELD_NOISE.has(p)) as string[];
  const last = parts[parts.length - 1];
  if (!last) return "";
  const words = last.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Pydantic's stock phrases, reworded to follow a field name: "Password must be at least 10 characters". */
const PYDANTIC_PHRASES: [RegExp, string][] = [
  [/^String should have at least (\d+) characters?$/i, "must be at least $1 characters"],
  [/^String should have at most (\d+) characters?$/i, "must be at most $1 characters"],
  [/^Field required$/i, "is required"],
  [/^Input should be a valid (.+)$/i, "must be a valid $1"],
  [/^Input should be greater than or equal to (.+)$/i, "must be at least $1"],
  [/^Input should be less than or equal to (.+)$/i, "must be at most $1"],
  [/^Input should be greater than (.+)$/i, "must be greater than $1"],
  [/^Input should be less than (.+)$/i, "must be less than $1"],
];

function validationMessage(items: ValidationItem[]): string {
  const lines = items
    .map((item) => {
      const raw = typeof item?.msg === "string" ? item.msg.trim() : "";
      if (!raw) return "";
      // Pydantic prefixes custom validator messages with "Value error, ".
      const custom = /^Value error,\s*/i.test(raw);
      const msg = raw.replace(/^Value error,\s*/i, "");
      const field = fieldLabel(item.loc);
      // A custom validator's message is already a full sentence about the field.
      if (!field || custom) return msg;
      for (const [pattern, replacement] of PYDANTIC_PHRASES) {
        if (pattern.test(msg)) return `${field} ${msg.replace(pattern, replacement)}`;
      }
      return `${field}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}`;
    })
    .filter(Boolean);
  return Array.from(new Set(lines)).join(". ");
}

/** The `detail` payload as text, or "" when it carries nothing readable. */
export function detailToText(detail: unknown): string {
  if (typeof detail === "string") return detail.trim();
  if (Array.isArray(detail)) return validationMessage(detail as ValidationItem[]);
  if (detail && typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    for (const key of ["message", "msg", "error", "detail"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

/** What to say for a status code when the server sent no usable message. */
export function statusFallback(status: number | undefined): string {
  switch (status) {
    case 400:
      return "The request was not valid. Check the values and try again.";
    case 401:
      return "Your session has expired. Sign in again.";
    case 403:
      return "You do not have access to this.";
    case 404:
      return "That item was not found. It may have been removed.";
    case 408:
    case 504:
      return "The request timed out. Try again.";
    case 409:
      return "This conflicts with the current state. Refresh and try again.";
    case 410:
      return "This workspace has expired. Open the repository again to continue.";
    case 413:
      return "That is too large to process. Try a smaller input.";
    case 422:
      return "Some values are missing or not valid. Check the form and try again.";
    case 429:
      return "The rate limit was reached. Wait a moment and try again.";
    case 502:
      return "The AI model did not return a usable answer. Try again.";
    case 503:
      return "This service is not available right now. If it needs an integration, check Settings → Connectors.";
    default:
      if (status && status >= 500) return "The server could not complete the request. Try again.";
      return "The request failed. Try again.";
  }
}

export const NETWORK_ERROR_MESSAGE =
  "Could not reach the server. Check your connection and that the backend is running.";

type AxiosLike = {
  response?: { status?: number; data?: unknown };
  message?: string;
  code?: string;
};

/**
 * A human message for any thrown value. `fallback` is used only when neither
 * the server nor the status code says anything specific.
 */
export function apiErrorMessage(error: unknown, fallback?: string): string {
  const e = (error ?? {}) as AxiosLike;
  if (e.response) {
    const data = e.response.data;
    const detail = data && typeof data === "object" ? (data as { detail?: unknown }).detail : undefined;
    const text = detailToText(detail);
    if (text) return text;
    return fallback || statusFallback(e.response.status);
  }
  if (e.code === "ERR_CANCELED") return "The request was cancelled.";
  if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return "The request timed out. Try again.";
  if (e.code === "ERR_NETWORK" || e.message === "Network Error") return NETWORK_ERROR_MESSAGE;
  if (typeof e.message === "string" && e.message && !/^Request failed with status code/.test(e.message)) {
    return e.message;
  }
  return fallback || "Something went wrong. Try again.";
}
