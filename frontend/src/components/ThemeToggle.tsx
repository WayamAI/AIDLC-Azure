import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun01Icon, Moon02Icon, ComputerIcon } from "@hugeicons/core-free-icons";
import { AppIcon } from "@/components/AppIcon";

const cycle = ["light", "dark", "system"] as const;

const iconFor = {
  light: Sun01Icon,
  dark: Moon02Icon,
  system: ComputerIcon,
} as const;

const labelFor = {
  light: "Light mode click for dark",
  dark: "Dark mode click for system",
  system: "System mode click for light",
} as const;

/** Cycles light → dark → system (IMCC-style). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (mounted && cycle.includes(theme as (typeof cycle)[number])
    ? theme
    : "dark") as (typeof cycle)[number];
  const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];

  return (
    <button
      type="button"
      aria-label={mounted ? labelFor[current] : "Toggle theme"}
      title={mounted ? labelFor[current] : "Toggle theme"}
      onClick={() => setTheme(next)}
      className={
        className ??
        "flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-[var(--color-raised)] text-[var(--color-tertiary)] transition-colors hover:bg-[var(--color-action)] hover:text-[var(--color-primary)]"
      }
    >
      {mounted ? (
        <AppIcon icon={iconFor[current]} size={16} strokeWidth={1.6} />
      ) : (
        <span className="h-4 w-4" />
      )}
    </button>
  );
}
