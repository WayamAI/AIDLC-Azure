import { cx } from "./cx";

const MARKS_BASE =
  (import.meta.env?.VITE_MARKS_BASE as string | undefined)?.replace(/\/$/, "") ||
  "/marks";

const VALID_ID = /^[\w.-]+$/;

/** URL of a 3D mark PNG. Marks are served from `public/marks/<id>.png`. */
export function markUrl(id: string) {
  return `${MARKS_BASE}/${String(id)}.png`;
}

/** Decorative 3D mark. Empty alt: the adjacent label is the name. Renders nothing for an empty or invalid id. */
export function Mark({
  id,
  size = 40,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  if (typeof id !== "string" || !VALID_ID.test(id)) return null;
  const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 40;
  return (
    <img
      src={markUrl(id)}
      alt=""
      width={px}
      height={px}
      draggable={false}
      className={cx("pointer-events-none shrink-0 select-none object-contain", className)}
    />
  );
}
