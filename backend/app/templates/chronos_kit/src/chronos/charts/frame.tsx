import { useId, type ReactElement, type ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { cx } from "../cx";
import { count, percent, usd, usdCompact } from "../format";
import { asArray, isRecord, toNum, toText } from "../safe";

/*
 * Shared plumbing for every chart in this folder: tone-to-colour mapping,
 * value formatting, the frame that owns height and state, and the legend,
 * tooltip and screen-reader table. Charts never read a theme token directly;
 * they go through the helpers here so colours stay on the kit's variables.
 */

export type ChartTone =
  | "series-1"
  | "series-2"
  | "series-3"
  | "series-4"
  | "series-5"
  | "series-6"
  | "series-7"
  | "series-8"
  | "series-9"
  | "series-10"
  | "positive"
  | "negative"
  | "warning"
  | "error"
  | "neutral";

export type ChartValueFormat = "number" | "currency" | "percent";

const TONES = new Set<string>([
  "series-1", "series-2", "series-3", "series-4", "series-5",
  "series-6", "series-7", "series-8", "series-9", "series-10",
  "positive", "negative", "warning", "error", "neutral",
]);

const FEEDBACK_COLOURS: Record<string, string> = {
  positive: "var(--feedback-success-icon)",
  negative: "var(--feedback-error-icon)",
  error: "var(--feedback-error-icon)",
  warning: "var(--feedback-warning-icon)",
  neutral: "var(--text-quaternary)",
};

const DEFAULT_HEIGHT = 240;

/** True for the tone names this folder accepts. */
export function isChartTone(value: unknown): value is ChartTone {
  return typeof value === "string" && TONES.has(value);
}

/** Tone to CSS colour. series-7 to series-10 wrap onto the six analytics slots. */
export function toneColor(tone: unknown): string {
  if (!isChartTone(tone)) return "var(--analytics-series-1)";
  const match = /^series-(\d+)$/.exec(tone);
  if (match) return `var(--analytics-series-${((Number(match[1]) - 1) % 6) + 1})`;
  return FEEDBACK_COLOURS[tone] ?? "var(--analytics-series-1)";
}

/** The tone a value takes when none is given: series in palette order. */
export function resolveTone(tone: unknown, index: number): ChartTone {
  if (isChartTone(tone)) return tone;
  const slot = Number.isFinite(index) && index >= 0 ? (index % 6) + 1 : 1;
  return `series-${slot}` as ChartTone;
}

export function resolveFormat(format: unknown): ChartValueFormat {
  return format === "currency" || format === "percent" ? format : "number";
}

/** Finite number or the fallback. Numeric strings are accepted. */
export function finiteOr(value: unknown, fallback: number): number {
  const n = toNum(value);
  return Number.isNaN(n) ? fallback : n;
}

export function clampNum(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Plot height in pixels. Anything that is not a positive number uses the default. */
export function resolveHeight(height: unknown, fallback: number = DEFAULT_HEIGHT): number {
  const n = toNum(height);
  return Number.isNaN(n) || n <= 0 ? fallback : Math.round(n);
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const EXACT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * Formats a chart value for one of three places. "axis" is short, "tooltip"
 * is the normal reading, "exact" keeps cents and decimals for the hidden table.
 * Percent expects a fraction: 0.42 becomes 42%.
 */
export function formatChartValue(
  value: unknown,
  format: unknown = "number",
  mode: "axis" | "tooltip" | "exact" = "tooltip",
): string {
  const n = toNum(value);
  if (Number.isNaN(n)) return "—";
  const kind = resolveFormat(format);
  if (kind === "currency") {
    if (mode === "axis") return usdCompact(n);
    return usd(n, { cents: mode === "exact" });
  }
  if (kind === "percent") {
    if (mode === "axis") return percent(n, 0);
    return percent(n, mode === "exact" ? 2 : 1);
  }
  if (mode === "axis") return COMPACT.format(n);
  return mode === "exact" ? EXACT.format(n) : count(n);
}

/** useId with characters that are unsafe inside url(#id) removed. */
export function useSafeId(prefix: string): string {
  const raw = useId();
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

// --- frame -----------------------------------------------------------------

export type ChartFrameProps = {
  /** Accessible name for the figure and the plot. */
  ariaLabel: string;
  height?: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** True when there is nothing to plot; shows emptyMessage instead. */
  empty?: boolean;
  emptyMessage?: string;
  /** Wraps children in recharts' ResponsiveContainer. Raw SVG charts leave this off. */
  responsive?: boolean;
  /** Absolutely positioned content over the plot, e.g. a donut centre label. */
  overlay?: ReactNode;
  /** Visually hidden data table, rendered outside the plot. */
  table?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * Owns the height, loading skeleton, empty, error and plot states, and the
 * figure's accessible name. Every chart renders through it so states look and
 * read the same everywhere.
 */
export function ChartFrame({
  ariaLabel,
  height,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyMessage = "No data to display",
  responsive = false,
  overlay,
  table,
  children,
  className,
}: ChartFrameProps) {
  const name = toText(ariaLabel) || "Chart";
  const failed = Boolean(error);
  const state = failed ? "error" : loading ? "loading" : empty ? "empty" : "ready";

  return (
    <figure
      aria-label={name}
      data-chart-state={state}
      className={cx("m-0 flex min-w-0 flex-col gap-2", className)}
    >
      <div style={{ height: resolveHeight(height) }} className="relative w-full min-w-0">
        {state === "error" ? (
          <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-body-md text-error">{typeof error === "string" && error ? error : "This chart could not be loaded."}</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-muted px-3 py-1 text-caption text-secondary hover:bg-raised"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : state === "loading" ? (
          <div role="status" aria-label={`Loading ${name}`} className="h-full w-full animate-pulse rounded-md bg-raised-2" />
        ) : state === "empty" ? (
          <div className="flex h-full w-full items-center justify-center px-4 text-center">
            <p className="text-body-md text-tertiary">{toText(emptyMessage) || "No data to display"}</p>
          </div>
        ) : (
          <>
            <div role="img" aria-label={name} className="h-full w-full">
              {responsive ? (
                <ResponsiveContainer width="100%" height="100%">
                  {children as ReactElement}
                </ResponsiveContainer>
              ) : (
                children
              )}
            </div>
            {overlay ? (
              <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                {overlay}
              </div>
            ) : null}
          </>
        )}
      </div>
      {state === "ready" ? table : null}
    </figure>
  );
}

// --- legend ----------------------------------------------------------------

export type LegendItem = { key: string; label: string; color: string };

export function Legend({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  const rows = asArray<unknown>(items).filter(isRecord);
  if (rows.length === 0) return null;
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {rows.map((row, index) => (
        <li key={`${toText(row.key)}-${index}`} className="flex items-center gap-1.5 text-caption text-secondary">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: toText(row.color) }} />
          {toText(row.label)}
        </li>
      ))}
    </ul>
  );
}

// --- tooltip ---------------------------------------------------------------

export type TooltipEntry = { key: string; label: string; color: string; value: string };

export function TooltipContent({
  title,
  entries,
  className,
}: {
  title?: string;
  entries: readonly TooltipEntry[];
  className?: string;
}) {
  const rows = asArray<unknown>(entries).filter(isRecord);
  if (rows.length === 0) return null;
  const heading = toText(title);
  return (
    <div className={cx("min-w-[8rem] rounded-lg border border-muted bg-container px-2.5 py-2 text-caption", className)}>
      {heading ? <p className="mb-1.5 text-tertiary">{heading}</p> : null}
      <ul className="flex flex-col gap-1">
        {rows.map((row, index) => (
          <li key={`${toText(row.key)}-${index}`} className="flex items-center justify-between gap-4 text-caption">
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: toText(row.color) }} />
              <span className="truncate text-secondary">{toText(row.label)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-primary">{toText(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- hidden table ----------------------------------------------------------

/**
 * Screen-reader-only table with the exact values behind a chart. Rows are
 * pre-formatted strings; the first cell of each row is the row header.
 */
export function HiddenDataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly unknown[])[];
}) {
  const head = asArray<unknown>(headers).map(toText);
  const body = asArray<unknown>(rows).map((row) => asArray<unknown>(row).map(toText));
  return (
    <div className="sr-only">
      <table>
        <caption>{toText(caption)}</caption>
        <thead>
          <tr>
            {head.map((heading, index) => (
              <th key={`${heading}-${index}`} scope="col">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">{cell}</th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
