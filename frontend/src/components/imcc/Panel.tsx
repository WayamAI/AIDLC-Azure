import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-raised",
        padded && "p-4 sm:p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function KpiStat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-raised p-4 sm:p-5", className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-quaternary">{label}</p>
      <p className="mt-2 font-display text-2xl tracking-tight text-primary sm:text-3xl">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-tertiary">{hint}</p>}
    </div>
  );
}
