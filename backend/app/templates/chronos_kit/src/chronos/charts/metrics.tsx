import { useMemo } from "react";
import { cx } from "../cx";
import { asArray, isRecord, toNum, toText } from "../safe";
import {
  clampNum,
  finiteOr,
  formatChartValue,
  isChartTone,
  resolveFormat,
  resolveTone,
  toneColor,
  useSafeId,
  type ChartTone,
  type ChartValueFormat,
} from "./frame";

/* Small metric visuals. Raw SVG throughout: at these sizes the chart library adds nothing. */

// --- sparkline -------------------------------------------------------------

export type SparklineProps = {
  /** Ordered values. Null or non-numeric entries are gaps. */
  data: readonly (number | null)[];
  tone?: ChartTone;
  height?: number;
  showArea?: boolean;
  showLastPoint?: boolean;
  ariaLabel?: string;
  /** Use beside a labelled metric so the value is not announced twice. */
  decorative?: boolean;
  className?: string;
};

type Geometry = { line: string; area: string; last: { x: number; y: number } };

const VIEW_W = 100;
const VIEW_H = 32;

function sparkGeometry(values: readonly unknown[]): Geometry | null {
  const points = values.map((value) => {
    const n = toNum(value);
    return Number.isNaN(n) ? null : n;
  });
  const present = points.filter((value): value is number => value !== null);
  if (present.length < 2) return null;

  const min = Math.min(...present);
  const span = Math.max(...present) - min || 1;
  const stepX = VIEW_W / (points.length - 1);
  const yFor = (value: number) => 2 + (1 - (value - min) / span) * (VIEW_H - 4);

  const coords: { x: number; y: number }[] = [];
  let line = "";
  let started = false;
  points.forEach((value, index) => {
    if (value === null) {
      started = false; // a gap lifts the pen
      return;
    }
    const point = { x: index * stepX, y: yFor(value) };
    coords.push(point);
    line += `${started ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
    started = true;
  });

  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  const area =
    `M${first.x.toFixed(2)},${VIEW_H} ` +
    coords.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ") +
    ` L${last.x.toFixed(2)},${VIEW_H} Z`;
  return { line: line.trim(), area, last };
}

/** Inline trend line. Scales to any width; the viewBox is fixed. */
export function Sparkline({
  data,
  tone,
  height,
  showArea = false,
  showLastPoint = true,
  ariaLabel,
  decorative = false,
  className,
}: SparklineProps) {
  const gradientId = useSafeId("spark");
  const color = toneColor(resolveTone(tone, 0));
  const pixelHeight = clampNum(finiteOr(height, 32), 8, 200);
  const geometry = useMemo(() => sparkGeometry(asArray<unknown>(data)), [data]);

  if (!geometry) {
    return <div aria-hidden style={{ height: pixelHeight }} className={cx("w-full rounded-sm bg-raised-2", className)} />;
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      style={{ height: pixelHeight }}
      className={cx("w-full overflow-visible", className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : toText(ariaLabel) || "Trend"}
    >
      {showArea ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: color }} stopOpacity={0.22} />
              <stop offset="100%" style={{ stopColor: color }} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={geometry.area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path
        d={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showLastPoint ? <circle cx={geometry.last.x} cy={geometry.last.y} r={1.8} fill={color} /> : null}
    </svg>
  );
}

// --- gauge -----------------------------------------------------------------

export type GaugeThreshold = { value: number; tone: ChartTone };

export type GaugeProps = {
  value: number;
  min?: number;
  max?: number;
  /** Base tone, used below the first threshold. */
  tone?: ChartTone;
  /** Recolours the arc at or above each value; the highest match wins. */
  thresholds?: readonly GaugeThreshold[];
  size?: "sm" | "md" | "lg";
  label?: string;
  format?: ChartValueFormat;
  unit?: string;
  ariaLabel?: string;
  className?: string;
};

const GAUGE_SIZES = {
  sm: { box: 96, stroke: 8, figure: "text-heading-md" },
  md: { box: 132, stroke: 10, figure: "text-display-metric" },
  lg: { box: 168, stroke: 12, figure: "text-display-metric" },
} as const;

/** Sweep of the dial in degrees. The 120 degree gap at the base keeps the reading clear. */
const SWEEP = 240;

function arcPath(cx: number, cy: number, radius: number, startDeg: number, endDeg: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const start = point(endDeg);
  const end = point(startDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

/** Radial dial for a bounded metric. NaN shows the minimum. */
export function Gauge({
  value,
  min,
  max,
  tone,
  thresholds,
  size,
  label,
  format,
  unit,
  ariaLabel,
  className,
}: GaugeProps) {
  const { box, stroke, figure } = GAUGE_SIZES[size === "sm" || size === "lg" ? size : "md"];
  const radius = (box - stroke) / 2 - 2;
  const center = box / 2;

  const lo = finiteOr(min, 0);
  const hi = finiteOr(max, 100) > lo ? finiteOr(max, 100) : lo + 100;
  const bounded = clampNum(finiteOr(value, lo), lo, hi);
  const ratio = (bounded - lo) / (hi - lo);

  const activeTone = useMemo<ChartTone>(() => {
    let resolved: ChartTone = isChartTone(tone) ? tone : "series-1";
    const ordered = asArray<unknown>(thresholds)
      .filter(isRecord)
      .map((t) => ({ value: toNum(t.value), tone: t.tone }))
      .filter((t): t is { value: number; tone: ChartTone } => !Number.isNaN(t.value) && isChartTone(t.tone))
      .sort((a, b) => a.value - b.value);
    for (const threshold of ordered) {
      if (bounded >= threshold.value) resolved = threshold.tone;
    }
    return resolved;
  }, [bounded, thresholds, tone]);

  const display = formatChartValue(bounded, resolveFormat(format), "tooltip");
  const name = toText(label) || toText(ariaLabel) || "Gauge";
  const unitText = toText(unit);

  return (
    <div
      className={cx("inline-flex flex-col items-center gap-1", className)}
      role="meter"
      aria-valuenow={bounded}
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuetext={unitText ? `${display} ${unitText}` : display}
      aria-label={name}
    >
      <div className="relative" style={{ width: box, height: box }}>
        <svg width={box} height={box} aria-hidden className="overflow-visible">
          <path
            d={arcPath(center, center, radius, -SWEEP / 2, SWEEP / 2)}
            fill="none"
            stroke="var(--surface-raised-x2)"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {ratio > 0 ? (
            <path
              d={arcPath(center, center, radius, -SWEEP / 2, -SWEEP / 2 + SWEEP * ratio)}
              fill="none"
              stroke={toneColor(activeTone)}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          ) : null}
        </svg>
        <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className={cx("font-display tabular-nums text-primary", figure)}>{display}</span>
          {unitText ? <span className="text-caption text-tertiary">{unitText}</span> : null}
        </div>
      </div>
      {toText(label) ? <span aria-hidden className="text-caption text-tertiary">{toText(label)}</span> : null}
    </div>
  );
}

// --- progress ring ---------------------------------------------------------

export type ProgressRingProps = {
  value: number;
  max?: number;
  tone?: ChartTone;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
};

const RING_SIZES = {
  sm: { box: 40, stroke: 4 },
  md: { box: 56, stroke: 5 },
  lg: { box: 72, stroke: 6 },
} as const;

/** Small ring for one bounded checklist value. */
export function ProgressRing({ value, max, tone, size, label, className }: ProgressRingProps) {
  const { box, stroke } = RING_SIZES[size === "sm" || size === "lg" ? size : "md"];
  const top = finiteOr(max, 100);
  const ceiling = top > 0 ? top : 100;
  const ratio = clampNum(finiteOr(value, 0) / ceiling, 0, 1);
  const percent = Math.round(ratio * 100);
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const name = toText(label) || "Progress";

  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={name}
      className={cx("inline-flex flex-col items-center gap-1", className)}
    >
      <div className="relative" style={{ width: box, height: box }}>
        <svg width={box} height={box} aria-hidden>
          <circle cx={box / 2} cy={box / 2} r={radius} fill="none" stroke="var(--surface-raised-x2)" strokeWidth={stroke} />
          <circle
            cx={box / 2} cy={box / 2} r={radius} fill="none" strokeLinecap="round" strokeWidth={stroke}
            stroke={toneColor(isChartTone(tone) ? tone : "series-1")}
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)}
            transform={`rotate(-90 ${box / 2} ${box / 2})`}
          />
        </svg>
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-caption tabular-nums text-primary">
          {percent}%
        </span>
      </div>
      {toText(label) ? <span aria-hidden className="text-caption text-tertiary">{toText(label)}</span> : null}
    </div>
  );
}

// --- progress bars ---------------------------------------------------------

export type ProgressEntry = {
  id: string;
  label: string;
  value: number;
  max?: number;
  tone?: ChartTone;
  /** Replaces the percentage readout, e.g. "412 / 500 km". */
  valueLabel?: string;
};

/** Stack of linear progress bars. The label and readout sit above each bar. */
export function ProgressBars({ entries, className }: { entries: readonly ProgressEntry[]; className?: string }) {
  const rows = asArray<unknown>(entries).filter(isRecord);
  return (
    <div className={cx("flex flex-col gap-3", className)}>
      {rows.map((row, index) => {
        const top = finiteOr(row.max, 100);
        const ceiling = top > 0 ? top : 100;
        const shown = clampNum(finiteOr(row.value, 0), 0, ceiling);
        const percent = (shown / ceiling) * 100;
        const label = toText(row.label);
        const valueLabel = toText(row.valueLabel);
        return (
          <div key={`${toText(row.id)}-${index}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-caption">
              <span className="min-w-0 truncate text-tertiary">{label}</span>
              <span className="shrink-0 tabular-nums text-secondary">{valueLabel || `${Math.round(percent)}%`}</span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={shown}
              aria-valuemin={0}
              aria-valuemax={ceiling}
              aria-label={label}
              className="h-1.5 overflow-hidden rounded-full bg-raised-2"
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${percent}%`, backgroundColor: toneColor(resolveTone(row.tone, 0)) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
