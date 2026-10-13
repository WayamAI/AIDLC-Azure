import { EmptyState, type EmptyKind } from "@/components/EmptyState";
/**
 * Dense operational table.
 *
 * One typed component for every list of records in the app: a real <table>
 * inside a white container, with an optional caption/toolbar header, sortable
 * columns, a text filter, expandable detail rows, client-side pagination and
 * skeleton loading. It scrolls horizontally inside its own container instead
 * of breaking the page layout, and truncates cell text (with a `title`) unless
 * a column opts into wrapping.
 */
import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export interface DataTableSort {
  id: string;
  direction: SortDirection;
}

export type SortPrimitive = string | number | boolean | Date | null | undefined;

export interface DataTableColumn<T> {
  /** Stable id, unique within the table. */
  id: string;
  /** Column heading. Pass "" together with `label` for an icon/action column. */
  header: string;
  /** Accessible name for the column when `header` is empty. */
  label?: string;
  cell: (row: T) => ReactNode;
  /** Right-aligned columns also get tabular numerals. */
  align?: "left" | "right";
  /** Tailwind width class applied to the header and cells, e.g. "w-28". */
  width?: string;
  /** Providing this makes the column sortable. Empty values sort last. */
  sortValue?: (row: T) => SortPrimitive;
  /** Render the cell in the mono id/code style. */
  mono?: boolean;
  /** Hide the column below this breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl" | "2xl";
  /**
   * The column that absorbs spare width (usually the name or title). It truncates to whatever room
   * is left instead of forcing the table to scroll sideways. Other columns truncate at a fixed cap.
   */
  grow?: boolean;
  /** Let the cell wrap instead of truncating on one line. */
  wrap?: boolean;
  /** Tooltip for a truncated cell. Defaults to the cell itself when it is plain text. */
  title?: (row: T) => string | undefined;
  /** Extra classes for the body cell. */
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Highlights the row the page currently has open. */
  isRowSelected?: (row: T) => boolean;
  /** Detail content shown under a row when it is expanded. */
  renderExpanded?: (row: T) => ReactNode;
  /** Limit which rows can expand. Defaults to all rows when `renderExpanded` is set. */
  canExpand?: (row: T) => boolean;
  /** Rows that start expanded (the user's own toggle always wins afterwards). */
  defaultExpanded?: (row: T) => boolean;
  /**
   * Controlled expansion: the keys of the open rows. Use with `onExpandedChange` when the page needs
   * to open a row itself (for example from a button in the row). Omit to let the table keep the state.
   */
  expandedKeys?: ReadonlySet<string>;
  onExpandedChange?: (key: string, open: boolean) => void;
  /** Shown when there are no rows. */
  empty?: ReactNode;
  /** Which empty-state mark to show with `empty`. */
  emptyKind?: EmptyKind;
  /** Skeleton rows instead of a spinner. */
  loading?: boolean;
  loadingRows?: number;
  /** Container title, rendered as the 11px caption. */
  caption?: ReactNode;
  /** Right side of the container header: pill filters, buttons. */
  toolbar?: ReactNode;
  /** Text a row is matched against. Providing it adds a filter input to the header. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  defaultSort?: DataTableSort;
  /** Enables client-side pagination. */
  pageSize?: number;
  /** Keeps the header visible while the body scrolls inside `maxHeightClassName`. */
  stickyHeader?: boolean;
  maxHeightClassName?: string;
  /** Bottom strip under the rows: a note, or a pager for server-paged data. */
  footer?: ReactNode;
  /** Drop the outer border and background when the table sits inside another container. */
  bare?: boolean;
  className?: string;
}

const HIDE_BELOW: Record<NonNullable<DataTableColumn<unknown>["hideBelow"]>, string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

const CAPTION = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const INTERACTIVE = "a,button,input,select,textarea,label,summary,[role='button'],[role='checkbox'],[role='switch']";

function normalise(value: SortPrimitive): string | number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  return value;
}

