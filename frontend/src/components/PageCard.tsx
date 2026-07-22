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
    <div className={cn("page-card overflow-hidden", className)}>
      {hasHeader && (
        <div className="relative z-[1] flex items-start justify-between gap-4 border-b border-border/40 px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("relative z-[1]", padding && "p-5 sm:p-6", bodyClassName)}>{children}</div>
    </div>
  );
}
