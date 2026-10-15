import type { ReactNode } from "react";

import { SectionBoundary } from "./boundary";
import { cx } from "./cx";
import { toText } from "./safe";

/**
 * In-page header. The app shell's top bar says where you are; this says what
 * this screen is for and carries its scope controls.
 */
export function PageHeader({
  title,
  description,
  info,
  mark,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Compact "i" popover beside the title (see InfoPopover). */
  info?: ReactNode;
  /** Optional decorative mark beside the title. Does not replace the heading. */
  mark?: ReactNode;
  /** Filters, chips or buttons aligned to the right. */
  actions?: ReactNode;
  /** Optional second row, typically filter chips. */
  children?: ReactNode;
  className?: string;
}) {
  const heading = toText(title);
  const text = toText(description);
  return (
    <div className={cx("min-w-0 shrink-0 border-b border-muted px-3 py-4 sm:px-5 lg:px-6", className)}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            {mark}
            <h2
              className="min-w-0 break-words font-display text-primary"
              style={{ fontSize: "clamp(1.375rem, 1rem + 2.2vw, 2.125rem)", lineHeight: 1.15 }}
            >
              {heading}
            </h2>
            {info}
          </div>
          {text ? (
            <p className="mt-1 max-w-[70ch] break-words text-body-md text-tertiary">{text}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="mt-3 min-w-0">{children}</div> : null}
    </div>
  );
}

/** Standard scroll container for page bodies. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-6",
        className,
      )}
    >
      <SectionBoundary label="Page body">{children}</SectionBoundary>
    </div>
  );
}
