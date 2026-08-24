import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageShellSize = "md" | "lg" | "xl" | "full";

/**
 * Constrained shells are centered in the main pane.
 * `full` still caps width on ultra-wide so content doesn’t hug the left edge.
 */
const sizeClasses: Record<PageShellSize, string> = {
  md: "mx-auto w-full max-w-3xl",
  lg: "mx-auto w-full max-w-5xl",
  xl: "mx-auto w-full max-w-6xl",
  full: "mx-auto w-full max-w-7xl",
};

interface PageShellProps {
  children: ReactNode;
  size?: PageShellSize;
  className?: string;
}

export function PageShell({ children, size = "full", className }: PageShellProps) {
  return <div className={cn("space-y-6", sizeClasses[size], className)}>{children}</div>;
}
