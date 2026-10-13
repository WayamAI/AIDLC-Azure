import { Mark } from "@/components/Mark";
import type { MarkId } from "@/lib/marks";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardPanel({
  title,
  subtitle,
  icon: Icon,
  iconClassName,
  badge,
  children,
  className,
  noPadding,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <section className={cn("dash-panel flex min-w-0 flex-col", className)}>
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-stroke-muted px-4">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0 text-ink-quaternary", iconClassName)} strokeWidth={1.75} aria-hidden />}
          <h3 className="min-w-0 truncate font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{title}</h3>
        </div>
        {badge ?? (subtitle ? <span className="hidden truncate text-xs text-ink-tertiary sm:block">{subtitle}</span> : null)}
      </header>
      <div className={cn("min-w-0 flex-1", !noPadding && "p-4")}>{children}</div>
    </section>
  );
}

export function DashboardKpi({
  label,
  value,
  icon: Icon,
  change,
  up,
  accent = "primary",
  mark,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  /** 3D mark shown instead of the line icon. */
  mark?: MarkId;
  change?: string;
  up?: boolean;
  accent?: "primary" | "positive" | "success" | "destructive" | "warning";
}) {
  const accentMap = {
    primary: "dash-kpi-accent-primary",
    positive: "dash-kpi-accent-positive",
    success: "dash-kpi-accent-positive",
    destructive: "dash-kpi-accent-destructive",
    warning: "dash-kpi-accent-warning",
  };

  return (
    <div className={cn("dash-kpi flex min-w-0 flex-col gap-1.5", accentMap[accent])}>
      <div className="flex items-start justify-between gap-2">
        <span title={typeof label === "string" ? label : undefined} className="line-clamp-2 min-w-0 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{label}</span>
        {mark ? <Mark id={mark} size={32} className="-mt-1" /> : <Icon className="h-4 w-4 shrink-0 text-ink-quaternary" strokeWidth={1.75} aria-hidden />}
      </div>
      <p className="dash-kpi-value">{value}</p>
      {change ? (
        <span
          className={cn(
            "text-xs tabular-nums",
            up ? "text-positive" : change === "0" ? "text-ink-tertiary" : "text-destructive",
          )}
        >
          {change}
        </span>
      ) : null}
    </div>
  );
}

export function ChartTooltipBox({
  label,
  rows,
}: {
  label?: string;
  rows: { name: string; value: string | number; color: string }[];
}) {
  return (
    <div className="dash-chart-tooltip">
      {label && <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>}
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-2 text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
              {row.name}
            </span>
            <span className="font-mono font-semibold tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
