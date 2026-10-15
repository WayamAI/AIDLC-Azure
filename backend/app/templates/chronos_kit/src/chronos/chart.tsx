import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SectionBoundary } from "./boundary";
import { cx } from "./cx";
import { count, percent, usd, usdCompact } from "./format";
import { asArray, isRecord, pick, toNum, toText } from "./safe";

/** Chronos analytics series, in order. Values are CSS variables from tokens.css. */
const SERIES_COLORS = [
  "var(--analytics-series-1)",
  "var(--analytics-series-2)",
  "var(--analytics-series-3)",
  "var(--analytics-series-4)",
  "var(--analytics-series-5)",
  "var(--analytics-series-6)",
];

const AXIS_TICK = { fill: "var(--text-quaternary)", fontSize: 11 };

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export type ChartFormat = "number" | "currency" | "percent";
export type ChartType = "line" | "area" | "bar" | "pie" | "donut";

const CHART_KIND: Record<ChartType, ChartType> = {
  line: "line",
  area: "area",
  bar: "bar",
  pie: "pie",
  donut: "donut",
};

/** Axis and tooltip labels. `compact` shortens ticks; tooltips use full figures. */
function formatValue(value: number, format: ChartFormat | undefined, compact: boolean): string {
  if (format === "currency") return compact ? usdCompact(value) : usd(value);
  if (format === "percent") return percent(value, compact ? 0 : 1);
  return compact ? COMPACT.format(value) : count(value);
}

const tooltipStyle = {
  background: "var(--surface-container)",
  border: "1px solid var(--stroke-muted)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text-primary)",
  boxShadow: "none",
};

const tooltipLabelStyle = { color: "var(--text-tertiary)", marginBottom: 2 };
const tooltipItemStyle = { color: "var(--text-primary)", padding: 0 };
const legendStyle = { fontSize: 12, color: "var(--text-tertiary)" };

interface ChartSeries {
  key: string;
  name: string;
}

/**
 * Chronos-styled recharts wrapper.
 *
 * `data` rows are plain objects; rows that are not objects are skipped.
 * `x` is the category key (axis label or pie slice name); if missing, the
 * first string key of the first row is used, else the row number.
 * Each `series` entry is a numeric key; `name` is shown in the tooltip and
 * legend. If `series` is missing or empty, the numeric keys of the first row
 * are used. Unknown `type` values draw a bar chart. `format` drives tick and
 * tooltip formatting; for "percent" the values are fractions (0.42 = 42%).
 */
export function Chart(props: {
  type: ChartType;
  data: Record<string, unknown>[];
  x: string;
  series: { key: string; name?: string }[];
  height?: number;
  format?: ChartFormat;
  className?: string;
}) {
  const { className, ...chart } = props;
  return (
    <div className={cx("w-full min-w-0", className)}>
      <SectionBoundary label="Chart">
        <ChartView {...chart} />
      </SectionBoundary>
    </div>
  );
}

function ChartView({
  type,
  data,
  x,
  series,
  height = 240,
  format,
}: {
  type: ChartType;
  data: Record<string, unknown>[];
  x: string;
  series: { key: string; name?: string }[];
  height?: number;
  format?: ChartFormat;
}) {
  const kind = pick<ChartType>(CHART_KIND, type, "bar");
  const fmt: ChartFormat | undefined = format === "currency" || format === "percent" ? format : undefined;
  const px = toNum(height) > 0 ? toNum(height) : 240;
  const sourceRows = asArray<unknown>(data).filter(isRecord);
  const firstRow: Record<string, unknown> = sourceRows[0] ?? {};

  const xKey =
    typeof x === "string" && x
      ? x
      : Object.keys(firstRow).find((key) => typeof firstRow[key] === "string") ?? "__index";

  const declared: ChartSeries[] = asArray<unknown>(series)
    .filter(isRecord)
    .filter((s) => typeof s.key === "string" && s.key !== "" && s.key !== xKey)
    .map((s) => ({ key: s.key as string, name: toText(s.name) || (s.key as string) }));
  const seriesList: ChartSeries[] =
    declared.length > 0
      ? declared
      : Object.keys(firstRow)
          .filter((key) => key !== xKey && !Number.isNaN(toNum(firstRow[key])))
          .map((key) => ({ key, name: key }));

  const rows = sourceRows.map((row, index) => {
    const next: Record<string, unknown> = { ...row };
    if (xKey === "__index") {
      next[xKey] = String(index + 1);
    } else {
      const raw = row[xKey];
      next[xKey] = typeof raw === "string" || typeof raw === "number" ? raw : toText(raw);
    }
    for (const s of seriesList) {
      const n = toNum(row[s.key]);
      next[s.key] = Number.isNaN(n) ? 0 : n;
    }
    return next;
  });

  const colorAt = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

  if (!rows.length || !seriesList.length) {
    return <p className="p-4 text-body-sm text-quaternary">Nothing to chart for this data.</p>;
  }

  if (kind === "pie" || kind === "donut") {
    const primary = seriesList[0];
    const total = rows.reduce((sum, row) => sum + Number(row[primary.key]), 0);
    const outer = Math.max(80, Math.min(px - 40, 260)) / 2;
    return (
      <div className="w-full min-w-0" style={{ height: px }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey={primary.key}
              nameKey={xKey}
              innerRadius={kind === "donut" ? outer * 0.62 : 0}
              outerRadius={outer}
              paddingAngle={1.5}
              stroke="var(--surface-container)"
              strokeWidth={1}
              isAnimationActive={false}
            >
              {rows.map((_, index) => (
                <Cell key={index} fill={colorAt(index)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              formatter={(value: unknown) => {
                const v = Number(value ?? 0);
                const share = total ? Math.round((v / total) * 100) : 0;
                return [`${formatValue(v, fmt, false)} (${share}%)`, primary.name];
              }}
            />
            <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={legendStyle} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const tickFormatter = (v: number) => formatValue(v, fmt, true);
  const valueFormatter = (value: unknown, name: unknown) => [
    formatValue(Number(value ?? 0), fmt, false),
    String(name ?? ""),
  ];

  const chartBody =
    kind === "bar" ? (
      <BarChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="var(--stroke-muted)" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFormatter} width={56} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={{ fill: "var(--surface-raised)" }}
          formatter={valueFormatter}
        />
        {seriesList.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={colorAt(index)}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        ))}
        {seriesList.length > 1 ? <Legend iconType="circle" wrapperStyle={legendStyle} /> : null}
      </BarChart>
    ) : kind === "area" ? (
      <AreaChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="var(--stroke-muted)" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFormatter} width={56} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={valueFormatter}
        />
        {seriesList.map((s, index) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={colorAt(index)}
            fill={colorAt(index)}
            fillOpacity={0.18}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
        {seriesList.length > 1 ? <Legend iconType="circle" wrapperStyle={legendStyle} /> : null}
      </AreaChart>
    ) : (
      <LineChart data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid stroke="var(--stroke-muted)" vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={tickFormatter} width={56} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          formatter={valueFormatter}
        />
        {seriesList.map((s, index) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={colorAt(index)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        {seriesList.length > 1 ? <Legend iconType="circle" wrapperStyle={legendStyle} /> : null}
      </LineChart>
    );

  return (
    <div className="w-full min-w-0" style={{ height: px }}>
      <ResponsiveContainer width="100%" height="100%">
        {chartBody}
      </ResponsiveContainer>
    </div>
  );
}
