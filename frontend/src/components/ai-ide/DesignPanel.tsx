import { MousePointerClick, Redo2, Undo2 } from "lucide-react";
import { ElementInspector, type StyleTarget } from "./ElementInspector";
import { ThemeEditor } from "./ThemeEditor";
import { Button } from "@/components/ui/button";
import { serializeDesign, type DesignFile } from "@/lib/app-design";

/** What the preview reports about the element the user clicked. */
export type SelectedElement = {
  file: string;
  line: number;
  tag: string;
  className: string;
  text: string | null;
  /** How many elements this JSX line renders (list rows, shared components). */
  instances?: number;
  /** For an element inside a kit component: the page line that used the component. */
  usage?: { file: string; line: number; component: string } | null;
  /** The 3D icon id, when the element is a kit <Mark> image. */
  markId?: string | null;
  ancestors?: string[];
  style?: Record<string, string | number>;
};

/** The element as the preview reports it; anything malformed becomes null/defaults. */
export function parseSelection(data: Record<string, unknown>): SelectedElement | null {
  const file = typeof data.file === "string" && data.file ? data.file : null;
  if (!file) return null;
  const usage = data.usage as { file?: unknown; line?: unknown; component?: unknown } | null | undefined;
  return {
    file,
    line: Number(data.line) || 0,
    tag: String(data.tag ?? ""),
    className: String(data.className ?? ""),
    text: typeof data.text === "string" ? data.text : null,
    instances: Number(data.instances) || 1,
    usage:
      usage && typeof usage.file === "string" && usage.file
        ? { file: usage.file, line: Number(usage.line) || 0, component: String(usage.component ?? "Component") }
        : null,
    markId: typeof data.markId === "string" && data.markId ? data.markId : null,
    ancestors: Array.isArray(data.ancestors) ? data.ancestors.map(String) : [],
    style: data.style && typeof data.style === "object" ? (data.style as Record<string, string | number>) : {},
  };
}

const FONTS_START = "<!-- DESIGN_FONTS_START -->";
const FONTS_END = "<!-- DESIGN_FONTS_END -->";

/** tailwind.config.js that reads design.json; replaces an older template's config. */
export const TAILWIND_CONFIG_WITH_DESIGN = `import { readFileSync } from 'node:fs';

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
  } catch {
    return {};
  }
}

function mergeDeep(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const key of Object.keys(b)) out[key] = mergeDeep(out[key], b[key]);
  return out;
}

const kitTheme = readJson('./src/chronos/theme.json');
// design.json is written by the App Builder's design editor (colours, fonts, radius).
const design = readJson('./design.json');

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: mergeDeep(kitTheme, design?.tailwind?.theme?.extend ?? {}),
  },
  plugins: [],
};
`;

/** index.html with the design's font links between the markers (added before </head> if missing). */
export function withFontLinks(html: string, links: string[]): string {
  const block =
    FONTS_START +
    links.map((href) => `\n    <link rel="stylesheet" href="${href}" />`).join("") +
    (links.length ? "\n    " : "\n    ") +
    FONTS_END;
  const start = html.indexOf(FONTS_START);
  const end = html.indexOf(FONTS_END);
  if (start !== -1 && end > start) return html.slice(0, start) + block + html.slice(end + FONTS_END.length);
  const head = html.indexOf("</head>");
  if (head === -1) return html;
  return html.slice(0, head) + "    " + block + "\n  " + html.slice(head);
}

/** Every file a design change touches, given the current workspace files. */
export function designFileChanges(files: Record<string, string>, design: DesignFile): Record<string, string> {
  const changes: Record<string, string> = { "design.json": serializeDesign(design) };
  const config = files["tailwind.config.js"];
  if (config === undefined || !config.includes("design.json")) changes["tailwind.config.js"] = TAILWIND_CONFIG_WITH_DESIGN;
  const html = files["index.html"];
  if (html !== undefined) {
    const next = withFontLinks(html, design.fontLinks);
    if (next !== html) changes["index.html"] = next;
  }
  return changes;
}


/** Replace whatever class in `group` is present with `value` (or add it). */
export function swapClass(className: string, group: RegExp, value: string): string {
  const kept = className.split(/\s+/).filter((c) => c && !group.test(c));
  return [...kept, value].join(" ");
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-stroke-muted px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DesignPanel({
  files,
  selection,
  styleTarget,
  inspecting,
  onToggleInspect,
  onClearSelection,
  onSelectParent,
  onApplyFiles,
  onEditText,
  onEditClass,
  onSwapMark,
  onAskAi,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  files: Record<string, string>;
  selection: SelectedElement | null;
  styleTarget: StyleTarget | null;
  inspecting: boolean;
  onToggleInspect: () => void;
  onClearSelection: () => void;
  onSelectParent: () => void;
  onApplyFiles: (changes: Record<string, string>) => void;
  onEditText: (selection: SelectedElement, newText: string) => void;
  onEditClass: (target: StyleTarget, newClass: string) => void;
  onSwapMark: (selection: SelectedElement, newId: string) => void;
  onAskAi: (selection: SelectedElement, instruction: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto text-ink">
      <Section
        title="Visual edit"
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-stroke-muted text-ink-secondary hover:bg-raised disabled:opacity-40"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-stroke-muted text-ink-secondary hover:bg-raised disabled:opacity-40"
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
            <Button
              size="sm"
              variant={inspecting ? "default" : "outline"}
              className="h-7 gap-1.5 text-xs"
              onClick={onToggleInspect}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              {inspecting ? "Selecting…" : "Select"}
            </Button>
          </div>
        }
      >
        {!selection ? (
          <p className="text-xs leading-relaxed text-ink-tertiary">
            Turn on <span className="font-medium text-ink-secondary">Select</span>, then click anything in the preview to
            change its text, style or 3D icon. Double-click text to edit it in place. Every change can be undone.
          </p>
        ) : (
          <ElementInspector
            selection={selection}
            target={styleTarget}
            onClear={onClearSelection}
            onSelectParent={onSelectParent}
            onEditText={onEditText}
            onEditClass={onEditClass}
            onSwapMark={onSwapMark}
            onAskAi={onAskAi}
          />
        )}
      </Section>

      <ThemeEditor files={files} onApplyFiles={onApplyFiles} />
    </div>
  );
}
