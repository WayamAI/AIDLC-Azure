import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { SectionBoundary } from "./boundary";
import { cx } from "./cx";
import { toText } from "./safe";

/**
 * Compact "i" beside a page title. The long how-to copy lives here so it
 * does not eat a row of the page. Closes on outside click or Escape.
 */
export function InfoPopover({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  /** Applied to the "i" trigger button. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex shrink-0" ref={rootRef}>
      <button
        type="button"
        aria-label={toText(label) || "More information"}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "inline-flex size-7 items-center justify-center rounded-full text-quaternary outline-none transition-colors duration-[150ms] hover:bg-raised hover:text-secondary focus-visible:ring-2 focus-visible:ring-active",
          className,
        )}
      >
        <Info size={15} strokeWidth={1.75} aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={toText(label) || "More information"}
          className="absolute top-[calc(100%+8px)] left-0 z-50 w-[min(calc(100vw-2.5rem),22rem)] rounded-lg border border-muted bg-container p-3 text-body-sm text-secondary shadow-lg sm:w-[28rem]"
        >
          <SectionBoundary label="Info">{children}</SectionBoundary>
        </div>
      ) : null}
    </div>
  );
}
