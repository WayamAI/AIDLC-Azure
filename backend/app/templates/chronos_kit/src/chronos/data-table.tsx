/**
 * Dense operational table.
 *
 * One component for every queue: a real table with sticky identity +
 * horizontal scroll when there is room, and a stacked card list when the
 * container is too narrow to hold the columns. Optional search, sort,
 * pagination, row selection, CSV export, serial numbers and column
 * reordering sit on top of that without pages re-implementing them.
 *
 * Width-driven layout is measured on the component's own box (ResizeObserver),
 * not the viewport, so a table in a narrow panel stacks even on a wide screen.
 */

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  GripVertical,
  Search,
} from "lucide-react";
import {
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { SectionBoundary } from "./boundary";
import { cx } from "./cx";
import { EmptyState } from "./primitives";
import { asArray, isRecord, toText } from "./safe";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: string;
  dir: SortDir;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Tailwind width class, e.g. "w-28". Omit to size by content. */
  width?: string;
  align?: "left" | "right";
  /**
   * Hide this column in the table below a container width (md: 960px,
   * lg: 1200px). The stacked card still includes it unless `card` is false.
   */
  hide?: "md" | "lg";
  /**
   * How this column appears in the stacked (narrow) layout.
   * Defaults: first column is the title, first right-aligned is the metric.
   */
  card?: boolean | "title" | "metric";
  render: (row: T) => ReactNode;
  /**
   * Primitive used to sort, search and export this column.
   * Columns without a value are not sortable.
   */
  value?: (row: T) => string | number | boolean | null | undefined;
}

/** Container width at which the table replaces the stacked cards. */
const TABLE_MIN_WIDTH = 720;
const HIDE_BELOW: Record<NonNullable<Column<unknown>["hide"]>, number> = {
  md: 960,
  lg: 1200,
};

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function toPageSize(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Object rows only (null, primitives and duplicate references are skipped). */
function cleanRows<T>(rows: unknown): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const row of asArray<unknown>(rows)) {
    if (typeof row !== "object" || row === null || seen.has(row)) continue;
    seen.add(row);
    out.push(row as T);
  }
  return out;
}

function isPrimitiveValue(v: unknown): v is string | number | boolean | null | undefined {
  return v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Columns without a usable key are repaired; sort/search/export values never throw or return objects. */
function cleanColumns<T>(columns: unknown): Column<T>[] {
  const used = new Set<string>();
  const out: Column<T>[] = [];
  asArray<unknown>(columns).forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const source = raw as unknown as Column<T>;
    const base = typeof raw.key === "string" && raw.key ? raw.key : `column-${index}`;
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}#${n++}`;
    used.add(key);
    const valueFn = typeof source.value === "function" ? source.value : undefined;
    out.push({
      ...source,
      key,
      header: toText(raw.header) || key,
      align: raw.align === "right" ? "right" : "left",
      render:
        typeof source.render === "function"
          ? source.render
          : (row: T) => {
              const v = isRecord(row) ? row[key] : undefined;
              return v != null && isPrimitiveValue(v) ? String(v) : "";
            },
      value: valueFn
        ? (row: T) => {
            try {
              const v: unknown = valueFn(row);
              if (typeof v === "number" && !Number.isFinite(v)) return null;
              return isPrimitiveValue(v) ? v : String(v);
            } catch {
              return null;
            }
          }
        : undefined,
    });
  });
  return out;
}

/** Keys from rowKey; a missing or duplicate key falls back to the row index (suffixed if taken). */
function buildRowKeys<T>(rows: T[], rowKey: (row: T) => string): Map<T, string> {
  const keys = new Map<T, string>();
  const used = new Set<string>();
  rows.forEach((row, index) => {
    let raw: unknown;
    try {
      raw = rowKey(row);
    } catch {
      raw = undefined;
    }
    const base = raw == null || raw === "" ? String(index) : String(raw);
    let key = base;
    let n = 2;
    while (used.has(key)) key = `${base}#${n++}`;
    used.add(key);
    keys.set(row, key);
  });
  return keys;
}

/** Column output for a cell. Objects that React cannot render become text. */
function renderCell<T>(col: Column<T>, row: T): ReactNode {
  const out: unknown = col.render(row);
  if (out === undefined) return "";
  if (out === null || typeof out !== "object" || isValidElement(out) || Array.isArray(out)) {
    return out as ReactNode;
  }
  return String(out);
}

