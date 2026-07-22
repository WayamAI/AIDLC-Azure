import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  className,
  badge,
  actions,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b border-border/40 pb-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon && (
          <div className="dash-panel-icon h-11 w-11">
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {badge}
          </div>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

interface PageStatProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  accent?: "primary" | "positive" | "success" | "destructive" | "warning";
  color?: string;
}

export function PageStat({
  icon: Icon,
  label,
  value,
  accent = "primary",
  color,
}: PageStatProps) {
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
      <div className="relative z-[1]">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="dash-kpi-icon">
            <Icon className={cn("h-4 w-4", color)} strokeWidth={2} />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        </div>
        <p className={cn("dash-kpi-value", color)}>{value}</p>
      </div>
    </div>
  );
}
