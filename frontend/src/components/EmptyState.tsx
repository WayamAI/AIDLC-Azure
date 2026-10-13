import type { ReactNode } from "react";
import { Mark } from "@/components/Mark";
import type { MarkId } from "@/lib/marks";
import { cn } from "@/lib/utils";

export type EmptyKind =
  | "noResults"
  | "noRequirements"
  | "noRuns"
  | "nothingToReview"
  | "notConfigured"
  | "error"
  | "loading";

const KIND_MARK: Record<EmptyKind, MarkId> = {
  noResults: "mark-empty-no-results",
  noRequirements: "mark-empty-no-requirements",
  noRuns: "mark-empty-no-runs",
  nothingToReview: "mark-empty-nothing-to-review",
  notConfigured: "mark-empty-not-configured",
  error: "mark-empty-error",
  loading: "mark-chakram-wheel",
};

/**
 * Centred placeholder for an empty, loading, unconfigured or failed view: a 3D
 * mark above one line of guidance. Loading turns the Chakram wheel slowly.
 */
export function EmptyState({
  kind = "noResults",
  mark,
  title,
  children,
  action,
  compact = false,
  className,
}: {
  kind?: EmptyKind;
  /** Overrides the mark chosen by `kind`. */
  mark?: MarkId;
  /** Optional heading above the message. */
  title?: ReactNode;
  /** The message: what is empty and what to do next. */
  children?: ReactNode;
  /** Optional button or link. */
  action?: ReactNode;
  /** Smaller variant for table bodies and narrow panels. */
  compact?: boolean;
  className?: string;
}) {
  const isError = kind === "error";
  return (
    <div
      role={isError ? "alert" : kind === "loading" ? "status" : undefined}
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 text-center",
        compact ? "py-6" : "py-10",
        className,
      )}
    >
      <Mark
        id={mark ?? KIND_MARK[kind]}
        size={compact ? 44 : 64}
        className={cn("mb-1", kind === "loading" && "animate-[spin_6s_linear_infinite] motion-reduce:animate-none")}
      />
      {title && <p className="text-sm font-medium text-ink">{title}</p>}
      {children && (
        <div className={cn("max-w-md text-sm", isError ? "text-destructive" : "text-ink-tertiary")}>{children}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
