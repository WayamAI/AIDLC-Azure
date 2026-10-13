import type { LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Mark } from "@/components/Mark";
import { markForPath, type MarkId } from "@/lib/marks";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Line icon, shown only when the page has no 3D mark. */
  icon?: LucideIcon;
  /** 3D mark beside the title. Defaults to the mark for the current route; pass false for none. */
  mark?: MarkId | false;
  title: string;
  description?: string;
  className?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({
  icon: Icon,
  mark,
  title,
  description,
  className,
  badge,
  actions,
}: PageHeaderProps) {
  const { pathname } = useLocation();
  const markId = mark === false ? undefined : (mark ?? markForPath(pathname));

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-stroke-muted pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {markId ? (
            <Mark id={markId} size={40} />
          ) : (
            Icon && <Icon className="h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden />
          )}
          <h2 className="min-w-0 font-display text-lg font-normal text-ink sm:text-[22px] sm:leading-tight">{title}</h2>
          {badge}
        </div>
        {description && <p className="mt-1 max-w-[70ch] text-sm text-ink-tertiary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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
    <div className="dash-kpi flex min-w-0 flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{label}</span>
        <Icon className={cn("h-4 w-4 shrink-0 text-ink-quaternary", color)} strokeWidth={1.75} aria-hidden />
      </div>
      <p className={cn("dash-kpi-value", color)} data-accent={accent}>
        {value}
      </p>
    </div>
  );
}
