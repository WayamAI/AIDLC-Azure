import { HugeiconsIcon } from "@hugeicons/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AppIconProps = {
  /** A Lucide icon component. Legacy Hugeicons icon data is still accepted. */
  icon: LucideIcon | unknown;
  size?: number;
  className?: string;
  strokeWidth?: number;
};

/**
 * Shared icon wrapper: one stroke weight (1.75) and colour inheritance across
 * the app, so navigation and page icons read as a single set.
 */
export function AppIcon({ icon, size = 16, className, strokeWidth = 1.75 }: AppIconProps) {
  if (Array.isArray(icon)) {
    return (
      <HugeiconsIcon
        icon={icon as Parameters<typeof HugeiconsIcon>[0]["icon"]}
        size={size}
        color="currentColor"
        strokeWidth={strokeWidth}
        absoluteStrokeWidth
        aria-hidden
        className={cn("shrink-0", className)}
      />
    );
  }
  const Icon = icon as LucideIcon;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden className={cn("shrink-0", className)} />;
}
