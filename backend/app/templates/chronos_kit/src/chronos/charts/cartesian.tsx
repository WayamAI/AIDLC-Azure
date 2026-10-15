import { useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cx } from "../cx";
import { asArray, isRecord, toNum, toText } from "../safe";
import {
  ChartFrame,
  HiddenDataTable,
  Legend,
  TooltipContent,
  clampNum,
  formatChartValue,
  isChartTone,
  resolveFormat,
  resolveHeight,
  resolveTone,
  toneColor,
  useSafeId,
  type ChartTone,
  type ChartValueFormat,
  type TooltipEntry,
} from "./frame";

export type CartesianMark = "line" | "area" | "bar";

export type CartesianSeries = {
  /** Key into each row. */
  key: string;
  name?: string;
  tone?: ChartTone;
  /** Overrides the chart's default mark for this series. */
  mark?: CartesianMark;
};

export type ReferenceLineSpec = {
  /** Value line, e.g. an SLA target. */
  y?: number;
  /** Category line, at one x value. */
  x?: string | number;
  label?: string;
  tone?: ChartTone;
};

export type CartesianChartProps<T extends object> = {
  data: readonly T[];
  x: keyof T & string;
  series: readonly CartesianSeries[];
  height?: number;
  format?: ChartValueFormat;
  referenceLines?: readonly ReferenceLineSpec[];
  showLegend?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  ariaLabel?: string;
  className?: string;
  /** Mark for series without their own. "combo" makes the first series a bar and the rest lines. */
  defaultMark?: CartesianMark | "combo";
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
};

type Row = Record<string, unknown>;
type PayloadItem = { dataKey?: unknown; value?: unknown };
type TooltipProps = { active?: boolean; label?: unknown; payload?: readonly PayloadItem[] };

const AXIS = { tick: { fill: "var(--text-tertiary)", fontSize: 11 }, tickLine: false, axisLine: { stroke: "var(--stroke-default)" } } as const;
const LINE_PROPS = { dot: false, activeDot: { r: 3, strokeWidth: 0 }, connectNulls: false } as const;
const AXIS_CHAR_WIDTH = 6.4;
const MARKS: readonly string[] = ["line", "area", "bar"];

/** Pixel width for an axis that fits its longest label, within sane bounds. */
function measureWidth(labels: readonly string[], min: number, max: number): number {
  const longest = labels.reduce((most, label) => Math.max(most, label.length), 0);
  return clampNum(Math.ceil(longest * AXIS_CHAR_WIDTH) + 10, min, max);
}

function markFor(index: number, declared: unknown, defaultMark: CartesianMark | "combo"): CartesianMark {
  if (typeof declared === "string" && MARKS.includes(declared)) return declared as CartesianMark;
  if (defaultMark === "combo") return index === 0 ? "bar" : "line";
  return defaultMark === "area" || defaultMark === "bar" ? defaultMark : "line";
}

/**
 * The shared cartesian chart. LineChart, AreaChart, BarChart and ComboChart are
 * thin wrappers that set the default mark. Non-numeric values become gaps, and
 * the caller's rows are never mutated.
 */
