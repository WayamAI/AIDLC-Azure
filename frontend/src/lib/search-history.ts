const STORAGE_KEY = "aidlc-search-history";
const MAX_ENTRIES = 12;

export type SearchHistoryEntry = {
  title: string;
  url: string;
  section?: string;
  visitedAt: number;
};

function readRaw(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SearchHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.url === "string" && typeof e.title === "string");
  } catch {
    return [];
  }
}

function writeRaw(entries: SearchHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota */
  }
}

export function getSearchHistory(): SearchHistoryEntry[] {
  return readRaw().sort((a, b) => b.visitedAt - a.visitedAt).slice(0, MAX_ENTRIES);
}

export function pushSearchHistory(entry: Omit<SearchHistoryEntry, "visitedAt">): SearchHistoryEntry[] {
  const next: SearchHistoryEntry = { ...entry, visitedAt: Date.now() };
  const filtered = readRaw().filter((e) => e.url !== entry.url);
  const updated = [next, ...filtered].slice(0, MAX_ENTRIES);
  writeRaw(updated);

  void import("@/lib/api")
    .then(({ api }) =>
      api.pushActivityHistory({
        kind: "search",
        title: entry.title,
        url: entry.url,
        section: entry.section,
      }),
    )
    .catch(() => undefined);

  return updated;
}

export function clearSearchHistory(): void {
  writeRaw([]);
  void import("@/lib/api")
    .then(({ api }) => api.clearActivityHistory("search"))
    .catch(() => undefined);
}

/** Merge server history into local cache (call when opening the palette). */
export async function syncSearchHistoryFromServer(): Promise<SearchHistoryEntry[]> {
  try {
    const { api } = await import("@/lib/api");
    const { items } = await api.listActivityHistory({ kind: "search", limit: MAX_ENTRIES });
    const mapped: SearchHistoryEntry[] = items.map((i) => ({
      title: i.title,
      url: i.url,
      section: i.section ?? undefined,
      visitedAt: i.visited_at ? Date.parse(i.visited_at) || Date.now() : Date.now(),
    }));
    const byUrl = new Map<string, SearchHistoryEntry>();
    for (const e of [...mapped, ...readRaw()]) {
      const prev = byUrl.get(e.url);
      if (!prev || e.visitedAt > prev.visitedAt) byUrl.set(e.url, e);
    }
    const merged = [...byUrl.values()].sort((a, b) => b.visitedAt - a.visitedAt).slice(0, MAX_ENTRIES);
    writeRaw(merged);
    return merged;
  } catch {
    return getSearchHistory();
  }
}