/** Tracks the element's own content width. Measured before paint. */
function useElementWidth<E extends HTMLElement>(): [RefObject<E>, number] {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth(Math.round(next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function activateRow<T>(
  event: KeyboardEvent<HTMLElement>,
  row: T,
  onRowClick?: (row: T) => void,
) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    (event.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    (event.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
    return;
  }
  if (!onRowClick) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onRowClick(row);
  }
}

function cardRoles<T>(columns: Column<T>[]) {
  const title =
    columns.find((c) => c.card === "title") ??
    columns.find((c) => c.card !== false && c.card !== "metric") ??
    columns[0];
  const metric =
    columns.find((c) => c.card === "metric") ??
    columns.find((c) => c !== title && c.card !== false && c.align === "right");
  const fields = columns.filter(
    (c) => c !== title && c !== metric && c.card !== false,
  );
  return { title, metric, fields: fields.slice(0, 6) };
}

function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mul;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (Number(a) - Number(b)) * mul;
  }
  const aRank = typeof a === "string" ? PRIORITY_RANK[a] : undefined;
  const bRank = typeof b === "string" ? PRIORITY_RANK[b] : undefined;
  if (aRank !== undefined && bRank !== undefined) return (aRank - bRank) * mul;
  return (
    String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * mul
  );
}