export function CartesianChart<T extends object>({
  data,
  x,
  series,
  height,
  format,
  referenceLines,
  showLegend = false,
  loading = false,
  error = null,
  onRetry,
  emptyMessage,
  ariaLabel,
  className,
  defaultMark = "line",
  orientation = "vertical",
  stacked = false,
}: CartesianChartProps<T>) {
  const uid = useSafeId("cc");
  const kind = resolveFormat(format);
  const horizontal = orientation === "horizontal";

  const rows = useMemo(
    () => asArray<unknown>(data).filter(isRecord) as Row[],
    [data],
  );

  const xKey = useMemo(() => {
    if (typeof x === "string" && x !== "") return x;
    return rows[0] ? (Object.keys(rows[0])[0] ?? "") : "";
  }, [x, rows]);

  const seriesList = useMemo(() => {
    let source = asArray<unknown>(series).filter(
      (entry): entry is CartesianSeries => isRecord(entry) && typeof entry.key === "string" && entry.key !== "",
    );
    if (source.length === 0 && rows[0]) {
      source = Object.keys(rows[0])
        .filter((key) => key !== xKey && typeof rows[0]![key] === "number")
        .map((key) => ({ key }));
    }
    return source.map((entry, index) => ({
      key: entry.key,
      name: toText(entry.name) || entry.key,
      color: toneColor(resolveTone(entry.tone, index)),
      mark: markFor(index, entry.mark, defaultMark),
    }));
  }, [series, rows, xKey, defaultMark]);

  // Non-numeric values become null, which recharts draws as a gap.
  const plotData = useMemo(
    () =>
      rows.map((row) => {
        const out: Row = { [xKey]: row[xKey] };
        for (const entry of seriesList) {
          const value = toNum(row[entry.key]);
          out[entry.key] = Number.isNaN(value) ? null : value;
        }
        return out;
      }),
    [rows, xKey, seriesList],
  );

  const plottable = plotData.some((row) =>
    seriesList.some((entry) => typeof row[entry.key] === "number"),
  );
  const empty = rows.length === 0 || seriesList.length === 0 || !plottable;
  const ready = !loading && !error && !empty;
  const hasBar = seriesList.some((entry) => entry.mark === "bar");

  const valueWidth = useMemo(() => {
    const labels: string[] = [];
    for (const row of plotData) {
      for (const entry of seriesList) {
        const value = row[entry.key];
        if (typeof value === "number") labels.push(formatChartValue(value, kind, "axis"));
      }
    }
    return measureWidth(labels, 40, 96);
  }, [plotData, seriesList, kind]);

  const categoryWidth = useMemo(
    () => measureWidth(rows.map((row) => toText(row[xKey])), 40, 140),
    [rows, xKey],
  );

  const legendItems = seriesList.map((entry) => ({ key: entry.key, label: entry.name, color: entry.color }));
  const label = toText(ariaLabel) || "Chart";

  const renderTooltip = (props: TooltipProps) => {
    const payload = asArray<PayloadItem>(props.payload);
    const entries: TooltipEntry[] = [];
    for (const item of payload) {
      const entry = seriesList.find((candidate) => candidate.key === item.dataKey);
      if (entry && typeof item.value === "number") {
        entries.push({
          key: entry.key,
          label: entry.name,
          color: entry.color,
          value: formatChartValue(item.value, kind, "tooltip"),
        });
      }
    }
    return <TooltipContent title={toText(props.label)} entries={entries} />;
  };

  const table = ready ? (
    <HiddenDataTable
      caption={`Data table for ${label}`}
      headers={[xKey || "Category", ...seriesList.map((entry) => entry.name)]}
      rows={plotData.map((row) => [
        toText(row[xKey]),
        ...seriesList.map((entry) => formatChartValue(row[entry.key], kind, "exact")),
      ])}
    />
  ) : null;

  // Value lines run across the value axis (y, or x when bars are horizontal); category lines the reverse.
  const refs = asArray<ReferenceLineSpec>(referenceLines)
    .filter(isRecord)
    .map((ref, index) => {
      const value = toNum(ref.y);
      const category = typeof ref.x === "string" ? ref.x : Number.isFinite(ref.x) ? ref.x : undefined;
      const onValue = !Number.isNaN(value);
      if (!onValue && category === undefined) return null;
      const position = (onValue ? value : category) as string | number;
      const onX = onValue ? horizontal : !horizontal;
      const text = toText(ref.label);
      return (
        <ReferenceLine
          key={`ref-${index}`}
          {...(onX ? { x: position } : { y: position })}
          stroke={toneColor(isChartTone(ref.tone) ? ref.tone : "warning")}
          strokeDasharray="4 4"
          label={text ? { value: text, position: "insideTopRight", fill: "var(--text-tertiary)", fontSize: 11 } : undefined}
        />
      );
    });

  const chart = (
    <ComposedChart
      data={plotData}
      layout={horizontal ? "vertical" : "horizontal"}
      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      barGap={4}
    >
      <defs>
        {seriesList.map((entry, index) =>
          entry.mark === "area" ? (
            <linearGradient key={entry.key} id={`${uid}-g${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: entry.color }} stopOpacity={0.24} />
              <stop offset="100%" style={{ stopColor: entry.color }} stopOpacity={0} />
            </linearGradient>
          ) : null,
        )}
      </defs>
      <CartesianGrid stroke="var(--stroke-muted)" strokeDasharray="2 4" vertical={horizontal} horizontal={!horizontal} />
      {horizontal ? <XAxis type="number" {...AXIS} tickFormatter={(v: number) => formatChartValue(v, kind, "axis")} /> : null}
      {horizontal ? <YAxis type="category" dataKey={xKey} {...AXIS} axisLine={false} width={categoryWidth} tickFormatter={(v: unknown) => toText(v)} /> : null}
      {horizontal ? null : <XAxis dataKey={xKey} {...AXIS} minTickGap={16} tickFormatter={(v: unknown) => toText(v)} />}
      {horizontal ? null : <YAxis {...AXIS} axisLine={false} width={valueWidth} tickFormatter={(v: number) => formatChartValue(v, kind, "axis")} />}
      <Tooltip
        cursor={hasBar ? { fill: "var(--surface-raised)" } : { stroke: "var(--stroke-default)", strokeWidth: 1 }}
        isAnimationActive={false}
        content={(props: unknown) => renderTooltip(props as TooltipProps)}
      />
      {refs}
      {seriesList.map((entry, index) => {
        const common = { key: entry.key, dataKey: entry.key, name: entry.name, animationDuration: 500 };
        const stackId = stacked ? "stack" : undefined;
        if (entry.mark === "bar") {
          return (
            <Bar
              {...common}
              fill={entry.color}
              stackId={stackId}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={28}
            />
          );
        }
        if (entry.mark === "area") {
          return (
            <Area
              {...common}
              {...LINE_PROPS}
              type="monotone"
              stroke={entry.color}
              strokeWidth={1.5}
              fill={`url(#${uid}-g${index})`}
              stackId={stackId}
            />
          );
        }
        return <Line {...common} {...LINE_PROPS} type="monotone" stroke={entry.color} strokeWidth={1.5} />;
      })}
    </ComposedChart>
  );

  return (
    <div className={cx("flex min-w-0 flex-col gap-3", className)}>
      <ChartFrame
        ariaLabel={label}
        height={resolveHeight(height)}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={empty}
        emptyMessage={emptyMessage}
        responsive
        table={table}
      >
        {chart}
      </ChartFrame>
      {showLegend && ready ? <Legend items={legendItems} /> : null}
    </div>
  );
}

// --- wrappers --------------------------------------------------------------

export type LineChartProps<T extends object> = Omit<CartesianChartProps<T>, "defaultMark">;
export type AreaChartProps<T extends object> = Omit<CartesianChartProps<T>, "defaultMark">;
export type BarChartProps<T extends object> = Omit<CartesianChartProps<T>, "defaultMark">;
export type ComboChartProps<T extends object> = Omit<CartesianChartProps<T>, "defaultMark">;

/** Trends over an ordered axis. */
export function LineChart<T extends object>(props: LineChartProps<T>) {
  return <CartesianChart {...props} defaultMark="line" />;
}

/** Volume over time. Stack only when the total is itself meaningful. */
export function AreaChart<T extends object>(props: AreaChartProps<T>) {
  return <CartesianChart {...props} defaultMark="area" />;
}

/** Magnitude across categories. Horizontal suits long labels. */
export function BarChart<T extends object>(props: BarChartProps<T>) {
  return <CartesianChart {...props} defaultMark="bar" />;
}

/** Bars and lines on shared axes. The first series is a bar unless its own mark says otherwise. */
export function ComboChart<T extends object>(props: ComboChartProps<T>) {
  return <CartesianChart {...props} defaultMark="combo" />;
}
