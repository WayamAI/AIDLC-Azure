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
    <div className={cn("dash-panel group", noPadding && "p-0", className)}>
      <div className="dash-panel-shine" aria-hidden />
      <div className={cn("relative z-[1]", !noPadding && "p-5 sm:p-6")}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              {Icon && (
                <div className={cn("dash-panel-icon", iconClassName)}>
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>
              )}
              <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                {title}
              </h3>
            </div>
            {subtitle && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {badge}
        </div>
        {children}
      </div>
    </div>
  );
}

export function DashboardKpi({
  label,
  value,
  icon: Icon,
  change,
  up,
  accent = "primary",
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
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
    <div className={cn("dash-kpi", accentMap[accent])}>
      <div className="dash-kpi-mesh" aria-hidden />
      <div className="relative z-[1] flex h-full flex-col">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="dash-kpi-icon">
            <Icon className="h-4 w-4" strokeWidth={2} />
          </div>
          {change ? (
            <span
              className={cn(
                "dash-kpi-delta",
                up ? "text-positive" : change === "0" ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {change}
            </span>
          ) : null}
        </div>
        <p className="dash-kpi-value">{value}</p>
        <p className="mt-auto pt-2 text-[11px] font-medium text-muted-foreground">{label}</p>
      </div>
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