function rowMatches<T>(
  row: T,
  query: string,
  columns: Column<T>[],
  getSearchText?: (row: T) => string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const extra = getSearchText ? getSearchText(row) : "";
  if (typeof extra === "string" && extra.toLowerCase().includes(q)) return true;
  return columns.some((col) => {
    const value = col.value?.(row);
    if (value == null) return false;
    return String(value).toLowerCase().includes(q);
  });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv<T>(rows: T[], columns: Column<T>[], serial = true): string {
  const cols = columns.filter((c) => c.value);
  const header = [serial ? "#" : null, ...cols.map((c) => csvEscape(c.header))]
    .filter((cell): cell is string => cell != null)
    .join(",");
  const body = rows
    .map((row, index) =>
      [
        serial ? String(index + 1) : null,
        ...cols.map((c) => csvEscape(c.value?.(row) == null ? "" : String(c.value?.(row)))),
      ]
        .filter((cell): cell is string => cell != null)
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}`;
}

function mergeColumnOrder(canonical: string[], saved: string[]): string[] {
  const known = new Set(canonical);
  const next = saved.filter((key) => known.has(key));
  for (const key of canonical) if (!next.includes(key)) next.push(key);
  return next;
}

function moveColumn(keys: string[], from: string, to: string): string[] {
  if (from === to) return keys;
  const next = keys.filter((key) => key !== from);
  const insertAt = next.indexOf(to);
  if (insertAt < 0) return keys;
  next.splice(insertAt, 0, from);
  return next;
}

function columnStorageKey(name: string) {
  return `chronos-table-cols:${name}`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function CheckControl({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={[
        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border outline-none",
        "transition-colors duration-[150ms] focus-visible:ring-2 focus-visible:ring-active",
        checked || indeterminate
          ? "border-transparent bg-action-primary text-on-color"
          : "border-default bg-action hover:border-active",
      ].join(" ")}
    >
      {checked || indeterminate ? <Check size={10} strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}

function PagerButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-muted bg-action px-3 py-1 text-label-sm text-secondary transition-colors duration-[180ms] hover:border-default hover:bg-raised-2 hover:text-primary disabled:opacity-40"
    >
      {children}
    </button>
  );
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  isRowSelected?: (row: T) => boolean;
  emptyTitle?: string;
  emptyDetail?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Extra haystack for search, on top of column `value`s. */
  getSearchText?: (row: T) => string;
  defaultSort?: SortState;
  /** Rows per page. Pass 0 to disable paging. */
  pageSize?: number;
  selectable?: boolean;
  selectedKeys?: ReadonlySet<string> | string[];
  onSelectedKeysChange?: (keys: Set<string>) => void;
  exportable?: boolean;
  exportName?: string;
  toolbar?: ReactNode;
  loading?: boolean;
  /** 1-based row numbers for the current filtered order. */
  serial?: boolean;
  /** Drag headers (or use Columns) to rearrange. Persists per exportName. */
  reorderable?: boolean;
  /** Applied to the table's outer wrapper. */
  className?: string;
}

function DataTableBody<T>({
  rows: rowsInput,
  columns: columnsInput,
  rowKey,
  onRowClick,
  isRowSelected,
  emptyTitle = "Nothing to show",
  emptyDetail,
  searchable = true,
  searchPlaceholder = "Search this queue",
  getSearchText,
  defaultSort,
  pageSize: pageSizeInput = 40,
  selectable = false,
  selectedKeys,
  onSelectedKeysChange,
  exportable = true,
  exportName: exportNameInput = "queue",
  toolbar,
  loading = false,
  serial = true,
  reorderable = true,
  className,
}: DataTableProps<T>) {
  const rows = useMemo(() => cleanRows<T>(rowsInput), [rowsInput]);
  const columns = useMemo(() => cleanColumns<T>(columnsInput), [columnsInput]);
  const pageSize = toPageSize(pageSizeInput);
  const exportName = toText(exportNameInput) || "queue";
  const keyOf = useMemo(() => buildRowKeys(rows, rowKey), [rows, rowKey]);
  const keyFor = (row: T) => keyOf.get(row) ?? "";
  const [rootRef, rootWidth] = useElementWidth<HTMLDivElement>();
  const wide = rootWidth >= TABLE_MIN_WIDTH;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState | undefined>(defaultSort);
  const [page, setPage] = useState(0);
  const [uncontrolledSelected, setUncontrolledSelected] = useState<Set<string>>(
    () => new Set(),
  );
  const [order, setOrder] = useState(() => columns.map((column) => column.key));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const canonicalSignature = columns.map((column) => column.key).join("\0");
  const canonicalKeys = useMemo(
    () => (canonicalSignature ? canonicalSignature.split("\0") : []),
    [canonicalSignature],
  );

  useEffect(() => {
    let saved: string[] = [];
    try {
      const raw = window.localStorage.getItem(columnStorageKey(exportName));
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed)) saved = parsed;
      }
    } catch {
      /* ignore bad cache */
    }
    setOrder((current) => {
      const next = mergeColumnOrder(canonicalKeys, saved.length ? saved : current);
      return next.length === current.length && next.every((key, index) => key === current[index])
        ? current
        : next;
    });
  }, [exportName, canonicalKeys]);

  useEffect(() => {
    if (!columnsOpen && !sortOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (columnsOpen && !columnsMenuRef.current?.contains(target)) setColumnsOpen(false);
      if (sortOpen && !sortMenuRef.current?.contains(target)) setSortOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [columnsOpen, sortOpen]);

  function persistOrder(next: string[]) {
    setOrder(next);
    try {
      window.localStorage.setItem(columnStorageKey(exportName), JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }

  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    return order
      .map((key) => byKey.get(key))
      .filter((column): column is Column<T> => Boolean(column));
  }, [columns, order]);

  // Columns hidden by width only apply to the table; the cards keep them.
  const tableColumns = useMemo(
    () =>
      orderedColumns.filter(
        (col) => !col.hide || !HIDE_BELOW[col.hide] || rootWidth >= HIDE_BELOW[col.hide],
      ),
    [orderedColumns, rootWidth],
  );

  const selected = useMemo(() => {
    if (selectedKeys) {
      return selectedKeys instanceof Set
        ? selectedKeys
        : new Set(asArray<string>(selectedKeys).map(String));
    }
    return uncontrolledSelected;
  }, [selectedKeys, uncontrolledSelected]);

  const setSelected = (next: Set<string>) => {
    if (onSelectedKeysChange) onSelectedKeysChange(next);
    else setUncontrolledSelected(next);
  };

  const filtered = useMemo(() => {
    const matched = query
      ? rows.filter((row) => rowMatches(row, query, columns, getSearchText))
      : rows;
    if (!sort) return matched;
    const col = columns.find((c) => c.key === sort.key && c.value);
    if (!col?.value) return matched;
    return [...matched].sort((a, b) => compareValues(col.value!(a), col.value!(b), sort.dir));
  }, [rows, query, columns, getSearchText, sort]);

  const pageCount = pageSize ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const visible = pageSize
    ? filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
    : filtered;

  const visibleKeys = visible.map(keyFor);
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const someVisibleSelected = visibleKeys.some((key) => selected.has(key));

  const cards = cardRoles(orderedColumns);
  const sortableColumns = orderedColumns.filter((column) => Boolean(column.value));
  const activeSortColumn = sortableColumns.find((column) => column.key === sort?.key);
  const showToolbar =
    searchable || exportable || toolbar || selectable || reorderable || sortableColumns.length > 0;
  const interactive = Boolean(onRowClick);
  const canReorder = reorderable && orderedColumns.length > 1;
  const orderChanged = order.some((key, index) => key !== canonicalKeys[index]);
  const serialLeft = selectable ? 40 : 0;
  const firstColLeft = serialLeft + (serial ? 48 : 0);
  const pageStart = pageSize ? currentPage * pageSize : 0;

  function toggleSort(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: "desc" };
      if (current.dir === "desc") return { key, dir: "asc" };
      return undefined;
    });
    setPage(0);
  }

  function toggleKey(key: string, next: boolean) {
    const copy = new Set(selected);
    if (next) copy.add(key);
    else copy.delete(key);
    setSelected(copy);
  }

  function toggleAllVisible(next: boolean) {
    const copy = new Set(selected);
    for (const key of visibleKeys) {
      if (next) copy.add(key);
      else copy.delete(key);
    }
    setSelected(copy);
  }

  function onHeaderDragStart(event: DragEvent<HTMLElement>, key: string) {
    setDragKey(key);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
  }

  function onHeaderDragOver(event: DragEvent<HTMLElement>, key: string) {
    if (!dragKey || dragKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overKey !== key) setOverKey(key);
  }

  function onHeaderDrop(event: DragEvent<HTMLElement>, key: string) {
    event.preventDefault();
    const from = dragKey ?? event.dataTransfer.getData("text/plain");
    if (from) persistOrder(moveColumn(order, from, key));
    setDragKey(null);
    setOverKey(null);
  }

  function shiftColumn(key: string, dir: -1 | 1) {
    const index = order.indexOf(key);
    const nextIndex = index + dir;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const next = [...order];
    const current = next[index];
    const swap = next[nextIndex];
    if (current === undefined || swap === undefined) return;
    next[index] = swap;
    next[nextIndex] = current;
    persistOrder(next);
  }

  // The root element is the same node in loading and loaded states, so the
  // width observer attached on mount keeps measuring the real container.
  if (loading) {
    return (
      <div ref={rootRef} className={cx("flex h-full min-h-[160px] min-w-0 flex-col justify-center gap-2 px-4", className)}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-raised" />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cx("relative isolate flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}
    >
      {showToolbar ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-muted px-3 py-2">
          {searchable ? (
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{searchPlaceholder}</span>
              <Search
                size={13}
                strokeWidth={1.75}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 icon-quaternary"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                className="h-8 w-full min-w-[12rem] rounded-full border border-muted bg-action pr-3 pl-8 text-label-sm text-secondary outline-none placeholder:text-quaternary focus-visible:border-default focus-visible:ring-2 focus-visible:ring-active"
              />
            </label>
          ) : (
            <span className="flex-1" />
          )}
          <span className="text-caption tabular text-quaternary">
            {filtered.length}
            {filtered.length === 1 ? " row" : " rows"}
            {selected.size ? ` · ${selected.size} selected` : ""}
          </span>
          {toolbar}
          {sortableColumns.length ? (
            <div className="relative" ref={sortMenuRef}>
              <button
                type="button"
                aria-expanded={sortOpen}
                onClick={() => {
                  setSortOpen((open) => !open);
                  setColumnsOpen(false);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-muted bg-action px-3 text-label-sm text-secondary outline-none transition-colors duration-[180ms] hover:border-default hover:bg-raised-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-active"
              >
                <ArrowUpDown size={13} strokeWidth={1.75} aria-hidden />
                {activeSortColumn ? activeSortColumn.header : "Sort"}
                {sort ? (
                  sort.dir === "asc" ? (
                    <ArrowUp size={12} strokeWidth={2} aria-hidden />
                  ) : (
                    <ArrowDown size={12} strokeWidth={2} aria-hidden />
                  )
                ) : (
                  <ChevronDown size={12} strokeWidth={2} aria-hidden />
                )}
              </button>
              {sortOpen ? (
                <div className="absolute top-[calc(100%+6px)] right-0 z-40 w-56 rounded-lg border border-muted bg-container p-2 shadow-lg">
                  <p className="px-1.5 pb-2 text-caption text-quaternary">
                    Click again to flip direction.
                  </p>
                  <ul className="flex max-h-64 flex-col gap-0.5 overflow-auto">
                    {sortableColumns.map((col) => {
                      const active = sort?.key === col.key;
                      return (
                        <li key={col.key}>
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={[
                              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-label-sm",
                              active
                                ? "bg-raised text-primary"
                                : "text-secondary hover:bg-raised hover:text-primary",
                            ].join(" ")}
                          >
                            <span className="min-w-0 truncate">{col.header}</span>
                            {active ? (
                              sort.dir === "asc" ? (
                                <ArrowUp size={12} strokeWidth={2} aria-hidden />
                              ) : (
                                <ArrowDown size={12} strokeWidth={2} aria-hidden />
                              )
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {sort ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSort(undefined);
                        setPage(0);
                      }}
                      className="mt-2 w-full rounded-full border border-muted px-2 py-1 text-label-sm text-tertiary hover:text-primary"
                    >
                      Clear sort
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {canReorder ? (
            <div className="relative" ref={columnsMenuRef}>
              <button
                type="button"
                aria-expanded={columnsOpen}
                onClick={() => {
                  setColumnsOpen((open) => !open);
                  setSortOpen(false);
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-muted bg-action px-3 text-label-sm text-secondary outline-none transition-colors duration-[180ms] hover:border-default hover:bg-raised-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-active"
              >
                <Columns3 size={13} strokeWidth={1.75} aria-hidden />
                Columns
                <ChevronDown size={12} strokeWidth={2} aria-hidden />
              </button>
              {columnsOpen ? (
                <div className="absolute top-[calc(100%+6px)] right-0 z-40 w-64 rounded-lg border border-muted bg-container p-2 shadow-lg">
                  <p className="px-1.5 pb-2 text-caption text-quaternary">
                    Drag headers, or move here. # stays first.
                  </p>
                  <ul className="flex max-h-64 flex-col gap-0.5 overflow-auto">
                    {orderedColumns.map((col, index) => (
                      <li
                        key={col.key}
                        className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-raised"
                      >
                        <span className="w-4 text-caption tabular text-quaternary">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-label-sm text-secondary">
                          {col.header}
                        </span>
                        <button
                          type="button"
                          aria-label={`Move ${col.header} left`}
                          disabled={index === 0}
                          onClick={() => shiftColumn(col.key, -1)}
                          className="inline-flex size-6 items-center justify-center rounded-full text-tertiary outline-none transition-colors duration-[150ms] hover:bg-raised-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-active disabled:opacity-30"
                        >
                          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${col.header} right`}
                          disabled={index === orderedColumns.length - 1}
                          onClick={() => shiftColumn(col.key, 1)}
                          className="inline-flex size-6 items-center justify-center rounded-full text-tertiary outline-none transition-colors duration-[150ms] hover:bg-raised-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-active disabled:opacity-30"
                        >
                          <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {orderChanged ? (
                    <button
                      type="button"
                      onClick={() => persistOrder(canonicalKeys)}
                      className="mt-2 w-full rounded-full border border-muted px-2 py-1 text-label-sm text-tertiary hover:text-primary"
                    >
                      Reset order
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {exportable ? (
            <button
              type="button"
              onClick={() => downloadCsv(exportName, toCsv(filtered, orderedColumns, serial))}
              disabled={!filtered.length}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-muted bg-action px-3 text-label-sm text-secondary outline-none transition-colors duration-[180ms] hover:border-default hover:bg-raised-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-active disabled:opacity-40"
            >
              <Download size={13} strokeWidth={1.75} aria-hidden />
              Export
            </button>
          ) : null}
        </div>
      ) : null}

      {!filtered.length ? (
        <EmptyState
          title={query ? "No rows match this search" : emptyTitle}
          detail={query ? "Clear the search to see the rest of the queue." : emptyDetail}
        />
      ) : !wide ? (
        <ul className="min-h-0 flex-1 overflow-auto">
          {visible.map((row, rowIndex) => {
            const key = keyFor(row);
            const focused = isRowSelected?.(row) ?? false;
            const checked = selected.has(key);
            const serialNo = pageStart + rowIndex + 1;
            return (
              <li key={key} className="border-b border-muted last:border-b-0">
                <div
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-selected={focused}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick ? (event) => activateRow(event, row, onRowClick) : undefined
                  }
                  className={[
                    "flex w-full flex-col gap-2 px-4 py-3 text-left outline-none",
                    "transition-colors duration-[150ms] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-active",
                    interactive ? "cursor-pointer" : "",
                    focused ? "bg-raised" : "hover:bg-raised",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {selectable ? (
                        <CheckControl
                          checked={checked}
                          label={`Select ${key}`}
                          onChange={(next) => toggleKey(key, next)}
                        />
                      ) : null}
                      {serial ? (
                        <span className="w-6 shrink-0 text-caption tabular text-quaternary">
                          {serialNo}
                        </span>
                      ) : null}
                      <div className="min-w-0 break-words text-body-sm text-primary">
                        {cards.title ? renderCell(cards.title, row) : null}
                      </div>
                    </div>
                    {cards.metric ? (
                      <div className="shrink-0 text-body-sm text-primary">
                        {renderCell(cards.metric, row)}
                      </div>
                    ) : null}
                  </div>
                  {cards.fields.length ? (
                    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-x-4 gap-y-1">
                      {cards.fields.map((col) => (
                        <div key={col.key} className="min-w-0">
                          <dt className="break-words text-caption uppercase tracking-[0.06em] text-quaternary">
                            {col.header}
                          </dt>
                          <dd className="mt-0.5 line-clamp-2 break-words text-body-sm text-secondary">
                            {renderCell(col, row)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          <table className="w-max min-w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-container">
              <tr className="border-b border-muted">
                {selectable ? (
                  <th scope="col" className="sticky left-0 z-[11] w-10 bg-container px-3 py-2">
                    <CheckControl
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected && !allVisibleSelected}
                      label="Select all rows on this page"
                      onChange={toggleAllVisible}
                    />
                  </th>
                ) : null}
                {serial ? (
                  <th
                    scope="col"
                    className="sticky z-[11] w-12 bg-container px-3 py-2 text-caption font-medium uppercase tracking-[0.08em] text-quaternary"
                    style={{ left: serialLeft }}
                  >
                    #
                  </th>
                ) : null}
                {tableColumns.map((col, index) => {
                  const sortable = Boolean(col.value);
                  const active = sort?.key === col.key;
                  const dropping = overKey === col.key && dragKey !== col.key;
                  const dragging = dragKey === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={
                        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                      }
                      onDragOver={canReorder ? (event) => onHeaderDragOver(event, col.key) : undefined}
                      onDrop={canReorder ? (event) => onHeaderDrop(event, col.key) : undefined}
                      onDragLeave={() => {
                        if (overKey === col.key) setOverKey(null);
                      }}
                      className={[
                        "px-3 py-2 text-caption font-medium uppercase tracking-[0.08em] text-quaternary whitespace-nowrap",
                        col.width ?? "",
                        col.align === "right" ? "text-right" : "text-left",
                        index === 0 ? "sticky z-[11] bg-container" : "",
                        dropping ? "shadow-[-2px_0_0_0_var(--stroke-active,currentColor)]" : "",
                        dragging ? "opacity-50" : "",
                      ].join(" ")}
                      style={index === 0 ? { left: firstColLeft } : undefined}
                    >
                      <div
                        className={[
                          "inline-flex items-center gap-1",
                          col.align === "right" ? "flex-row-reverse" : "",
                        ].join(" ")}
                      >
                        {canReorder ? (
                          <span
                            draggable
                            onDragStart={(event) => onHeaderDragStart(event, col.key)}
                            onDragEnd={() => {
                              setDragKey(null);
                              setOverKey(null);
                            }}
                            aria-label={`Drag to move ${col.header}`}
                            className="inline-flex cursor-grab text-quaternary hover:text-secondary active:cursor-grabbing"
                          >
                            <GripVertical size={12} strokeWidth={2} aria-hidden />
                          </span>
                        ) : null}
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={[
                              "inline-flex items-center gap-1 outline-none",
                              col.align === "right" ? "flex-row-reverse" : "",
                              "hover:text-secondary focus-visible:text-secondary",
                              active ? "text-secondary" : "",
                            ].join(" ")}
                          >
                            <span className="min-w-0 max-w-[14rem] truncate" title={col.header}>
                              {col.header}
                            </span>
                            {active ? (
                              sort.dir === "asc" ? (
                                <ArrowUp size={11} strokeWidth={2} aria-hidden />
                              ) : (
                                <ArrowDown size={11} strokeWidth={2} aria-hidden />
                              )
                            ) : (
                              <span className="w-[11px]" aria-hidden />
                            )}
                          </button>
                        ) : (
                          <span className="min-w-0 max-w-[14rem] truncate" title={col.header}>
                            {col.header}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, rowIndex) => {
                const key = keyFor(row);
                const focused = isRowSelected?.(row) ?? false;
                const checked = selected.has(key);
                const serialNo = pageStart + rowIndex + 1;
                const stickyBg = focused ? "bg-raised" : "bg-container group-hover:bg-raised";
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={(event) => activateRow(event, row, onRowClick)}
                    tabIndex={interactive ? 0 : undefined}
                    aria-selected={focused}
                    className={[
                      "group border-b border-muted transition-colors duration-[150ms] outline-none",
                      "focus-visible:bg-raised",
                      interactive ? "cursor-pointer" : "",
                      focused ? "bg-raised" : "hover:bg-raised",
                    ].join(" ")}
                  >
                    {selectable ? (
                      <td className={["sticky left-0 z-10 px-3 py-2", stickyBg].join(" ")}>
                        <CheckControl
                          checked={checked}
                          label={`Select ${key}`}
                          onChange={(next) => toggleKey(key, next)}
                        />
                      </td>
                    ) : null}
                    {serial ? (
                      <td
                        className={["sticky z-10 w-12 px-3 py-2 text-body-sm tabular text-quaternary", stickyBg].join(
                          " ",
                        )}
                        style={{ left: serialLeft }}
                      >
                        {serialNo}
                      </td>
                    ) : null}
                    {tableColumns.map((col, index) => (
                      <td
                        key={col.key}
                        className={[
                          "px-3 py-2 text-body-sm text-secondary align-middle whitespace-nowrap",
                          col.align === "right" ? "text-right" : "text-left",
                          col.align === "right"
                            ? ""
                            : "max-w-[18rem] overflow-hidden text-ellipsis",
                          index === 0 ? ["sticky z-10", stickyBg].join(" ") : "",
                        ].join(" ")}
                        style={index === 0 ? { left: firstColLeft } : undefined}
                      >
                        {renderCell(col, row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageSize && filtered.length > pageSize ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-muted px-3 py-2">
          <span className="text-caption text-quaternary">
            Showing {currentPage * pageSize + 1}–
            {Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <PagerButton
              disabled={currentPage === 0}
              onClick={() => setPage(Math.max(0, currentPage - 1))}
            >
              <ChevronLeft size={13} strokeWidth={1.75} aria-hidden />
              Previous
            </PagerButton>
            <span className="text-caption tabular text-quaternary">
              {currentPage + 1} / {pageCount}
            </span>
            <PagerButton
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
            >
              Next
              <ChevronRight size={13} strokeWidth={1.75} aria-hidden />
            </PagerButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Dense operational table. A broken cell or column is contained to this table
 * (SectionBoundary), so the rest of the page keeps rendering.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  return (
    <SectionBoundary label="Table">
      <DataTableBody<T> {...props} />
    </SectionBoundary>
  );
}

/** Filter chips for queue-style pages. */
export function FilterChips({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: string; label: string; count?: number }[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const items = asArray<unknown>(options)
    .filter(isRecord)
    .map((option, index) => ({
      id: toText(option.id) || `option-${index}`,
      label: toText(option.label) || toText(option.id),
      count: typeof option.count === "number" && Number.isFinite(option.count) ? option.count : undefined,
    }));
  return (
    <div className={cx("-mx-1 flex min-w-0 flex-wrap gap-1.5 px-1 pb-0.5", className)}>
      {items.map((option, index) => {
        const active = option.id === value;
        return (
          <button
            key={`${option.id}:${index}`}
            type="button"
            onClick={() => {
              if (typeof onChange === "function") onChange(option.id);
            }}
            aria-pressed={active}
            className={[
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-label-sm",
              "outline-none transition-colors duration-[150ms] focus-visible:ring-2 focus-visible:ring-active",
              active
                ? "border-transparent bg-action-primary text-on-color"
                : "border-muted bg-action text-tertiary hover:border-default hover:bg-raised-2 hover:text-secondary",
            ].join(" ")}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={active ? "tabular opacity-70" : "tabular text-quaternary"}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
