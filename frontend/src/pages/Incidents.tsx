import { useState } from "react";
import { KpiStat } from "@/components/imcc/Panel";
import { EmptyState } from "@/components/EmptyState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Plus, RefreshCw, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-error";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { cn } from "@/lib/utils";

// An incident records a data-quality or production problem. On creation the
// backend asks the model for a root-cause hypothesis (cause, evidence, immediate
// action, prevention). The hypothesis is not verified against any system.
// Incidents can then be resolved with a note and exported as a post-mortem.
//
// Incidents require MongoDB to be running (see MONGODB_URI in backend .env).

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  investigating: { label: "Investigating", tone: "warning" },
  identified: { label: "Identified", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
};

const DIMENSIONS = ["completeness", "uniqueness", "validity", "consistency", "performance", "general"];

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const optional = "font-normal text-ink-quaternary";
const selectClass = "h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink";
const markdownClass =
  "prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-ink prose-h1:text-base prose-h2:text-sm prose-h3:text-sm " +
  "prose-p:text-ink-secondary prose-li:text-ink-secondary prose-strong:text-ink prose-a:text-ink prose-hr:border-border " +
  "prose-code:font-mono prose-code:text-xs prose-code:text-ink";

function downloadMarkdown(filename: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function NewIncidentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dimension, setDimension] = useState("general");
  const [severity, setSeverity] = useState<"critical" | "warning">("warning");
  const [recentCommits, setRecentCommits] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      // A hand-entered incident has no measurements, so none are sent: the model and the
      // post-mortem only see what the user actually stated.
      const anomaly = {
        dimension,
        severity,
        date: new Date().toISOString().slice(0, 10),
        description,
      };
      const commits = recentCommits
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return api.createIncident({ anomaly, title, recent_commits: commits });
    },
    onSuccess: () => {
      toast.success("Incident created");
      onCreated();
      onClose();
    },
    onError: (err: unknown) => {
      toast.error("The incident was not created", { description: apiErrorMessage(err) });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-label="Create incident" className="w-full max-w-lg rounded-lg border border-stroke-muted bg-container">
        <div className="flex items-center justify-between border-b border-stroke-muted px-4 py-2.5">
          <h2 className={eyebrow}>Create incident</h2>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label htmlFor="incident-title" className={fieldLabel}>
              Title
            </label>
            <Input
              id="incident-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Orders table completeness dropped 18% overnight"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="incident-dimension" className={fieldLabel}>
                Affected dimension
              </label>
              <select id="incident-dimension" value={dimension} onChange={(e) => setDimension(e.target.value)} className={cn(selectClass, "capitalize")}>
                {DIMENSIONS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="incident-severity" className={fieldLabel}>
                Severity
              </label>
              <select
                id="incident-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "critical" | "warning")}
                className={selectClass}
              >
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="incident-description" className={fieldLabel}>
              What happened? <span className={optional}>(the model builds its hypothesis from this text)</span>
            </label>
            <Textarea
              id="incident-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"Which dataset or table?\nWhat metric dropped or spiked?\nWhen did it start?\nAny known upstream changes?"}
              rows={4}
              className="resize-none text-xs"
            />
          </div>

          <div>
            <label htmlFor="incident-commits" className={fieldLabel}>
              Recent commits / deploys <span className={optional}>(optional, one per line)</span>
            </label>
            <Textarea
              id="incident-commits"
              value={recentCommits}
              onChange={(e) => setRecentCommits(e.target.value)}
              placeholder={"fix: update ETL pipeline batch size\nchore: bump dbt version to 1.7\ndeploy: prod release v2.3.1"}
              rows={3}
              className="resize-none font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-stroke-muted px-4 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!title.trim() || createMutation.isPending} className="gap-2">
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {createMutation.isPending ? "Creating and analysing" : "Create incident"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface Incident {
  id: string;
  title: string;
  status?: string;
  source?: string;
  triggered_at: string;
  root_cause?: string;
  evidence?: string[];
  immediate_action?: string;
  prevention_action?: string;
  timeline?: { time: string; event: string }[];
  anomaly?: { dimension?: string; severity?: string };
}

interface Postmortem {
  markdown?: unknown;
  ai_written?: boolean;
  generation_error?: unknown;
}

const SEVERITY: Record<string, { label: string; tone: StatusTone; rank: number }> = {
  critical: { label: "Critical", tone: "critical", rank: 2 },
  warning: { label: "Warning", tone: "warning", rank: 1 },
};

const statusOf = (incident: Incident) =>
  STATUS[incident.status ?? ""] || { label: String(incident.status ?? "Unknown"), tone: "neutral" as StatusTone };

function IncidentDetail({
  incident,
  resolving,
  onStopResolving,
  postmortem,
  onPostmortem,
}: {
  incident: Incident;
  resolving: boolean;
  onStopResolving: () => void;
  postmortem: Postmortem | undefined;
  onPostmortem: (postmortem: Postmortem) => void;
}) {
  const queryClient = useQueryClient();
  const [resolutionNote, setResolutionNote] = useState("");

  const resolveMutation = useMutation({
    mutationFn: () => api.resolveIncident(incident.id, resolutionNote.trim()),
    onSuccess: () => {
      onStopResolving();
      setResolutionNote("");
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      toast.success("Incident resolved", { description: "It moved to Resolved. Open it to generate the post-mortem." });
    },
    onError: (err: unknown) =>
      toast.error("The incident was not resolved", { description: apiErrorMessage(err, "Try again.") }),
  });

  const postmortemMutation = useMutation({
    mutationFn: () => api.generatePostmortem(incident.id),
    onSuccess: (data) => onPostmortem(data as Postmortem),
  });

  const postmortemMarkdown: string = typeof postmortem?.markdown === "string" ? postmortem.markdown : "";
  const postmortemError = (postmortemMutation.error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;

  return (
    <div className="space-y-4 py-1">
      {resolving && incident.status !== "resolved" && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (resolutionNote.trim()) resolveMutation.mutate();
          }}
        >
          <Input
            autoFocus
            className="h-8 flex-1 text-xs"
            placeholder="Resolution note: what fixed it?"
            aria-label="Resolution note"
            maxLength={500}
            value={resolutionNote}
            onChange={(e) => setResolutionNote(e.target.value)}
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={!resolutionNote.trim() || resolveMutation.isPending}>
              {resolveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mark resolved"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              disabled={resolveMutation.isPending}
              onClick={onStopResolving}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {incident.root_cause && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>AI hypothesis (unverified)</p>
          <p className="text-sm text-ink">{incident.root_cause}</p>
        </div>
      )}

      {(incident.evidence?.length ?? 0) > 0 && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Evidence cited by the model</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-ink-secondary">
            {incident.evidence!.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {(incident.immediate_action || incident.prevention_action) && (
        <div className="grid gap-4 md:grid-cols-2">
          {incident.immediate_action && (
            <div>
              <p className={cn(eyebrow, "mb-1.5")}>Suggested immediate action</p>
              <p className="text-xs text-ink-secondary">{incident.immediate_action}</p>
            </div>
          )}
          {incident.prevention_action && (
            <div>
              <p className={cn(eyebrow, "mb-1.5")}>Suggested prevention</p>
              <p className="text-xs text-ink-secondary">{incident.prevention_action}</p>
            </div>
          )}
        </div>
      )}

      {(incident.timeline?.length ?? 0) > 0 && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Timeline</p>
          <ul className="space-y-1.5">
            {incident.timeline!.map((t, i) => (
              <li key={i} className="flex items-start gap-3 text-xs">
                <span className="w-20 shrink-0 font-mono tabular-nums text-ink-tertiary">{new Date(t.time).toLocaleTimeString()}</span>
                <span className="text-ink-secondary">{t.event}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-2 text-xs"
          onClick={() => postmortemMutation.mutate()}
          disabled={postmortemMutation.isPending}
        >
          {postmortemMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {postmortemMutation.isPending ? "Generating" : "Generate post-mortem"}
        </Button>
        {postmortemMarkdown && (
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-xs"
            onClick={() => downloadMarkdown(`postmortem-${incident.id}.md`, postmortemMarkdown)}
          >
            <Download className="h-4 w-4" />
            Download .md
          </Button>
        )}
      </div>

      {postmortemMutation.isError && (
        <p className="text-xs text-destructive">
          {typeof postmortemError === "string" ? postmortemError : "The post-mortem could not be generated."}
        </p>
      )}

      {postmortem && (
        <div className="rounded-lg border border-stroke-muted bg-container">
          <div className="flex flex-wrap items-center gap-2 border-b border-stroke-muted px-4 py-2.5">
            <h3 className={eyebrow}>Post-mortem</h3>
            {postmortem.ai_written === false && <StatusBadge tone="neutral">Not AI-written</StatusBadge>}
          </div>
          {postmortem.ai_written === false && (
            <p className="border-b border-border/60 px-4 py-2.5 text-xs text-ink-secondary">
              This document is not AI-written: the narrative could not be generated, so it contains the recorded facts only.
              {typeof postmortem.generation_error === "string" && postmortem.generation_error && (
                <span className="mt-0.5 block font-mono text-ink-tertiary">{postmortem.generation_error}</span>
              )}
            </p>
          )}
          <div className="p-4">
            {postmortemMarkdown ? (
              <article className={markdownClass}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{postmortemMarkdown}</ReactMarkdown>
              </article>
            ) : (
              <p className="text-sm text-ink-tertiary">The response did not include a document.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentList({ title, incidents }: { title: string; incidents: Incident[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Kept here so a generated post-mortem survives collapsing its row.
  const [postmortems, setPostmortems] = useState<Record<string, Postmortem>>({});

  const setOpen = (id: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const columns: DataTableColumn<Incident>[] = [
    {
      id: "title",
      header: "Incident",
      grow: true,
      cell: (i) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-ink">{i.title}</span>
          {i.source === "demo" && <StatusBadge tone="neutral">Demo</StatusBadge>}
        </span>
      ),
      title: (i) => i.title,
      sortValue: (i) => i.title,
    },
    {
      id: "hypothesis",
      header: "AI hypothesis (unverified)",
      hideBelow: "2xl",
      className: "max-w-[22rem]",
      cell: (i) => <span className="text-xs">{i.root_cause ?? ""}</span>,
      title: (i) => i.root_cause,
    },
    {
      id: "status",
      header: "Status",
      width: "w-32",
      cell: (i) => <StatusBadge tone={statusOf(i).tone}>{statusOf(i).label}</StatusBadge>,
      sortValue: (i) => statusOf(i).label,
    },
    {
      id: "severity",
      header: "Severity",
      width: "w-28",
      hideBelow: "md",
      cell: (i) => {
        const severity = SEVERITY[i.anomaly?.severity ?? ""];
        return severity ? <StatusBadge tone={severity.tone}>{severity.label}</StatusBadge> : "";
      },
      sortValue: (i) => SEVERITY[i.anomaly?.severity ?? ""]?.rank ?? null,
    },
    {
      id: "dimension",
      header: "Dimension",
      hideBelow: "md",
      className: "capitalize text-xs",
      cell: (i) => (i.anomaly?.dimension && i.anomaly.dimension !== "general" ? i.anomaly.dimension : ""),
      sortValue: (i) => i.anomaly?.dimension,
    },
    { id: "id", header: "Id", mono: true, hideBelow: "lg", cell: (i) => i.id },
    {
      id: "triggered",
      header: "Triggered",
      hideBelow: "sm",
      width: "w-44",
      className: "text-xs tabular-nums",
      cell: (i) => new Date(i.triggered_at).toLocaleString(),
      sortValue: (i) => new Date(i.triggered_at),
    },
    {
      id: "resolve",
      header: "",
      label: "Resolve",
      align: "right",
      width: "w-24",
      cell: (i) =>
        i.status !== "resolved" ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={resolvingId === i.id}
            onClick={() => {
              setResolvingId(i.id);
              setOpen(i.id, true);
            }}
          >
            Resolve
          </Button>
        ) : null,
    },
  ];

  return (
    <DataTable
      caption={
        <>
          {title} <span className="ml-1 tabular-nums">{incidents.length}</span>
        </>
      }
      columns={columns}
      rows={incidents}
      rowKey={(i) => i.id}
      searchText={(i) => `${i.title} ${i.id} ${i.status ?? ""} ${i.anomaly?.dimension ?? ""} ${i.root_cause ?? ""}`}
      searchPlaceholder="Filter incidents"
      pageSize={25}
      expandedKeys={expanded}
      onExpandedChange={(id, open) => {
        setOpen(id, open);
        // The resolve form lives in the detail, so collapsing the row abandons it.
        if (!open && resolvingId === id) setResolvingId(null);
      }}
      renderExpanded={(i) => (
        <IncidentDetail
          incident={i}
          resolving={resolvingId === i.id}
          onStopResolving={() => setResolvingId(null)}
          postmortem={postmortems[i.id]}
          onPostmortem={(doc) => setPostmortems((current) => ({ ...current, [i.id]: doc }))}
        />
      )}
    />
  );
}

export default function Incidents() {
  const [showNewModal, setShowNewModal] = useState(false);
  const queryClient = useQueryClient();

  const incidentsQuery = useQuery({
    queryKey: ["incidents"],
    queryFn: () => api.listIncidents(),
    retry: 1,
  });

  const incidents = (incidentsQuery.data || []) as Incident[];
  const active = incidents.filter((i) => i.status !== "resolved");
  const resolved = incidents.filter((i) => i.status === "resolved");

  const isMongoDown =
    incidentsQuery.isError &&
    (String((incidentsQuery.error as any)?.message).includes("Network") ||
      String((incidentsQuery.error as any)?.response?.status) === "500");

  return (
    <PageShell>
      <PageHeader
        title="Incidents"
        description="Record a data-quality or production incident. The model proposes a root-cause hypothesis from the description you give it; nothing is verified against live systems. Resolve with a note and export a post-mortem."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["incidents"] })}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setShowNewModal(true)}>
              <Plus className="h-4 w-4" />
              New incident
            </Button>
          </>
        }
      />

      {isMongoDown && (
        <Panel>
          <p className="text-sm text-destructive">Cannot connect to MongoDB. Incidents are stored in MongoDB; start it with:</p>
          <code className="mt-2 block rounded-md bg-raised px-3 py-2 font-mono text-xs text-ink">
            docker run -d --name aidlc-mongo -p 127.0.0.1:27017:27017 mongo:7
          </code>
        </Panel>
      )}

      {incidentsQuery.isError && !isMongoDown && (
        <Panel>
          <EmptyState kind="error" compact>Incidents could not be loaded.</EmptyState>
        </Panel>
      )}

      {incidentsQuery.isLoading && (
        <Panel>
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading incidents…
          </p>
        </Panel>
      )}

      {!incidentsQuery.isLoading && !incidentsQuery.isError && incidents.length === 0 && (
        <Panel>
          <div className="py-8 text-center">
            <p className="text-sm text-ink-tertiary">
              No incidents yet. Create one here, or from an anomaly on the Metric Anomalies page.
            </p>
            <Button size="sm" className="mt-4 gap-2" onClick={() => setShowNewModal(true)}>
              <Plus className="h-4 w-4" />
              New incident
            </Button>
          </div>
        </Panel>
      )}

      {incidents.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <KpiStat mark="mark-kpi-incidents-open" label="Open" value={active.length} />
          <KpiStat mark="mark-kpi-incidents-resolved" label="Resolved" value={resolved.length} />
        </div>
      )}
      {active.length > 0 && <IncidentList title="Active" incidents={active} />}
      {resolved.length > 0 && <IncidentList title="Resolved" incidents={resolved} />}

      {showNewModal && (
        <NewIncidentModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["incidents"] })}
        />
      )}
    </PageShell>
  );
}
