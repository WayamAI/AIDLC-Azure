import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Github, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error";
import { Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { useAskDialog } from "@/components/ui/ask-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface AppSummary {
  workspace_id: string;
  name: string | null;
  idea: string | null;
  status: "generating" | "done" | "error" | null;
  file_count: number;
  repo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface AppsResponse {
  apps: AppSummary[];
}

const QUERY_KEY = ["ai-ide-apps"] as const;
const SEARCH_THRESHOLD = 6;
const FALLBACK_NAME_LENGTH = 60;

const STATUS_BADGE: Record<NonNullable<AppSummary["status"]>, { tone: StatusTone; label: string }> = {
  generating: { tone: "info", label: "Generating" },
  done: { tone: "success", label: "Ready" },
  error: { tone: "critical", label: "Incomplete" },
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayName(app: AppSummary): string {
  const name = app.name?.trim();
  if (name) return name;
  const idea = app.idea?.trim();
  if (idea) return idea.slice(0, FALLBACK_NAME_LENGTH);
  return "Untitled app";
}

function updatedLabel(app: AppSummary): string | null {
  const date = parseDate(app.updated_at) ?? parseDate(app.created_at);
  if (!date) return null;
  return `Updated ${formatDistanceToNow(date, { addSuffix: true })}`;
}

function isSafeHttpUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function AppLibrary({
  onOpen,
  currentWorkspaceId,
}: {
  onOpen: (app: { workspace_id: string; idea: string | null; name: string | null }) => void;
  currentWorkspaceId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { dialog, confirm } = useAskDialog();
  const [search, setSearch] = useState("");

  const apps = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data } = await apiClient.get<AppsResponse>("/ai-ide/workspaces");
      return data.apps ?? [];
    },
  });

  const remove = useMutation({
    mutationFn: (workspaceId: string) => apiClient.delete(`/ai-ide/workspace/${workspaceId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("App deleted");
    },
    onError: (error) => {
      toast.error(`Could not delete app: ${apiErrorMessage(error, "try again")}`);
    },
  });

  const all = apps.data ?? [];
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!needle) return all;
    return all.filter(
      (app) =>
        (app.name ?? "").toLowerCase().includes(needle) || (app.idea ?? "").toLowerCase().includes(needle),
    );
  }, [all, needle]);

  async function handleDelete(app: AppSummary) {
    const ok = await confirm({
      title: `Delete ${displayName(app)}?`,
      description: "This permanently deletes the app and its saved workspace. It cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(app.workspace_id);
  }

  return (
    <Panel>
      {dialog}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
            Your apps{apps.data ? ` (${all.length})` : ""}
          </h2>
          {all.length > SEARCH_THRESHOLD && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-quaternary" aria-hidden />
              <Input
                type="search"
                aria-label="Search apps"
                placeholder="Search apps"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}
        </div>

        {apps.isPending && (
          <p role="status" className="flex items-center gap-2 text-xs text-ink-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Loading your apps...
          </p>
        )}

        {apps.isError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-stroke-muted px-3 py-2">
            <p className="text-sm text-destructive">Could not load your apps: {apiErrorMessage(apps.error, "try again")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void apps.refetch()} disabled={apps.isFetching}>
              Retry
            </Button>
          </div>
        )}

        {apps.isSuccess && all.length === 0 && (
          <EmptyState kind="noRuns" compact>
            No apps yet. Describe one above to build your first app.
          </EmptyState>
        )}

        {apps.isSuccess && all.length > 0 && visible.length === 0 && (
          <p className="text-sm text-ink-tertiary">No apps match &ldquo;{search.trim()}&rdquo;.</p>
        )}

        {visible.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((app) => (
              <AppCard
                key={app.workspace_id}
                app={app}
                current={app.workspace_id === currentWorkspaceId}
                deleting={remove.isPending && remove.variables === app.workspace_id}
                onOpen={() => onOpen({ workspace_id: app.workspace_id, idea: app.idea, name: app.name })}
                onDelete={() => void handleDelete(app)}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function AppCard({
  app,
  current,
  deleting,
  onOpen,
  onDelete,
}: {
  app: AppSummary;
  current: boolean;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const title = displayName(app);
  const badge = app.status ? STATUS_BADGE[app.status] : null;
  const updated = updatedLabel(app);
  const idea = app.idea?.trim() ?? "";

  return (
    <li
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border bg-raised p-4",
        current ? "border-stroke-active ring-1 ring-stroke-active" : "border-stroke-muted",
        deleting && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 title={title} className="min-w-0 truncate font-sans text-sm font-medium text-ink">
          {title}
        </h3>
        {badge && (
          <StatusBadge tone={badge.tone} title={badge.label}>
            {badge.label}
          </StatusBadge>
        )}
      </div>

      {idea && (
        <p title={idea} className="line-clamp-2 text-xs text-ink-tertiary">
          {idea}
        </p>
      )}

      <div className="mt-auto flex items-center gap-3 text-xs text-ink-quaternary">
        <span className="tabular-nums">
          {app.file_count} {app.file_count === 1 ? "file" : "files"}
        </span>
        {updated && <span className="min-w-0 truncate">{updated}</span>}
        {isSafeHttpUrl(app.repo_url) && (
          <a
            href={app.repo_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`GitHub repository for ${title}`}
            title="GitHub repository"
            className="inline-flex items-center gap-1 text-ink-tertiary hover:text-ink"
          >
            <Github className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">GitHub</span>
          </a>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="flex-1" onClick={onOpen} disabled={deleting}>
          Open
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete ${title}`}
          title="Delete app"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    </li>
  );
}
