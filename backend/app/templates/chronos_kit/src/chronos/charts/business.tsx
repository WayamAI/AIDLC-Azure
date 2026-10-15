import type { ReactNode } from "react";
import { cx } from "../cx";
import { asArray, isRecord, toNum, toText } from "../safe";
import {
  clampNum,
  finiteOr,
  formatChartValue,
  resolveFormat,
  toneColor,
  type ChartValueFormat,
} from "./frame";

/* Business visuals: conversion funnel, bullet KPI and the card that frames a chart. */

// --- funnel ----------------------------------------------------------------

export type FunnelStage = { id: string; label: string; value: number };

export type FunnelChartProps = {
  /** Ordered stages, first is the top of the funnel. */
  stages: readonly FunnelStage[];
  format?: ChartValueFormat;
  ariaLabel?: string;
  className?: string;
};

/**
 * Centred horizontal bars that narrow by value. Each stage shows its
 * conversion from the stage before; the footer gives first-to-last conversion.
 * Ported from the Wayam funnel preset: conversion is value over the first
 * stage, and step conversion is value over the previous stage.
 */
export function FunnelChart({ stages, format, ariaLabel, className }: FunnelChartProps) {
  const kind = resolveFormat(format);
  const rows = asArray<unknown>(stages)
    .filter(isRecord)
    .map((row, index) => ({
      id: toText(row.id) || `stage-${index}`,
      label: toText(row.label) || `Stage ${index + 1}`,
      value: Math.max(0, finiteOr(row.value, 0)),
    }));

  if (rows.length === 0) {
    return (
      <div className={cx("flex min-h-[6rem] items-center justify-center px-4 text-center", className)}>
        <p className="text-body-md text-tertiary">No funnel stages to display</p>
      </div>
    );
  }

  const first = rows[0]!.value;
  const last = rows[rows.length - 1]!.value;
  const peak = Math.max(...rows.map((row) => row.value));
  const overall = first > 0 ? Math.round((last / first) * 100) : 0;
  const color = toneColor("series-1");

  return (
    <figure aria-label={toText(ariaLabel) || "Conversion funnel"} className={cx("m-0 flex min-w-0 flex-col gap-2", className)}>
      <ol className="flex flex-col gap-1.5">
        {rows.map((row, index) => {
          const previous = index > 0 ? rows[index - 1]!.value : null;
          const step =
            previous === null ? null : previous > 0 ? Math.round((row.value / previous) * 1000) / 10 : 0;
          const width = peak > 0 ? (row.value / peak) * 100 : 0;
          return (
            <li key={`${row.id}-${index}`} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3">
              <span className="truncate text-caption text-secondary">{row.label}</span>
              <div className="relative h-7 min-w-0">
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 max-w-full -translate-x-1/2 rounded-sm"
                  style={{ width: `${width}%`, backgroundColor: color, opacity: 0.88 }}
                />
              </div>
              <span className="text-right text-caption tabular-nums text-primary">
                {formatChartValue(row.value, kind, "tooltip")}
                <span className="ml-2 text-tertiary">{step === null ? "" : `${step}%`}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-caption text-tertiary">
        {rows.length} stages, overall conversion {overall}%
      </p>
    </figure>
  );
}

// --- bullet ----------------------------------------------------------------

export type BulletChartProps = {
  value: number;
  target: number;
  /** Ascending band ends: poor, ok, good. Defaults are derived from the target. */
  ranges?: [number, number, number];
  label?: string;
  format?: ChartValueFormat;
  ariaLabel?: string;
  className?: string;
};

const VIEW_W = 1000;
const VIEW_H = 24;

/** Band ends from the caller, or defaults that bracket the target. Invalid input falls back. */
function resolveBands(ranges: unknown, target: number, ceiling: number): [number, number, number] {
  const parsed = asArray<unknown>(ranges).map((n) => toNum(n));
  const valid =
    parsed.length === 3 &&
    parsed.every((n) => !Number.isNaN(n) && n >= 0) &&
    parsed[0]! <= parsed[1]! &&
    parsed[1]! <= parsed[2]!;
  if (valid) return [parsed[0]!, parsed[1]!, parsed[2]!];
  return [target * 0.6, target * 0.9, Math.max(ceiling, target)];
}

/** Bullet KPI: value bar against a target marker over three bands. */
export function BulletChart({ value, target, ranges, label, format, ariaLabel, className }: BulletChartProps) {
  const kind = resolveFormat(format);
  const actual = Math.max(0, finiteOr(value, 0));
  const goal = Math.max(0, finiteOr(target, 0));
  const ceiling = Math.max(actual, goal, 1) * 1.2;
  const bands = resolveBands(ranges, goal, ceiling);
  const scale = Math.max(bands[2], actual, goal) || 1;
  const x = (n: number) => (clampNum(n, 0, scale) / scale) * VIEW_W;
  const shownValue = formatChartValue(actual, kind, "tooltip");
  const shownTarget = formatChartValue(goal, kind, "tooltip");
  const name = toText(ariaLabel) || `${toText(label) || "Metric"}: ${shownValue} against target ${shownTarget}`;

  const bandStart = [0, bands[0], bands[1]];
  const bandEnd = [bands[0], bands[1], bands[2]];
  const bandOpacity = [0.22, 0.14, 0.07];

  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      {toText(label) ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-caption text-tertiary">{toText(label)}</span>
          <span className="text-caption tabular-nums text-primary">
            {shownValue}
            <span className="text-tertiary"> / target {shownTarget}</span>
          </span>
        </div>
      ) : null}
      <svg
        role="img"
        aria-label={name}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-6 w-full overflow-visible"
      >
        {bandStart.map((start, index) => (
          <rect
            key={index}
            x={x(start)}
            y={0}
            width={Math.max(0, x(bandEnd[index]!) - x(start))}
            height={VIEW_H}
            fill="var(--text-quaternary)"
            fillOpacity={bandOpacity[index]}
          />
        ))}
        <rect x={0} y={8} width={x(actual)} height={8} fill={toneColor("series-1")} />
        <line
          x1={x(goal)}
          x2={x(goal)}
          y1={3}
          y2={VIEW_H - 3}
          stroke="var(--text-primary)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// --- card ------------------------------------------------------------------

export type ChartCardProps = {
  title: string;
  description?: string;
  /** Toolbar controls such as a range picker. */
  action?: ReactNode;
  /** Legend or summary text under the chart. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Bordered container for one chart. The title is an 11px uppercase caption, as on Panel. */
export function ChartCard({ title, description, action, footer, children, className }: ChartCardProps) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-3 rounded-lg border border-muted bg-container p-4", className)}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[11px] uppercase tracking-[0.08em] text-quaternary">{toText(title)}</h2>
          {toText(description) ? <p className="mt-1 text-caption text-tertiary">{toText(description)}</p> : null}
        </div>
        {action ? <div className="max-w-full shrink-0">{action}</div> : null}
      </header>
      <div className="min-w-0">{children}</div>
      {footer ? <div className="border-t border-muted pt-3 text-caption text-tertiary">{footer}</div> : null}
    </section>
  );
}
