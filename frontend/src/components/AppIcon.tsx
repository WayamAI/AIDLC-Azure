import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

type AppIconProps = {
  /** Free Hugeicons icon data from `@hugeicons/core-free-icons` */
  icon: unknown;
  size?: number;
  className?: string;
  /** 1.5–1.75 stays crisp at sidebar sizes */
  strokeWidth?: number;
};

/**
 * Shared Hugeicons wrapper consistent stroke, color inheritance, and alignment.
 */
export function AppIcon({ icon, size = 16, className, strokeWidth = 1.55 }: AppIconProps) {
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
