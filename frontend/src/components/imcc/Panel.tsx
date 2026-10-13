import { Mark } from "@/components/Mark";
import type { MarkId } from "@/lib/marks";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-stroke-muted bg-container",
        padded && "p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function KpiStat({
  label,
  value,
  hint,
  className,
  mark,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
  /** 3D mark shown at the right of the label row. */
  mark?: MarkId;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-lg border border-stroke-muted bg-container px-4 py-3.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <p title={label} className="line-clamp-2 min-w-0 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{label}</p>
        {mark && <Mark id={mark} size={32} className="-mt-1" />}
      </div>
      <p className="font-display text-[22px] leading-tight tabular-nums text-ink sm:text-[28px]">{value}</p>
      {hint && <p title={hint} className="line-clamp-2 text-xs text-ink-quaternary">{hint}</p>}
    </div>
  );
}
