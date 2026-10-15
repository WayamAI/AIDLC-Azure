import { useMemo } from "react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { cx } from "../cx";
import { asArray, isRecord, toNum, toText } from "../safe";
import {
  ChartFrame,
  HiddenDataTable,
  Legend,
  TooltipContent,
  formatChartValue,
  resolveFormat,
  resolveHeight,
  resolveTone,
  toneColor,
  type ChartTone,
  type ChartValueFormat,
  type TooltipEntry,
} from "./frame";

export type DonutDatum = {
  /** Stable identity. Used for keys, never the array index. */
  id: string;
  label: string;
  value: number;
  tone?: ChartTone;
};

export type DonutChartProps = {
  data: readonly DonutDatum[];
  /** Text in the hole. Defaults to the formatted total. */
  centerValue?: string;
  centerLabel?: string;
  height?: number;
  showLegend?: boolean;
  legendPosition?: "bottom" | "right";
  format?: ChartValueFormat;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage?: string;
  ariaLabel?: string;
  className?: string;
};

type Slice = { key: string; id: string; label: string; value: number; color: string };

/** Largest font size, in px, at which `text` fits `maxWidth` in Michroma (about 0.9em per glyph). */
function fitFontPx(text: string, maxWidth: number): number {
  const glyphs = Math.max(1, text.length);
  return Math.round(clampFont(Math.min(40, maxWidth / (0.9 * glyphs))));
}

function clampFont(px: number): number {
  return Math.min(40, Math.max(11, px));
}

/**
 * Part-to-whole ring. Keep to about six slices; beyond that a bar chart reads
 * better. Slices with a non-numeric or negative value count as zero.
 */
export function DonutChart({
  data,
  centerValue,
  centerLabel,
  height,
  showLegend = true,
  legendPosition = "bottom",
  format,
  loading = false,
  error = null,
  onRetry,
  emptyMessage,
  ariaLabel,
  className,
}: DonutChartProps) {
  const kind = resolveFormat(format);
  const pixelHeight = resolveHeight(height);
  const label = toText(ariaLabel) || "Donut chart";

  const slices = useMemo<Slice[]>(
    () =>
      asArray<unknown>(data)
        .filter(isRecord)
        .map((row, index) => {
          const raw = toNum(row.value);
          const id = toText(row.id) || `slice-${index}`;
          return {
            key: `${id}-${index}`,
            id,
            label: toText(row.label) || id,
            value: Number.isNaN(raw) || raw < 0 ? 0 : raw,
            color: toneColor(resolveTone(row.tone, index)),
          };
        }),
    [data],
  );

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const empty = total <= 0;
  const ready = !loading && !error && !empty;

  const outerRadius = Math.max(40, pixelHeight / 2 - 12);
  const innerRadius = outerRadius * 0.62;

  const shareOf = (value: number) => (total > 0 ? (value / total) * 100 : 0);

  const centre = centerValue !== undefined ? toText(centerValue) : formatChartValue(total, kind, "tooltip");
  const centreFont = fitFontPx(centre, innerRadius * 2 * 0.8);

  const table = ready ? (
    <HiddenDataTable
      caption={`Data table for ${label}`}
      headers={["Segment", "Value", "Share"]}
      rows={slices.map((slice) => [
        slice.label,
        formatChartValue(slice.value, kind, "exact"),
        `${shareOf(slice.value).toFixed(1)}%`,
      ])}
    />
  ) : null;

  const overlay =
    ready && centre ? (
      <>
        <span className="font-display tabular-nums leading-none text-primary" style={{ fontSize: centreFont }}>
          {centre}
        </span>
        {toText(centerLabel) ? (
          <span className="mt-1 text-caption text-tertiary">{toText(centerLabel)}</span>
        ) : null}
      </>
    ) : null;

  const right = legendPosition === "right";

  return (
    <div
      className={cx(
        "flex min-w-0 gap-4",
        right ? "flex-col sm:flex-row sm:items-center" : "flex-col",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1">
        <ChartFrame
          ariaLabel={label}
          height={pixelHeight}
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={empty}
          emptyMessage={emptyMessage}
          responsive
          overlay={overlay}
          table={table}
        >
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={1}
              stroke="var(--surface-container)"
              strokeWidth={1}
              animationDuration={500}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={(props: unknown) => {
                const p = props as { payload?: readonly { payload?: Slice }[] };
                const slice = asArray<{ payload?: Slice }>(p.payload)[0]?.payload;
                const entries: TooltipEntry[] = slice
                  ? [
                      {
                        key: slice.key,
                        label: slice.label,
                        color: slice.color,
                        value: `${formatChartValue(slice.value, kind, "tooltip")} (${shareOf(slice.value).toFixed(1)}%)`,
                      },
                    ]
                  : [];
                return <TooltipContent entries={entries} />;
              }}
            />
          </PieChart>
        </ChartFrame>
      </div>

      {showLegend && ready ? (
        <Legend
          items={slices.map((slice) => ({ key: slice.key, label: slice.label, color: slice.color }))}
          className={right ? "flex-col items-start" : undefined}
        />
      ) : null}
    </div>
  );
}
