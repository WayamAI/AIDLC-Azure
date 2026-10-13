import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageCardProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padding?: boolean;
}

export function PageCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  padding = true,
}: PageCardProps) {
  const hasHeader = title || description || actions;

  return (
    <section className={cn("page-card flex min-w-0 flex-col overflow-hidden", className)}>
      {hasHeader && (
        <header className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-stroke-muted px-4 py-2">
          <div className="min-w-0">
            {title && <h2 className="truncate font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-tertiary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("min-w-0", padding && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
