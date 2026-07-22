import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageShellSize = "md" | "lg" | "xl" | "full";

/** md = narrow forms; lg/xl/full = use available content width (minimal side gutters) */
const sizeClasses: Record<PageShellSize, string> = {
  md: "max-w-3xl",
  lg: "max-w-none",
  xl: "max-w-none",
  full: "max-w-none",
};

interface PageShellProps {
  children: ReactNode;
  size?: PageShellSize;
  className?: string;
}

export function PageShell({ children, size = "full", className }: PageShellProps) {
  return (
    <div className={cn("w-full space-y-6", sizeClasses[size], className)}>
      {children}
    </div>
  );
}
