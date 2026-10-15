import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Monitor,
  Moon,
  MousePointerClick,
  Sun,
  RefreshCw,
  Smartphone,
  Tablet,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import runtimeSource from "./preview-runtime.js?raw";
import { parseSelection, type SelectedElement } from "./DesignPanel";

const SOURCE = "chakram-preview";

export type PreviewEntry = {
  id: number;
  kind: "error" | "console";
  level: "error" | "warn" | "info" | "log" | "debug";
  stage?: string;
  message: string;
  path: string | null;
};

export type PreviewBuildState =
  | { phase: "loading" }
  | { phase: "building" }
  | { phase: "ready"; modules: number; ms: number }
  | { phase: "error"; message: string; path: string | null; stage: string };

type Viewport = "desktop" | "tablet" | "mobile";
const VIEWPORT_WIDTH: Record<Viewport, string> = { desktop: "100%", tablet: "820px", mobile: "400px" };

/** The sandboxed document the preview runs in; built once, files arrive by postMessage. */
export function buildPreviewDocument(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chakram preview</title>
  <script>tailwind = { config: { darkMode: "class" } };</script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body, #root { height: 100%; margin: 0; }
    body { background: #0a0a0a; color: #f5f5f5; font-family: ui-sans-serif, system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
${runtimeSource.replace(/<\/script/gi, "<\\/script")}
  </script>
</body>
</html>`;
}

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Files the preview compiles (pending ones are stood in for) and a key that changes when they do. */
export function previewPayload(files: Record<string, string>, pending: string[]) {
  const pendingSet = new Set(pending);
  const sent: Record<string, string> = {};
  const parts: string[] = [];
  for (const path of Object.keys(files).sort()) {
    if (pendingSet.has(path)) continue;
    const content = files[path] ?? "";
    sent[path] = content;
    parts.push(`${path}\u0000${content.length}\u0000${hashText(content)}`);
  }
  parts.push(`pending:${[...pendingSet].sort().join(",")}`);
  return { files: sent, pending: [...pendingSet], key: parts.join("\n") };
}

export function AiIdePreview({
  files,
  pending,
  generating,
  onOpenFile,
  onFixRequest,
  inspecting = false,
  onInspectChange,
  selection = null,
  onSelect,
  onTextEdit,
  onBuildError,
}: {
  files: Record<string, string>;
  /** Visual editing: clicks select elements instead of using the app. */
  inspecting?: boolean;
  onInspectChange?: (on: boolean) => void;
  selection?: SelectedElement | null;
  onSelect?: (selection: SelectedElement | null) => void;
  onTextEdit?: (selection: SelectedElement, oldText: string, newText: string) => void;
  /** A compile, import or render failure in a known file (used for automatic repair). */
  onBuildError?: (error: { path: string; message: string; stage: string }) => void;
  /** Planned files that have not been written yet: rendered as placeholders. */
  pending: string[];
  generating: boolean;
  onOpenFile?: (path: string) => void;
  onFixRequest?: (path: string, message: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const lastKeyRef = useRef<string | null>(null);
  const nonceRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryIdRef = useRef(0);

  const [reloadNonce, setReloadNonce] = useState(0);
  const [build, setBuild] = useState<PreviewBuildState>({ phase: "loading" });
  const [route, setRoute] = useState("/");
  const [routeDraft, setRouteDraft] = useState("/");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [entries, setEntries] = useState<PreviewEntry[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  /** Preview-only colour mode; null follows the app's default from design.json. */
  const [mode, setMode] = useState<"light" | "dark" | null>(null);

  // The document is served from a blob URL rather than srcdoc so the app has a real URL:
  // hash routing (the preview's stand-in for history routing) needs one.
  const documentUrl = useMemo(() => URL.createObjectURL(new Blob([buildPreviewDocument()], { type: "text/html" })), []);
  useEffect(() => () => URL.revokeObjectURL(documentUrl), [documentUrl]);
  const payload = useMemo(() => previewPayload(files, pending), [files, pending]);

  const pushEntry = useCallback((entry: Omit<PreviewEntry, "id">) => {
    entryIdRef.current += 1;
    const id = entryIdRef.current;
    setEntries((prev) => [...prev.slice(-199), { ...entry, id }]);
  }, []);

  const send = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame || !readyRef.current) return;
    nonceRef.current += 1;
    lastKeyRef.current = payload.key;
    frame.postMessage(
      {
        target: SOURCE,
        type: "update",
        files: payload.files,
        pending: payload.pending,
        nonce: nonceRef.current,
        // The kit's <Mark> loads 3D icons from Chakram while previewing; a downloaded app ships its own copies.
        env: { VITE_MARKS_BASE: `${window.location.origin}/marks` },
      },
      "*",
    );
  }, [payload]);

  // Files change on every keystroke and on every streamed token; the preview rebuilds a
  // moment after they settle, and only when something it compiles has changed.
  useEffect(() => {
    if (!readyRef.current || payload.key === lastKeyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      send();
    }, 350);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [payload, send]);

  const postToFrame = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ target: SOURCE, ...message }, "*");
  }, []);

  useEffect(() => {
    if (readyRef.current) postToFrame({ type: "inspect", on: inspecting });
  }, [inspecting, postToFrame]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (type === "select-parent" || type === "select-clear") postToFrame({ type });
    };
    window.addEventListener("ai-ide-preview-command", onCommand);
    return () => window.removeEventListener("ai-ide-preview-command", onCommand);
  }, [postToFrame]);

  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const callbacksRef = useRef({ onSelect, onTextEdit, onBuildError });
  callbacksRef.current = { onSelect, onTextEdit, onBuildError };
  const inspectingRef = useRef(inspecting);
  inspectingRef.current = inspecting;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.source !== SOURCE) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      switch (data.type) {
        case "ready":
          readyRef.current = true;
          lastKeyRef.current = null;
          send();
          postToFrame({ type: "inspect", on: inspectingRef.current });
          postToFrame({ type: "preview-mode", mode: modeRef.current });
          break;
        case "select":
          callbacksRef.current.onSelect?.(parseSelection(data));
          break;
        case "text-edit": {
          const file = typeof data.file === "string" ? data.file : "";
          if (!file) break;
          const sel = parseSelection(data);
          if (sel) callbacksRef.current.onTextEdit?.({ ...sel, text: String(data.oldText ?? "") }, String(data.oldText ?? ""), String(data.newText ?? ""));
          break;
        }
        case "building":
          setBuild({ phase: "building" });
          break;
        case "built":
          setBuild({ phase: "ready", modules: Number(data.modules) || 0, ms: Number(data.ms) || 0 });
          // The edited element is a new DOM node after a rebuild: find it again.
          if (selectionRef.current) postToFrame({ type: "reselect", info: selectionRef.current });
          if (typeof data.route === "string") {
            setRoute(data.route);
            setRouteDraft(data.route);
          }
          break;
        case "route":
          if (typeof data.route === "string" || typeof data.path === "string") {
            const next = String(data.path ?? data.route);
            setRoute(next);
            setRouteDraft(next);
          }
          break;
        case "error": {
          const message = String(data.message ?? "Unknown error");
          const path = typeof data.path === "string" ? data.path : null;
          const stage = String(data.stage ?? "runtime");
          // A build that fails is reported as the preview's state; a runtime error while the
          // app is otherwise running goes to the console so the page stays visible.
          if (stage === "compile" || stage === "import" || stage === "runtime-load" || stage === "render") {
            setBuild({ phase: "error", message, path, stage });
            if (path && stage !== "runtime-load") callbacksRef.current.onBuildError?.({ path, message, stage });
          }
          pushEntry({ kind: "error", level: "error", stage, message, path });
          setConsoleOpen(true);
          break;
        }
        case "console": {
          const level = String(data.level ?? "log") as PreviewEntry["level"];
          pushEntry({ kind: "console", level, message: String(data.text ?? ""), path: null });
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send, pushEntry, postToFrame]);

  const reload = () => {
    readyRef.current = false;
    lastKeyRef.current = null;
    setEntries([]);
    setBuild({ phase: "loading" });
    setReloadNonce((n) => n + 1);
  };

  const navigate = (path: string) => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame || !readyRef.current) return;
    frame.postMessage({ target: SOURCE, type: "navigate", path }, "*");
  };

  const errorCount = entries.filter((e) => e.kind === "error").length;
  const pendingCount = payload.pending.length;

  const statusText =
    build.phase === "loading"
      ? "Loading preview runtime…"
      : build.phase === "building"
        ? "Building…"
        : build.phase === "ready"
          ? `Ready · ${build.modules} module${build.modules === 1 ? "" : "s"} · ${build.ms} ms`
          : "Build failed";

  return (
    <div className="absolute inset-0 flex flex-col bg-container">
      <div className="flex h-9 flex-shrink-0 items-center gap-2 border-b border-stroke-muted bg-raised px-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={reload}
          title="Reload the preview"
          aria-label="Reload the preview"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(routeDraft.trim() || "/");
          }}
        >
          <input
            value={routeDraft}
            onChange={(e) => setRouteDraft(e.target.value)}
            onBlur={() => setRouteDraft(route)}
            aria-label="Route"
            spellCheck={false}
            className="h-7 w-full min-w-0 rounded-md border border-stroke-muted bg-container px-2 font-mono text-xs text-ink outline-none focus:border-stroke"
          />
        </form>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => {
            const next = mode === "dark" ? "light" : "dark";
            setMode(next);
            postToFrame({ type: "preview-mode", mode: next });
          }}
          title={mode === "dark" ? "Preview in light mode" : "Preview in dark mode"}
          aria-label="Toggle preview colour mode"
        >
          {mode === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
        {onInspectChange && (
          <Button
            variant={inspecting ? "default" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => onInspectChange(!inspecting)}
            title="Click elements in the preview to edit their text and style"
            aria-pressed={inspecting}
          >
            <MousePointerClick className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">{inspecting ? "Selecting" : "Edit"}</span>
          </Button>
        )}
        <div className="hidden items-center rounded-md border border-stroke-muted bg-container p-0.5 sm:flex">
          {(
            [
              ["desktop", Monitor, "Desktop width"],
              ["tablet", Tablet, "Tablet width"],
              ["mobile", Smartphone, "Phone width"],
            ] as Array<[Viewport, typeof Monitor, string]>
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={viewport === key}
              onClick={() => setViewport(key)}
              className={cn(
                "flex h-6 w-7 items-center justify-center rounded transition-colors",
                viewport === key ? "bg-raised text-ink" : "text-muted-foreground hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <span
          className={cn(
            "flex max-w-[260px] items-center gap-1.5 truncate text-xs",
            build.phase === "error" ? "text-destructive" : "text-ink-tertiary",
          )}
          title={statusText}
        >
          {(build.phase === "loading" || build.phase === "building") && <Loader2 className="h-3 w-3 animate-spin" />}
          {build.phase === "error" && <AlertCircle className="h-3 w-3" />}
          <span className="truncate">{statusText}</span>
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1 justify-center overflow-hidden bg-raised">
        <div
          className="relative h-full max-w-full bg-container transition-[width] duration-200"
          style={{ width: VIEWPORT_WIDTH[viewport] }}
        >
          <iframe
            key={reloadNonce}
            ref={iframeRef}
            title="In-app preview"
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            className="h-full w-full border-0 bg-container"
            src={documentUrl}
          />
          {build.phase === "error" && (
            <div
              role="alert"
              className="absolute inset-x-0 bottom-0 max-h-[60%] overflow-y-auto border-t border-stroke-muted bg-container/95 p-4 backdrop-blur"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-sm font-medium text-ink">
                    {build.stage === "compile"
                      ? "The app could not be compiled"
                      : build.stage === "import"
                        ? "A module failed to load"
                        : build.stage === "render"
                          ? "The app crashed while rendering"
                          : "The preview could not start"}
                    {build.path && (
                      <>
                        {" "}
                        in <code className="font-mono text-xs">{build.path}</code>
                      </>
                    )}
                  </p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-secondary">
                    {build.message}
                  </pre>
                  {build.path && (
                    <div className="flex flex-wrap gap-2">
                      {onOpenFile && (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onOpenFile(build.path as string)}>
                          Open file
                        </Button>
                      )}
                      {onFixRequest && (
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => onFixRequest(build.path as string, build.message)}
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Fix with AI
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {build.phase === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-container text-xs text-ink-tertiary">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Starting the preview…
            </div>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-stroke-muted bg-raised">
        <div className="flex h-8 items-center gap-2 px-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-ink-secondary hover:text-ink"
            onClick={() => setConsoleOpen((o) => !o)}
            aria-expanded={consoleOpen}
          >
            {consoleOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            <span className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Console</span>
            {errorCount > 0 && (
              <span className="rounded-full border border-stroke-muted bg-container px-1.5 text-[10px] text-destructive">
                {errorCount} error{errorCount === 1 ? "" : "s"}
              </span>
            )}
            {errorCount === 0 && entries.length > 0 && (
              <span className="text-[10px] tabular-nums text-ink-quaternary">{entries.length}</span>
            )}
          </button>
          {generating && pendingCount > 0 && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-tertiary">
              <Loader2 className="h-3 w-3 animate-spin" />
              {pendingCount} file{pendingCount === 1 ? "" : "s"} still generating
            </span>
          )}
          {entries.length > 0 && (
            <button
              type="button"
              className={cn("flex items-center gap-1 text-xs text-ink-tertiary hover:text-ink", !(generating && pendingCount > 0) && "ml-auto")}
              onClick={() => setEntries([])}
              title="Clear console"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {consoleOpen && (
          <div className="max-h-40 overflow-y-auto border-t border-stroke-muted px-3 py-2 font-mono text-[11px] leading-relaxed">
            {entries.length === 0 ? (
              <p className="font-sans text-xs text-ink-tertiary">Nothing logged yet.</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 py-0.5">
                  <span
                    className={cn(
                      "w-12 flex-shrink-0 uppercase",
                      entry.level === "error" ? "text-destructive" : entry.level === "warn" ? "text-warning" : "text-ink-quaternary",
                    )}
                  >
                    {entry.kind === "error" ? entry.stage || "error" : entry.level}
                  </span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink-secondary">{entry.message}</span>
                  {entry.path && (
                    <span className="flex flex-shrink-0 items-center gap-2">
                      {onOpenFile && (
                        <button type="button" className="text-primary hover:underline" onClick={() => onOpenFile(entry.path as string)}>
                          {entry.path.split("/").pop()}
                        </button>
                      )}
                      {onFixRequest && (
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => onFixRequest(entry.path as string, entry.message)}
                        >
                          Fix with AI
                        </button>
                      )}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
