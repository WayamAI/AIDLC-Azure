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
        "flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-raised text-secondary">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl tracking-tight text-ink sm:text-2xl">{title}</h1>
            {badge}
          </div>
          {description && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-tertiary">{description}</p>
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

export function PageStat({ icon: Icon, label, value, accent = "primary", color }: PageStatProps) {
  return (
    <div className="dash-kpi">
      <div className="relative z-[1]">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="dash-kpi-icon">
            <Icon className={cn("h-4 w-4", color)} strokeWidth={1.75} />
          </div>
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-quaternary">{label}</span>
        </div>
        <p className={cn("dash-kpi-value", color)} data-accent={accent}>
          {value}
        </p>
      </div>
    </div>
  );
}
