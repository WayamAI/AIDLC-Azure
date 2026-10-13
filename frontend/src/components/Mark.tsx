import { MARKS, isMarkId, type MarkId } from "@/lib/marks";
import { cn } from "@/lib/utils";

/** The 96px file covers sizes up to 48px at 2x; anything larger uses the 256px file. */
export function markSrc(id: MarkId, size = 40): string {
  return size <= 48 ? MARKS[id].src96 : MARKS[id].src;
}

/**
 * Chakram 3D mark (see `lib/marks.ts`). Purely decorative: it never stands in
 * for a label, number or control, so it is hidden from assistive technology.
 * Renders nothing for an id that has no image.
 */
export function Mark({
  id,
  size = 40,
  className,
}: {
  /** A `MarkId`; plain strings are accepted so lookup-table results can be passed straight through. */
  id: MarkId | (string & {}) | null | undefined;
  /** Rendered width and height in CSS pixels. */
  size?: number;
  className?: string;
}) {
  if (!id || !isMarkId(id)) return null;
  return (
    <img
      src={markSrc(id, size)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={cn("shrink-0 select-none", className)}
    />
  );
}