function compareSortValues(a: SortPrimitive, b: SortPrimitive, direction: SortDirection): number {
  const left = normalise(a);
  const right = normalise(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const sign = direction === "asc" ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * sign;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * sign;
}

function fromInteractiveChild(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  const hit = target?.closest?.(INTERACTIVE);
  return !!hit && hit !== event.currentTarget;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isRowSelected,
  renderExpanded,
  canExpand,
  defaultExpanded,
  expandedKeys,
  onExpandedChange,
  empty = "Nothing to show.",
  emptyKind = "noResults",
  loading = false,
  loadingRows = 5,
  caption,
  toolbar,
  searchText,
  searchPlaceholder = "Filter",
  defaultSort,
  pageSize,
  stickyHeader = false,
  maxHeightClassName = "max-h-[70vh]",
  footer,
  bare = false,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<DataTableSort | undefined>(defaultSort);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const expandable = !!renderExpanded;

  const processed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle && searchText ? rows.filter((row) => searchText(row).toLowerCase().includes(needle)) : rows;
    const column = sort ? columns.find((c) => c.id === sort.id) : undefined;
    const sortValue = column?.sortValue;
    if (!sort || !sortValue) return matched;
    // Decorate so equal values keep the order the page supplied.
    return matched
      .map((row, index) => ({ row, index }))
      .sort((a, b) => compareSortValues(sortValue(a.row), sortValue(b.row), sort.direction) || a.index - b.index)
      .map((entry) => entry.row);
  }, [rows, columns, query, searchText, sort]);

  const total = processed.length;
  const pageCount = pageSize ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  const start = pageSize ? currentPage * pageSize : 0;
  const visible = pageSize ? processed.slice(start, start + pageSize) : processed;
  const columnCount = columns.length + (expandable ? 1 : 0);

  // Text columns start A→Z; numbers and dates start with the largest/newest.
  const firstDirection = (id: string): SortDirection => {
    const sortValue = columns.find((c) => c.id === id)?.sortValue;
    const sample = sortValue ? rows.map(sortValue).find((v) => v != null && v !== "") : undefined;
    return typeof sample === "string" ? "asc" : "desc";
  };

  const toggleSort = (id: string) => {
    setSort((current) => {
      const first = firstDirection(id);
      if (current?.id !== id) return { id, direction: first };
      if (current.direction === first) return { id, direction: first === "asc" ? "desc" : "asc" };
      return undefined;
    });
    setPage(0);
  };

  const isOpen = (row: T, key: string) =>
    expandedKeys ? expandedKeys.has(key) : (toggled[key] ?? defaultExpanded?.(row) ?? false);

  const hasHeader = caption != null || toolbar != null || !!searchText;
  const filtering = !!searchText && query.trim() !== "";

  return (
    <div
      className={cn("min-w-0", !bare && "overflow-hidden rounded-lg border border-stroke-muted bg-container", className)}
      aria-busy={loading || undefined}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stroke-muted px-4 py-3">
          {caption != null && <h2 className={cn(CAPTION, "mr-1")}>{caption}</h2>}
          {toolbar != null && <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>}
          {searchText && (
            <div className="ml-auto flex items-center gap-2">
              {filtering && (
                <span className="text-xs tabular-nums text-ink-quaternary">
                  {total} of {rows.length}
                </span>
              )}
              <label className="relative block">
                <span className="sr-only">{searchPlaceholder}</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-quaternary" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                  placeholder={searchPlaceholder}
                  className={cn(
                    "h-8 w-44 rounded-full border border-border bg-container pl-8 pr-3 text-xs text-ink placeholder:text-ink-quaternary sm:w-56",
                    FOCUS,
                  )}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {!loading && total === 0 ? (
        <EmptyState compact kind={filtering ? "noResults" : emptyKind}>
          {filtering ? "No rows match this filter." : empty}
        </EmptyState>
      ) : (
        <div className={cn("relative overflow-x-auto", stickyHeader && cn("overflow-y-auto", maxHeightClassName))}>
          <table className="w-full border-collapse text-left text-sm">
            <thead className={cn(stickyHeader && "sticky top-0 z-10")}>
              <tr className="border-b border-stroke-muted bg-raised">
                {expandable && (
                  <th scope="col" className="w-9 py-2 pl-4 pr-0">
                    <span className="sr-only">Details</span>
                  </th>
                )}
                {columns.map((column) => {
                  const sortable = !!column.sortValue;
                  const active = sort?.id === column.id;
                  const SortIcon = !active ? ChevronsUpDown : sort.direction === "asc" ? ChevronUp : ChevronDown;
                  const name = column.header || column.label || column.id;
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={sortable ? (active ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                      className={cn(
                        CAPTION,
                        "whitespace-nowrap px-4 py-2",
                        column.align === "right" ? "text-right" : "text-left",
                        column.width,
                        column.hideBelow && HIDE_BELOW[column.hideBelow],
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.id)}
                          title={`Sort by ${name}`}
                          className={cn(
                            "-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-[0.08em] transition-colors hover:text-ink-secondary",
                            column.align === "right" && "flex-row-reverse",
                            active && "text-ink-secondary",
                            FOCUS,
                          )}
                        >
                          {name}
                          <SortIcon className={cn("h-3 w-3 shrink-0", !active && "opacity-50")} aria-hidden />
                        </button>
                      ) : column.header ? (
                        column.header
                      ) : (
                        <span className="sr-only">{name}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: loadingRows }, (_, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border/60 last:border-b-0" data-testid="datatable-skeleton-row">
                      {expandable && <td className="py-3 pl-4 pr-0" />}
                      {columns.map((column, columnIndex) => (
                        <td key={column.id} className={cn("px-4 py-3", column.hideBelow && HIDE_BELOW[column.hideBelow])}>
                          <div
                            className={cn(
                              "h-3 animate-pulse rounded bg-raised-2",
                              column.align === "right" ? "ml-auto w-10" : columnIndex === 0 ? "w-2/3" : "w-1/2",
                            )}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                : visible.map((row) => {
                    const key = rowKey(row);
                    const rowExpandable = expandable && (canExpand ? canExpand(row) : true);
                    const open = rowExpandable && isOpen(row, key);
                    const selected = isRowSelected?.(row) ?? false;
                    const toggle = () => {
                      if (!expandedKeys) setToggled((current) => ({ ...current, [key]: !open }));
                      onExpandedChange?.(key, !open);
                    };
                    // A row with no click handler of its own toggles its detail when clicked.
                    const activate = onRowClick ? () => onRowClick(row) : rowExpandable ? toggle : undefined;
                    const Chevron = open ? ChevronDown : ChevronRight;
                    return [
                      <tr
                        key={key}
                        onClick={activate ? (event) => !fromInteractiveChild(event) && activate() : undefined}
                        onKeyDown={
                          onRowClick
                            ? (event) => {
                                if ((event.key === "Enter" || event.key === " ") && !fromInteractiveChild(event)) {
                                  event.preventDefault();
                                  onRowClick(row);
                                }
                              }
                            : undefined
                        }
                        tabIndex={onRowClick ? 0 : undefined}
                        aria-selected={isRowSelected ? selected : undefined}
                        className={cn(
                          "border-b border-border/60 transition-colors last:border-b-0",
                          activate && "cursor-pointer hover:bg-raised",
                          selected && "bg-raised",
                          open && "border-b-0",
                          onRowClick && "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                        )}
                      >
                        {expandable && (
                          <td className="w-9 py-2.5 pl-4 pr-0 align-middle">
                            {rowExpandable && (
                              <button
                                type="button"
                                onClick={toggle}
                                aria-expanded={open}
                                aria-label={open ? "Hide details" : "Show details"}
                                className={cn("flex h-5 w-5 items-center justify-center rounded text-ink-quaternary hover:text-ink", FOCUS)}
                              >
                                <Chevron className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            )}
                          </td>
                        )}
                        {columns.map((column) => {
                          const content = column.cell(row);
                          const plain = typeof content === "string" || typeof content === "number" ? String(content) : undefined;
                          return (
                            <td
                              key={column.id}
                              title={column.wrap ? undefined : (column.title?.(row) ?? plain)}
                              className={cn(
                                "px-4 py-2.5 align-middle text-ink-secondary",
                                column.align === "right" ? "text-right tabular-nums" : "text-left",
                                column.wrap
                                  ? "min-w-[12rem] whitespace-normal break-words"
                                  : column.grow
                                    ? "w-full min-w-[10rem] max-w-0 truncate"
                                    : "max-w-[26rem] truncate",
                                column.mono && "font-mono text-xs",
                                column.width,
                                column.hideBelow && HIDE_BELOW[column.hideBelow],
                                column.className,
                              )}
                            >
                              {content}
                            </td>
                          );
                        })}
                      </tr>,
                      open ? (
                        <tr key={`${key}:detail`} className="border-b border-border/60 last:border-b-0">
                          <td colSpan={columnCount} className="px-4 pb-4 pl-[3.25rem] pt-0.5">
                            {renderExpanded!(row)}
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
            </tbody>
          </table>
        </div>
      )}

      {pageSize != null && !loading && total > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stroke-muted px-4 py-2.5">
          <span className="text-xs tabular-nums text-ink-tertiary">
            Showing {start + 1}–{Math.min(start + pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-1.5">
            <PagerButton label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Prev
            </PagerButton>
            <PagerButton label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </PagerButton>
          </div>
        </div>
      )}

      {footer != null && <div className="border-t border-stroke-muted px-4 py-2.5 text-xs text-ink-tertiary">{footer}</div>}
    </div>
  );
}

function PagerButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-raised disabled:pointer-events-none disabled:opacity-40",
        FOCUS,
      )}
    >
      {children}
    </button>
  );
}

/** Pill filter group for a table toolbar. */
export function FilterPills<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string; count?: number }[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active ? "border-transparent bg-primary text-primary-foreground" : "border-border text-ink-secondary hover:bg-raised",
              FOCUS,
            )}
          >
            {option.label}
            {option.count !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
