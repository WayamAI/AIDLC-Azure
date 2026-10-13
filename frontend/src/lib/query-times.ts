/**
 * How long GitHub-backed data stays fresh in the browser. Unauthenticated GitHub
 * allows 60 requests an hour, and the server caches these calls for a few minutes
 * anyway, so re-asking on every page visit only spends rate limit. Pages that
 * need newer data expose an explicit refresh.
 */
export const GITHUB_STALE_MS = 5 * 60 * 1000;
