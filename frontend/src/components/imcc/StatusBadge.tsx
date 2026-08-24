import { cn } from "@/lib/utils";

export type StatusTone =
  | "critical"
  | "warning"
  | "success"
  | "info"
  | "pending"
  | "neutral";

const toneClass: Record<StatusTone, string> = {
  critical: "bg-status-critical",
  warning: "bg-status-warning",
  success: "bg-status-success",
  info: "bg-status-info",
  pending: "bg-status-pending",
  neutral: "bg-status-neutral",
};

const sizeClass = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
} as const;

export function StatusBadge({
  tone,
  children,
  size = "sm",
  title,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  size?: keyof typeof sizeClass;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap text-status-content",
        toneClass[tone],
        sizeClass[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
