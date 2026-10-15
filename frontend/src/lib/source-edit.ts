/**
 * Pure source-level helpers for editing a JSX element found by clicking in the
 * live preview. No DOM, no React, no dependencies.
 *
 * Positions are 0-based string offsets into the source; `line` is 1-based.
 */

export type TagLocation = { start: number; end: number; tag: string; text: string }; // start = index of '<', end = index just after the closing '>' of the OPENING tag; text = source.slice(start,end)

export type ClassNameInfo = { kind: "literal"; value: string } | { kind: "none" } | { kind: "dynamic"; raw: string };

export type TextEditResult = { ok: true; path: string; content: string } | { ok: false; reason: string };

const NOT_COMPUTED_REASON =
  "This text is computed in code, so it can't be edited directly. Ask the AI to change it.";
const AMBIGUOUS_REASON = "This text appears in several places; ask the AI to change the one you mean.";

const SOURCE_EXT = /\.(tsx?|jsx?)$/;

// ---------------------------------------------------------------------------
// Low-level JS/JSX scanning helpers
// ---------------------------------------------------------------------------

/** Returns the index just after the string or template literal that starts at i. */
function skipString(src: string, i: number): number {
  const q = src[i];
  if (q === "`") return skipTemplate(src, i);
  let k = i + 1;
  while (k < src.length) {
    const c = src[k];
    if (c === "\\") {
      k += 2;
      continue;
    }
    if (c === q) return k + 1;
    k++;
  }
  return src.length;
}

/** Template literal starting at i; `${ ... }` expressions are skipped as code. */
function skipTemplate(src: string, i: number): number {
  let k = i + 1;
  while (k < src.length) {
    const c = src[k];
    if (c === "\\") {
      k += 2;
      continue;
    }
    if (c === "`") return k + 1;
    if (c === "$" && src[k + 1] === "{") {
      k = skipExpr(src, k + 2);
      continue;
    }
    k++;
  }
  return src.length;
}

/** Scans a JS expression starting just after an opening `{`; returns the index just after its matching `}`. */
function skipExpr(src: string, i: number): number {
  let depth = 0;
  let k = i;
  while (k < src.length) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      k = skipString(src, k);
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      if (depth === 0) return k + 1;
      depth--;
    }
    k++;
  }
  return src.length;
}

/**
 * From just after the tag name, scans to the first `>` at brace depth 0 outside
 * strings. Returns the index just after it, or -1 if the tag never closes.
 */
function scanOpeningEnd(src: string, i: number): number {
  let k = i;
  while (k < src.length) {
    const c = src[k];
    if (c === '"' || c === "'" || c === "`") {
      k = skipString(src, k);
      continue;
    }
    if (c === "{") {
      k = skipExpr(src, k + 1);
      continue;
    }
    if (c === ">") return k + 1;
    k++;
  }
  return -1;
}

function decodeJsString(raw: string): string {
  return raw.replace(/\\([\s\S])/g, (_m, ch: string) => {
    if (ch === "n") return "\n";
    if (ch === "t") return "\t";
    if (ch === "r") return "\r";
    return ch;
  });
}

