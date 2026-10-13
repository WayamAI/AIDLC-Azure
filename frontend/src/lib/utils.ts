import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Text written for a chat tool (Slack "mrkdwn") as plain prose for the page:
 * drops `:emoji_codes:` and the `*bold*` / `_italic_` / `` `code` `` markers.
 */
export function plainFromChatMarkup(text: string): string {
  return text
    .replace(/(^|[^\w:]):[a-z][a-z0-9_+-]*:(?!\d)/gi, "$1")
    .replace(/\*(\S[^*\n]*?)\*/g, "$1")
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
