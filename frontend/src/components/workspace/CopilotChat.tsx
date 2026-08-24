import { useState, useRef, useEffect } from "react";
import {
  Send, Loader2, Bot, User, FileCode, Globe,
  Wand2, MessageSquare, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AiIcon } from "@/lib/icons";
import { useWorkspaceContext } from "@/context/WorkspaceContext";
import { useSuggestCode, useAddComments, useExplainCode, useSuggestWorkspace } from "@/hooks/use-copilot";
import { toast } from "sonner";
import type { ChatMessage } from "@/lib/api";

// ─── Modes ─────────────────────────────────────────────────────────────────

type ChatMode = "smart" | "workspace";

const FILE_EXAMPLE_PROMPTS = [
  "Add input validation to this form",
  "Refactor this into smaller functions",
  "Add TypeScript types to all props",
  "Fix any potential null pointer issues",
];

const WORKSPACE_EXAMPLE_PROMPTS = [
  "Create a Smart Todos screen with list and form views, and add routing",
  "Add a user profile page with settings and avatar upload",
  "Create a dashboard with charts and a sidebar nav",
  "Add authentication login page, protected routes, and auth context",
  "Create a notifications screen with real-time badge counter",
];

// ─── Component ──────────────────────────────────────────────────────────────

export function CopilotChat() {
  const {
    workspace, openTabs, activeTab, chatHistory, addChatMessage,
    openDiff, openMultiDiff,
  } = useWorkspaceContext();

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("smart");
  const scrollRef = useRef<HTMLDivElement>(null);

  const suggestMutation = useSuggestCode();
  const commentsMutation = useAddComments();
  const explainMutation = useExplainCode();
  const workspaceMutation = useSuggestWorkspace();

  const activeTabObj = openTabs.find((t) => t.path === activeTab);
  const hasFile = !!activeTabObj;

  const isLoading =
    suggestMutation.isPending ||
    commentsMutation.isPending ||
    explainMutation.isPending ||
    workspaceMutation.isPending;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // ── Routing logic ──────────────────────────────────────────────────────
  // In "smart" mode: use file-level suggest when a file is open,
  // otherwise automatically fall through to workspace (multi-file) mode.
  const effectiveMode: "file" | "workspace" =
    mode === "workspace" || !hasFile ? "workspace" : "file";

  const canSend =
    !isLoading && !!workspace && !!input.trim();

  // ── Send ───────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!workspace) {
      toast.error("Connect a workspace first");
      return;
    }
    if (!input.trim()) return;

    const userMsg: ChatMessage = { role: "user", content: input };
    addChatMessage(userMsg);
    const currentInput = input;
    setInput("");

    try {
      if (effectiveMode === "file" && activeTabObj) {
        // ── Single-file: auto-detect intent ──
        const lower = currentInput.toLowerCase();
        const isCommentRequest =
          lower.includes("comment") || lower.includes("document") || lower.includes("jsdoc") || lower.includes("docstring");
        const isExplainRequest =
          lower.startsWith("what") || lower.startsWith("explain") || lower.startsWith("how does") || lower.startsWith("why");

        if (isCommentRequest) {
          const result = await commentsMutation.mutateAsync({
            workspace_id: workspace.workspace_id,
            file_path: activeTabObj.path,
            content: activeTabObj.content,
            language: activeTabObj.language,
          });
          addChatMessage({
            role: "assistant",
            content: `**Documentation added**\n\n${result.explanation}`,
          });
          openDiff(result, activeTabObj.path, activeTabObj.language);

        } else if (isExplainRequest) {
          const result = await explainMutation.mutateAsync({
            workspace_id: workspace.workspace_id,
            file_path: activeTabObj.path,
            content: activeTabObj.content,
            question: currentInput,
          });
          const keyPoints = result.key_points.map((p) => `• ${p}`).join("\n");
          addChatMessage({
            role: "assistant",
            content: `${result.explanation}\n\n${keyPoints}`,
          });

        } else {
          // Default: generate / suggest code for current file
          const result = await suggestMutation.mutateAsync({
            workspace_id: workspace.workspace_id,
            file_path: activeTabObj.path,
            content: activeTabObj.content,
            instruction: currentInput,
            history: chatHistory.slice(-10),
            language: activeTabObj.language,
          });
          addChatMessage({
            role: "assistant",
            content: `**${result.diff_summary}**\n\n${result.explanation}\n\nConfidence: ${Math.round(result.confidence * 100)}%`,
          });
          openDiff(result, activeTabObj.path, activeTabObj.language);
        }

      } else {
        // ── Workspace mode: generate / modify multiple files ──
        if (!hasFile && mode === "smart") {
          addChatMessage({
            role: "assistant",
            content: "No file selected generating across your workspace…",
          });
        }
        const result = await workspaceMutation.mutateAsync({
          workspace_id: workspace.workspace_id,
          instruction: currentInput,
          history: chatHistory.slice(-10),
        });

        const fileLines = result.files
          .map((f) => `${f.is_new ? "✦ NEW" : "  ✎"} \`${f.file_path}\` ${f.summary}`)
          .join("\n");

        addChatMessage({
          role: "assistant",
          content: `**${result.overall_summary}**\n\n${result.explanation}\n\n**Files changed (${result.files.length}):**\n${fileLines}`,
        });
        openMultiDiff(result);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Something went wrong";
      toast.error(msg);
      addChatMessage({ role: "assistant", content: `Error: ${msg}` });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertPrompt = (p: string) => setInput(p);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* ── Mode selector ── */}
      <div className="flex gap-1 p-2 border-b border-border/50 flex-shrink-0">
        <Button
          variant={mode === "smart" ? "default" : "ghost"}
          size="sm"
          className={cn("h-7 px-2 text-xs flex-1", mode !== "smart" && "text-muted-foreground")}
          onClick={() => setMode("smart")}
        >
          <Wand2 className="h-3 w-3 mr-1" />
          Smart
        </Button>
        <Button
          variant={mode === "workspace" ? "default" : "ghost"}
          size="sm"
          className={cn("h-7 px-2 text-xs flex-1", mode !== "workspace" && "text-muted-foreground")}
          onClick={() => setMode("workspace")}
        >
          <Globe className="h-3 w-3 mr-1" />
          Workspace
        </Button>
      </div>

      {/* ── Context badge ── */}
      <div className="px-3 py-1.5 bg-muted/30 border-b border-border/30 flex-shrink-0 flex items-center gap-2">
        {effectiveMode === "file" && activeTabObj ? (
          <>
            <FileCode className="h-3 w-3 text-muted-foreground" />
            <p className="text-[10px] text-muted-foreground truncate">
              <span className="text-foreground/70 font-medium">{activeTabObj.path.split("/").pop()}</span>
              <span className="text-muted-foreground/60"> editing this file</span>
            </p>
          </>
        ) : (
          <>
            <Globe className="h-3 w-3 text-sky-700" />
            <p className="text-[10px] text-sky-700/80">
              {mode === "smart" && !hasFile
                ? "No file open will generate new files as needed"
                : "Generating across entire repository"}
            </p>
          </>
        )}
      </div>

      {/* ── Chat messages ── */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="p-3 space-y-3">

          {chatHistory.length === 0 && (
            <div className="space-y-4 py-4">
              <div className="text-center space-y-1">
                <Bot className="h-8 w-8 mx-auto text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground font-medium">
                  {effectiveMode === "file"
                    ? "Ask anything about or modify the open file"
                    : "Describe what to build I'll create the files"}
                </p>
              </div>

              {/* Example prompts */}
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide px-1">
                  {effectiveMode === "file" ? "Try asking:" : "Examples:"}
                </p>
                {(effectiveMode === "file" ? FILE_EXAMPLE_PROMPTS : WORKSPACE_EXAMPLE_PROMPTS).map((p) => (
                  <button
                    key={p}
                    onClick={() => insertPrompt(p)}
                    className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground bg-muted/30 hover:bg-muted/60 rounded px-2 py-1.5 flex items-center gap-1.5 transition-colors"
                  >
                    <ChevronRight className="h-2.5 w-2.5 flex-shrink-0 text-primary/60" />
                    {p}
                  </button>
                ))}
              </div>

              {effectiveMode === "workspace" && (
                <div className="rounded-md bg-sky-50 border border-blue-500/20 p-2 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <AiIcon className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-medium text-sky-700">Multi-file generation</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    Creates new screens, updates routing, and wires everything together automatically.
                  </p>
                </div>
              )}
            </div>
          )}

          {chatHistory.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-xs",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground ml-auto"
                    : "bg-muted text-foreground"
                )}
              >
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
              {msg.role === "user" && (
                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-2">
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-xs text-muted-foreground">
                  {effectiveMode === "workspace"
                    ? "Generating files…"
                    : "Thinking…"}
                </span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── Input ── */}
      <div className="p-2 border-t border-border/50 flex-shrink-0 space-y-1.5">
        {/* Mode hint */}
        <div className="flex items-center gap-1.5 px-1">
          <MessageSquare className="h-2.5 w-2.5 text-muted-foreground/50" />
          <span className="text-[9px] text-muted-foreground/50">
            {effectiveMode === "file"
              ? "Modifying current file · Switch to Workspace for multi-file generation"
              : "Workspace mode · Can create new screens, routes, and components"}
          </span>
        </div>

        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              effectiveMode === "file"
                ? "Describe what to change in this file…"
                : "e.g. Create a Smart Todos screen with a list view and form, add routing…"
            }
            className="min-h-[60px] max-h-[120px] resize-none text-xs"
            disabled={isLoading || !workspace}
          />
          <Button
            size="sm"
            className="self-end h-9 w-9 p-0"
            onClick={handleSend}
            disabled={!canSend}
          >
            {isLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />}
          </Button>
        </div>

        {!workspace && (
          <p className="text-[10px] text-[var(--color-warning)] px-1">Connect a repository to start chatting</p>
        )}
      </div>
    </div>
  );
}