/** Escapes text for a JS string literal delimited by `quote`. */
function escapeJsString(s: string, quote: string): string {
  let out = s.replace(/\\/g, "\\\\");
  out = out.split(quote).join("\\" + quote);
  out = out.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  if (quote === "`") out = out.replace(/\$\{/g, "\\${");
  return out;
}

/** Escapes text for a JSX attribute value delimited by `quote` (JSX has no backslash escapes). */
function escapeJsxAttr(s: string, quote: string): string {
  if (quote === '"') return s.split('"').join("&quot;");
  return s.split("'").join("&apos;");
}

function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && /[\w$-]/.test(c);
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

function sameTokenSet(a: string[], b: string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const t of sa) if (!sb.has(t)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// findOpeningTag
// ---------------------------------------------------------------------------

export function findOpeningTag(
  source: string,
  line: number,
  tagName: string,
  domClass?: string | null,
): TagLocation | null {
  if (!tagName || !Number.isInteger(line) || line < 1) return null;

  // Locate the start and end offsets of the requested 1-based line.
  let lineStart = 0;
  for (let l = 1; l < line; l++) {
    const nl = source.indexOf("\n", lineStart);
    if (nl < 0) return null;
    lineStart = nl + 1;
  }
  let lineEnd = source.indexOf("\n", lineStart);
  if (lineEnd < 0) lineEnd = source.length;

  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${escaped}(?=[\\s>/])`, "g");
  re.lastIndex = lineStart;

  const candidates: TagLocation[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null && m.index < lineEnd) {
    const start = m.index;
    const end = scanOpeningEnd(source, start + 1 + tagName.length);
    if (end < 0) continue;
    candidates.push({ start, end, tag: tagName, text: source.slice(start, end) });
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1 && domClass != null) {
    const want = tokens(domClass);
    for (const c of candidates) {
      const info = readClassName(c);
      if (info.kind === "literal" && sameTokenSet(tokens(info.value), want)) return c;
    }
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// className read / write
// ---------------------------------------------------------------------------

type AttrSpan = {
  /** Index (within tag.text) of the opening quote or `{` of the value. */
  valueStart: number;
  /** Index (within tag.text) just after the closing quote or `}`. */
  valueEnd: number;
  quoted: boolean;
};

/** Finds a top-level attribute `name` inside the tag text (ignores text inside braces and strings). */
function findAttr(tag: TagLocation, name: string): AttrSpan | null {
  const t = tag.text;
  let k = 1 + tag.tag.length;
  while (k < t.length) {
    const c = t[k];
    if (c === '"' || c === "'" || c === "`") {
      k = skipString(t, k);
      continue;
    }
    if (c === "{") {
      k = skipExpr(t, k + 1);
      continue;
    }
    if (
      t.startsWith(name, k) &&
      /\s/.test(t[k - 1] ?? "") &&
      !isIdentChar(t[k + name.length])
    ) {
      let p = k + name.length;
      while (p < t.length && /\s/.test(t[p])) p++;
      if (t[p] === "=") {
        p++;
        while (p < t.length && /\s/.test(t[p])) p++;
        if (t[p] === '"' || t[p] === "'") {
          return { valueStart: p, valueEnd: skipString(t, p), quoted: true };
        }
        if (t[p] === "{") {
          return { valueStart: p, valueEnd: skipExpr(t, p + 1), quoted: false };
        }
      }
    }
    k++;
  }
  return null;
}

export function readClassName(tag: TagLocation): ClassNameInfo {
  const attr = findAttr(tag, "className");
  if (!attr) return { kind: "none" };
  const t = tag.text;
  if (attr.quoted) {
    return { kind: "literal", value: t.slice(attr.valueStart + 1, attr.valueEnd - 1) };
  }
  const inner = t.slice(attr.valueStart + 1, attr.valueEnd - 1).trim();
  const m = /^"((?:[^"\\]|\\[\s\S])*)"$/.exec(inner) ?? /^'((?:[^'\\]|\\[\s\S])*)'$/.exec(inner);
  if (m) return { kind: "literal", value: decodeJsString(m[1]) };
  return { kind: "dynamic", raw: inner };
}

export function setClassName(source: string, tag: TagLocation, newClass: string): string | null {
  const info = readClassName(tag);
  if (info.kind === "dynamic") return null;

  const attr = findAttr(tag, "className");
  if (!attr) {
    // Insert right after the tag name.
    const pos = tag.start + 1 + tag.tag.length;
    return source.slice(0, pos) + ` className="${escapeJsxAttr(newClass, '"')}"` + source.slice(pos);
  }

  const t = tag.text;
  let contentStart: number;
  let contentEnd: number;
  let replacement: string;
  if (attr.quoted) {
    const q = t[attr.valueStart];
    contentStart = tag.start + attr.valueStart + 1;
    contentEnd = tag.start + attr.valueEnd - 1;
    replacement = escapeJsxAttr(newClass, q);
  } else {
    // {"..."} or {'...'}: replace the content between the string quotes inside the braces.
    let qPos = attr.valueStart + 1;
    while (/\s/.test(t[qPos])) qPos++;
    let cPos = attr.valueEnd - 2;
    while (/\s/.test(t[cPos])) cPos--;
    const q = t[qPos];
    contentStart = tag.start + qPos + 1;
    contentEnd = tag.start + cPos;
    replacement = escapeJsString(newClass, q);
  }
  return source.slice(0, contentStart) + replacement + source.slice(contentEnd);
}

