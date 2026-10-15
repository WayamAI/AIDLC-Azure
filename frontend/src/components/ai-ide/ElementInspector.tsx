import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpLeft,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Info,
  Loader2,
  Search,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CONTROL_OPTIONS,
  PALETTE_FAMILIES,
  SEMANTIC_BG_COLORS,
  SEMANTIC_BORDER_COLORS,
  SEMANTIC_TEXT_COLORS,
  paletteClass,
  readControl,
  setControl,
  type Control,
} from "@/lib/tw-classes";
import type { SelectedElement } from "./DesignPanel";

/** Where style edits for the selection are written. */
export type StyleTarget = {
  file: string;
  line: number;
  /** JSX tag name at that line: a DOM tag, or the kit component used there. */
  tag: string;
  /** The literal className there; null when it is computed in code and cannot be edited directly. */
  className: string | null;
  /** True when the target is a kit component instance on a page rather than the DOM element itself. */
  isInstance: boolean;
};

type MarkRow = { id: string; hint: string; category: string };

function Group({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-stroke-muted pt-2.5">
      <button
        type="button"
        className="mb-2 flex w-full items-center gap-1 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary hover:text-ink-secondary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="space-y-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 flex-shrink-0 text-[11px] text-ink-tertiary">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Radix Select cannot take an empty-string item value, so "none" options use this sentinel. */
const NONE_VALUE = "__none__";

/** A compact stepper over a control's ordered options (−/+ with the current value). */
function Stepper({
  control,
  className,
  onChange,
  none = "—",
}: {
  control: Control;
  className: string;
  onChange: (value: string | null) => void;
  none?: string;
}) {
  const options = CONTROL_OPTIONS[control] ?? [];
  const current = readControl(className, control);
  const index = current ? options.indexOf(current) : -1;
  const step = (delta: number) => {
    const next = index === -1 ? (delta > 0 ? 0 : options.length - 1) : Math.min(options.length - 1, Math.max(0, index + delta));
    onChange(options[next] ?? null);
  };
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="h-6 w-6 rounded border border-stroke-muted text-xs hover:bg-raised" onClick={() => step(-1)} aria-label={`Decrease ${control}`}>
        −
      </button>
      <Select value={current ?? NONE_VALUE} onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}>
        <SelectTrigger
          className="h-6 min-w-0 flex-1 rounded border border-stroke-muted bg-container px-1 font-mono text-[11px] text-ink"
          aria-label={control}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          <SelectItem value={NONE_VALUE} className="py-1 pl-2 font-mono text-[11px]">
            {none}
          </SelectItem>
          {current && index === -1 && (
            <SelectItem value={current} className="py-1 pl-2 font-mono text-[11px]">
              {current}
            </SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o} value={o} className="py-1 pl-2 font-mono text-[11px]">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button type="button" className="h-6 w-6 rounded border border-stroke-muted text-xs hover:bg-raised" onClick={() => step(1)} aria-label={`Increase ${control}`}>
        +
      </button>
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: React.ReactNode; title: string }>;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-stroke-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(value === o.value ? null : o.value)}
          className={cn(
            "flex h-6 min-w-[28px] items-center justify-center rounded px-1.5 text-[11px] transition-colors",
            value === o.value ? "bg-raised text-ink" : "text-ink-tertiary hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Semantic swatches first, then a palette row (family at 500) for anything else. */
function Swatches({
  prefix,
  semantic,
  className,
  control,
  onChange,
}: {
  prefix: "text" | "bg" | "border";
  semantic: Array<{ label: string; cls: string; swatch: string }>;
  className: string;
  control: Control;
  onChange: (value: string | null) => void;
}) {
  const current = readControl(className, control);
  const [family, setFamily] = useState<string>("");
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          title="None"
          onClick={() => onChange(null)}
          className={cn(
            "h-5 w-5 rounded-full border border-stroke-muted bg-[linear-gradient(135deg,transparent_45%,currentColor_45%,currentColor_55%,transparent_55%)] text-ink-quaternary",
            current === null && "ring-2 ring-stroke",
          )}
        />
        {semantic.map((c) => (
          <button
            key={c.cls}
            type="button"
            title={`${c.label} (${c.cls})`}
            onClick={() => onChange(c.cls)}
            className={cn("h-5 w-5 rounded-full border border-stroke-muted", current === c.cls && "ring-2 ring-stroke ring-offset-1")}
            style={{ background: c.swatch }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Select
          value={family || NONE_VALUE}
          onValueChange={(v) => {
            const next = v === NONE_VALUE ? "" : v;
            setFamily(next);
            if (next) onChange(paletteClass(prefix, next, 500));
          }}
        >
          <SelectTrigger
            className="h-6 flex-1 rounded border border-stroke-muted bg-container px-1 text-[11px] text-ink"
            aria-label={`${prefix} palette colour`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value={NONE_VALUE} className="py-1 pl-2 text-[11px]">
              Palette colour…
            </SelectItem>
            {PALETTE_FAMILIES.map((f) => (
              <SelectItem key={f} value={f} className="py-1 pl-2 text-[11px]">
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {family && (
          <Select defaultValue="500" onValueChange={(v) => onChange(paletteClass(prefix, family, Number(v)))}>
            <SelectTrigger className="h-6 w-16 rounded border border-stroke-muted bg-container px-1 text-[11px] text-ink" aria-label="Shade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => (
                <SelectItem key={n} value={String(n)} className="py-1 pl-2 text-[11px]">
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {current && <code className="block truncate font-mono text-[10px] text-ink-quaternary">{current}</code>}
    </div>
  );
}

function IconPicker({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ai-ide-marks", debounced],
    queryFn: async () =>
      (await apiClient.get<{ marks: MarkRow[]; total: number }>("/ai-ide/marks", { params: { q: debounced, limit: 60 } })).data,
    staleTime: 60_000,
  });
  const rows = Array.isArray(data?.marks) ? data.marks : [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <img src={`/marks/${current}.png`} alt="" className="h-12 w-12 rounded-md border border-stroke-muted bg-raised object-contain p-1" />
        <div className="min-w-0">
          <code className="block truncate font-mono text-[11px] text-ink-secondary">{current}</code>
          <span className="text-[11px] text-ink-tertiary">{data?.total ? `${data.total} icons in the library` : "3D icon library"}</span>
        </div>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-quaternary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons (e.g. calendar, money, guest)"
          className="h-7 w-full rounded-md border border-stroke-muted bg-container pl-7 pr-2 text-xs text-ink outline-none focus:border-stroke"
          aria-label="Search icons"
        />
      </div>
      {isLoading ? (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-tertiary">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading icons…
        </p>
      ) : isError ? (
        <p className="text-[11px] text-destructive">Could not load the icon library.</p>
      ) : (
        <div className="grid max-h-56 grid-cols-5 gap-1 overflow-y-auto pr-1">
          {rows.map((m) => (
            <button
              key={m.id}
              type="button"
              title={`${m.hint || m.id} (${m.id})`}
              onClick={() => onPick(m.id)}
              className={cn(
                "aspect-square rounded-md border p-1 transition-colors hover:bg-raised",
                m.id === current ? "border-stroke bg-raised" : "border-transparent",
              )}
            >
              <img src={`/marks/${m.id}.png`} alt={m.hint || m.id} loading="lazy" className="h-full w-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ElementInspector({
  selection,
  target,
  onClear,
  onSelectParent,
  onEditText,
  onEditClass,
  onSwapMark,
  onAskAi,
}: {
  selection: SelectedElement;
  target: StyleTarget | null;
  onClear: () => void;
  onSelectParent: () => void;
  onEditText: (selection: SelectedElement, newText: string) => void;
  onEditClass: (target: StyleTarget, newClass: string) => void;
  onSwapMark: (selection: SelectedElement, newId: string) => void;
  onAskAi: (selection: SelectedElement, instruction: string) => void;
}) {
  const [textDraft, setTextDraft] = useState(selection.text ?? "");
  const [classDraft, setClassDraft] = useState(target?.className ?? "");
  const [askDraft, setAskDraft] = useState("");
  useEffect(() => setTextDraft(selection.text ?? ""), [selection]);
  useEffect(() => setClassDraft(target?.className ?? ""), [target]);

  const editable = target !== null && target.className !== null;
  const cls = classDraft;
  const apply = (control: Control, value: string | null) => {
    if (!target || target.className === null) return;
    const next = setControl(cls, control, value);
    setClassDraft(next);
    onEditClass(target, next);
  };

  const crumbs = useMemo(() => [...(selection.ancestors ?? [])].slice(0, 4).reverse(), [selection]);
  const fileName = (path: string) => path.split("/").pop();

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-ink-tertiary">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c}
                <ChevronRight className="h-3 w-3" />
              </span>
            ))}
            <span className="rounded bg-raised px-1 text-ink">{target?.isInstance ? `<${target.tag}>` : selection.tag}</span>
          </div>
          <code className="mt-0.5 block truncate font-mono text-[10px] text-ink-quaternary" title={`${target?.file ?? selection.file}:${target?.line ?? selection.line}`}>
            {fileName(target?.file ?? selection.file)}:{target?.line ?? selection.line}
          </code>
        </div>
        <div className="flex flex-shrink-0 gap-1">
          <button type="button" onClick={onSelectParent} className="flex h-6 w-6 items-center justify-center rounded border border-stroke-muted hover:bg-raised" title="Select parent element" aria-label="Select parent element">
            <ArrowUpLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onClear} className="flex h-6 w-6 items-center justify-center rounded border border-stroke-muted hover:bg-raised" title="Clear selection" aria-label="Clear selection">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {(target?.isInstance || (selection.instances ?? 1) > 1) && (
        <p className="flex gap-1.5 rounded-md border border-stroke-muted bg-raised px-2 py-1.5 text-[11px] leading-relaxed text-ink-secondary">
          <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
          {target?.isInstance
            ? `This is inside the kit's ${target.tag} used on ${fileName(target.file)}. Style changes apply to that ${target.tag} only.`
            : `This code renders ${selection.instances} elements (a list or a shared component); changes apply to all of them.`}
        </p>
      )}

      {selection.text !== null && (
        <Group title="Content">
          <div className="flex items-start gap-1.5">
            <Type className="mt-1.5 h-3.5 w-3.5 flex-shrink-0 text-ink-tertiary" />
            <Textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} className="min-h-[52px] resize-y text-xs" aria-label="Text" />
          </div>
          <Button size="sm" className="h-7 text-xs" disabled={textDraft === selection.text} onClick={() => onEditText(selection, textDraft)}>
            Apply text
          </Button>
          <p className="text-[10px] text-ink-quaternary">Tip: double-click text in the preview to edit it in place.</p>
        </Group>
      )}

      {selection.markId && (
        <Group title="3D icon">
          <IconPicker current={selection.markId} onPick={(id) => onSwapMark(selection, id)} />
        </Group>
      )}

      {!editable ? (
        <p className="rounded-md border border-stroke-muted bg-raised px-2 py-1.5 text-[11px] text-ink-secondary">
          This element's classes are computed in code, so they can't be edited here. Use Ask AI below.
        </p>
      ) : (
        <>
          <Group title="Typography">
            <Row label="Size">
              <Stepper control="fontSize" className={cls} onChange={(v) => apply("fontSize", v)} none="inherit" />
            </Row>
            <Row label="Weight">
              <Stepper control="fontWeight" className={cls} onChange={(v) => apply("fontWeight", v)} none="inherit" />
            </Row>
            <Row label="Font">
              <Segmented
                value={readControl(cls, "fontFamily")}
                onChange={(v) => apply("fontFamily", v)}
                options={[
                  { value: "font-sans", label: "Sans", title: "Body font" },
                  { value: "font-display", label: "Display", title: "Display font (titles, figures)" },
                  { value: "font-mono", label: "Mono", title: "Monospace" },
                ]}
              />
            </Row>
            <Row label="Align">
              <Segmented
                value={readControl(cls, "textAlign")}
                onChange={(v) => apply("textAlign", v)}
                options={[
                  { value: "text-left", label: <AlignLeft className="h-3.5 w-3.5" />, title: "Left" },
                  { value: "text-center", label: <AlignCenter className="h-3.5 w-3.5" />, title: "Center" },
                  { value: "text-right", label: <AlignRight className="h-3.5 w-3.5" />, title: "Right" },
                ]}
              />
            </Row>
            <Row label="Colour">
              <Swatches prefix="text" control="textColor" semantic={SEMANTIC_TEXT_COLORS} className={cls} onChange={(v) => apply("textColor", v)} />
            </Row>
          </Group>

          <Group title="Fill & border">
            <Row label="Fill">
              <Swatches prefix="bg" control="bgColor" semantic={SEMANTIC_BG_COLORS} className={cls} onChange={(v) => apply("bgColor", v)} />
            </Row>
            <Row label="Radius">
              <Stepper control="radius" className={cls} onChange={(v) => apply("radius", v)} />
            </Row>
            <Row label="Border">
              <Stepper control="borderWidth" className={cls} onChange={(v) => apply("borderWidth", v)} />
            </Row>
            <Row label="Stroke">
              <Swatches prefix="border" control="borderColor" semantic={SEMANTIC_BORDER_COLORS} className={cls} onChange={(v) => apply("borderColor", v)} />
            </Row>
          </Group>

          <Group title="Spacing & layout" defaultOpen={false}>
            <Row label="Padding">
              <Stepper control="padding" className={cls} onChange={(v) => apply("padding", v)} />
            </Row>
            <Row label="Pad X">
              <Stepper control="paddingX" className={cls} onChange={(v) => apply("paddingX", v)} />
            </Row>
            <Row label="Pad Y">
              <Stepper control="paddingY" className={cls} onChange={(v) => apply("paddingY", v)} />
            </Row>
            <Row label="Margin">
              <Stepper control="margin" className={cls} onChange={(v) => apply("margin", v)} />
            </Row>
            <Row label="Gap">
              <Stepper control="gap" className={cls} onChange={(v) => apply("gap", v)} />
            </Row>
            <Row label="Display">
              <Stepper control="display" className={cls} onChange={(v) => apply("display", v)} />
            </Row>
            <Row label="Opacity">
              <Stepper control="opacity" className={cls} onChange={(v) => apply("opacity", v)} />
            </Row>
          </Group>

          <Group title="Classes" defaultOpen={false}>
            <Textarea
              value={classDraft}
              onChange={(e) => setClassDraft(e.target.value)}
              className="min-h-[64px] resize-y font-mono text-[11px]"
              spellCheck={false}
              aria-label="Classes"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!target || classDraft === (target.className ?? "")}
              onClick={() => target && onEditClass(target, classDraft)}
            >
              Apply classes
            </Button>
          </Group>
        </>
      )}

      <Group title="Ask AI">
        <Textarea
          value={askDraft}
          onChange={(e) => setAskDraft(e.target.value)}
          placeholder={selection.markId ? "e.g. use a calendar icon and make it larger" : "e.g. make this a pill button with an arrow icon"}
          className="min-h-[52px] resize-y text-xs"
          aria-label="Ask AI to change this element"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          disabled={!askDraft.trim()}
          onClick={() => {
            onAskAi(selection, askDraft.trim());
            setAskDraft("");
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Ask AI
        </Button>
      </Group>
      {!selection.markId && selection.tag === "img" && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-tertiary">
          <ImageIcon className="h-3 w-3" /> This image is not from the 3D library; ask the AI to replace it.
        </p>
      )}
    </div>
  );
}