// ---------------------------------------------------------------------------
// applyTextEdit
// ---------------------------------------------------------------------------

type StringLiteral = {
  start: number;
  end: number;
  /** Index of the first content character. */
  cStart: number;
  /** Index of the closing quote (exclusive end of content). */
  cEnd: number;
  quote: string;
  content: string;
};

/**
 * Every string literal in the source. Each quote character starts a candidate, so
 * an apostrophe in JSX text cannot hide a real literal that follows it.
 */
function findStringLiterals(src: string): StringLiteral[] {
  const out: StringLiteral[] = [];
  for (let i = 0; i < src.length; i++) {
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== "`") continue;
    let j = i + 1;
    let closed = -1;
    while (j < src.length) {
      const c = src[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === q) {
        closed = j;
        break;
      }
      if (q !== "`" && c === "\n") break;
      j++;
    }
    if (closed < 0) continue;
    const raw = src.slice(i + 1, closed);
    if (q === "`" && raw.includes("${")) continue;
    out.push({
      start: i,
      end: closed + 1,
      cStart: i + 1,
      cEnd: closed,
      quote: q,
      content: decodeJsString(raw),
    });
  }
  return out;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Step 1: JSX text directly inside the element. Returns the new source, or null if not found. */
function editJsxText(source: string, tag: TagLocation, oldText: string, newText: string): string | null {
  const want = norm(oldText);
  if (!want) return null;

  const ends: number[] = [];
  const closeIdx = source.indexOf(`</${tag.tag}`, tag.end);
  if (closeIdx >= 0) ends.push(closeIdx);
  const ltIdx = source.indexOf("<", tag.end);
  if (ltIdx >= 0) ends.push(ltIdx);
  const segEnd = ends.length ? Math.min(...ends) : source.length;

  const seg = source.slice(tag.end, segEnd);
  const core = seg.trim();
  if (!core || core.includes("{") || core.includes("}")) return null;
  if (norm(core) !== want) return null;

  const absStart = tag.end + (seg.length - seg.trimStart().length);
  const absEnd = absStart + core.length;
  const replacement = /[{}<>]/.test(newText) ? `{${JSON.stringify(newText)}}` : newText;
  return source.slice(0, absStart) + replacement + source.slice(absEnd);
}

function replaceLiteral(src: string, lit: StringLiteral, newText: string): string {
  return src.slice(0, lit.cStart) + escapeJsString(newText, lit.quote) + src.slice(lit.cEnd);
}

export function applyTextEdit(
  files: Record<string, string>,
  path: string,
  tag: TagLocation,
  oldText: string,
  newText: string,
): TextEditResult {
  const source = files[path];
  if (source === undefined) return { ok: false, reason: `File not found: ${path}` };
  if (oldText === newText) return { ok: true, path, content: source };

  // 1. JSX text inside the element.
  const jsx = editJsxText(source, tag, oldText, newText);
  if (jsx !== null) return { ok: true, path, content: jsx };

  // 2. String literal in the same file with exactly this content.
  const inFile = findStringLiterals(source).filter((l) => l.content === oldText);
  if (inFile.length === 1) {
    return { ok: true, path, content: replaceLiteral(source, inFile[0], newText) };
  }
  if (inFile.length > 1) return { ok: false, reason: AMBIGUOUS_REASON };

  // 3. String literal in any other source file.
  const matches: { file: string; lit: StringLiteral; content: string }[] = [];
  for (const other of Object.keys(files)) {
    if (other === path || !SOURCE_EXT.test(other)) continue;
    const otherSrc = files[other];
    for (const lit of findStringLiterals(otherSrc)) {
      if (lit.content === oldText) matches.push({ file: other, lit, content: otherSrc });
    }
  }
  if (matches.length === 1) {
    const m = matches[0];
    return { ok: true, path: m.file, content: replaceLiteral(m.content, m.lit, newText) };
  }
  if (matches.length > 1) return { ok: false, reason: AMBIGUOUS_REASON };

  return { ok: false, reason: NOT_COMPUTED_REASON };
}
