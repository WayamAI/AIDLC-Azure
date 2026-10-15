import { ErrorText, withConnectorsLink } from "@/components/ErrorText";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api, DeploymentLogEvent, DeploymentRepoOptionsResponse, DeploymentStatusResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { BRAND_NAME, LOGO_ICON_SRC } from "@/lib/brand";
import { Link } from "react-router-dom";
import { useActiveRepo } from "@/context/RepoContext";
import { cn } from "@/lib/utils";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const selectClass = "h-10 w-full rounded-md border border-input bg-container px-3 text-sm text-ink disabled:opacity-60";
const pill = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const pillOn = "border-transparent bg-primary text-primary-foreground";
const pillOff = "border-border text-ink-secondary hover:bg-raised";

const FINAL_STATES = new Set(["READY", "ERROR", "CANCELED"]);

type ScreenMode = "setup" | "monitor";
type PreviewViewport = "desktop" | "tablet" | "mobile";

function statusTone(status: string): StatusTone {
  if (status === "READY") return "success";
  if (status === "ERROR" || status === "CANCELED") return "critical";
  return "pending";
}

function formatDateTime(value?: number) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function normalizeHost(urlOrHost: string): string {
  const raw = (urlOrHost || "").trim();
  if (!raw) return "";
  return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function buildPreviewCandidates(args: {
  primaryDomain: string;
  deploymentPublicUrl: string;
  statusProjectName?: string;
  healthProjectName?: string;
}) {
  const hosts = [
    normalizeHost(args.primaryDomain),
    normalizeHost(args.deploymentPublicUrl),
    normalizeHost(args.statusProjectName || ""),
    normalizeHost(args.healthProjectName || ""),
  ].filter(Boolean);

  const normalizedHosts = hosts.map((host) => {
    if (host.includes(".")) return host;
    return `${host}.vercel.app`;
  });

  const uniqueHosts = Array.from(new Set(normalizedHosts));
  return uniqueHosts.map((host) => `https://${host}`);
}

type LogView = {
  id: string;
  time: string;
  level: string;
  summary: string;
  meta?: string;
};

function parseLogEvent(event: DeploymentLogEvent, index: number, formatEventTime: (value?: string | number) => string): LogView {
  const message = String(event.message || "").trim();
  const level = (event.level || "info").toLowerCase();
  const time = formatEventTime(event.timestamp);

  let summary = message || "(empty)";
  let meta = "";

  if (message.startsWith("{") || message.startsWith("[")) {
    try {
      const parsed = JSON.parse(message);
      const parsedType = parsed?.type || parsed?.level || parsed?.state;
      const parsedName = parsed?.name || parsed?.entrypoint;
      const parsedText = parsed?.text || parsed?.message || parsed?.payload?.text;
      const parsedDate = parsed?.date;
      summary = String(parsedText || parsed.message || parsed.type || "Build event");

      const metaParts = [
        parsedType ? `type: ${parsedType}` : "",
        parsedName ? `name: ${parsedName}` : "",
        parsedDate ? `date: ${parsedDate}` : "",
      ].filter(Boolean);
      meta = metaParts.join(" | ");
    } catch {
      // Keep original message if JSON parsing fails.
    }
  }

  return {
    id: event.id || `evt-${index}`,
    time,
    level,
    summary,
    meta: meta || undefined,
  };
}

function levelColor(level: string) {
  if (level.includes("error") || level.includes("fatal")) return "text-destructive";
  if (level.includes("warn")) return "text-warning";
  return "text-ink-tertiary";
}

const LEVEL_RANK = (level: string) =>
  level.includes("error") || level.includes("fatal") ? 3 : level.includes("warn") ? 2 : 1;

const firstLine = (text: string) => text.split(/\r?\n/, 1)[0];

/** A log line is cut to its first line in the row; the rest is in the expanded detail. */
const logHasDetail = (row: LogView) => !!row.meta || row.summary.includes("\n") || row.summary.length > 140;

const LOG_COLUMNS: DataTableColumn<LogView>[] = [
  { id: "time", header: "Time", mono: true, width: "w-28", className: "tabular-nums text-ink-quaternary", cell: (row) => row.time },
  {
    id: "level",
    header: "Level",
    mono: true,
    width: "w-24",
    cell: (row) => <span className={cn("uppercase", levelColor(row.level))}>{row.level}</span>,
    sortValue: (row) => LEVEL_RANK(row.level),
  },
  {
    id: "message",
    header: "Message",
    grow: true,
    mono: true,
    className: "text-ink",
    cell: (row) => firstLine(row.summary),
  },
];

export default function Deployments() {
  const { activeRepo, setActiveRepo } = useActiveRepo();

  const [screen, setScreen] = useState<ScreenMode>("setup");
  const [repoUrl, setRepoUrl] = useState(activeRepo?.repoUrl ?? "");
  const [repoValidated, setRepoValidated] = useState(false);
  const [branch, setBranch] = useState(activeRepo?.branch ?? "");
  const [selectedCommit, setSelectedCommit] = useState("");
  const [deployByCommit, setDeployByCommit] = useState(false);
  const [repoOptions, setRepoOptions] = useState<DeploymentRepoOptionsResponse | null>(null);
  const [target, setTarget] = useState<"production" | "preview">("production");
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeploymentStatusResponse | null>(null);
  const [logs, setLogs] = useState<DeploymentLogEvent[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [previewViewport, setPreviewViewport] = useState<PreviewViewport>("desktop");

  const healthQuery = useQuery({
    queryKey: ["deploy-health"],
    queryFn: () => api.getDeploymentHealth(),
    refetchInterval: 15_000,
  });

  const repoOptionsMutation = useMutation({
    mutationFn: (payload: { repoUrl: string; branch?: string }) =>
      api.getDeploymentRepoOptions(payload.repoUrl, payload.branch),
    onSuccess: (data) => {
      setRepoOptions(data);
      setRepoValidated(true);
      const nextBranch = data.selected_branch || data.repo.default_branch || "main";
      setBranch(nextBranch);
      setSelectedCommit(data.commits[0]?.sha || "");
      setActiveRepo(repoUrl.trim(), nextBranch);
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () =>
      api.triggerDeployment({
        repo_url: repoUrl.trim(),
        branch: branch.trim(),
        commit_sha: deployByCommit ? selectedCommit.trim() : undefined,
        target,
      }),
    onMutate: () => {
      setScreen("monitor");
    },
    onSuccess: (data) => {
      setDeploymentId(data.deploymentId);
      setLogs([]);
      setLogsError(null);
      setStatus({
        deploymentId: data.deploymentId,
        status: data.status,
        url: data.url,
        createdAt: data.createdAt,
        inspectorUrl: data.inspectorUrl,
        triggeredBy: data.triggeredBy,
        projectName: data.projectName,
        domains: data.domains,
        target: data.target,
        sourceBranch: data.sourceBranch,
        sourceCommitSha: data.sourceCommitSha,
        ready: data.status === "READY",
      });
    },
  });

  useEffect(() => {
    if (!deploymentId) return;
    if (status && FINAL_STATES.has(status.status)) return;

    let failures = 0;
    const timer = window.setInterval(async () => {
      try {
        const latest = await api.getDeploymentStatus(deploymentId);
        failures = 0;
        setStatusError(null);
        setStatus(latest);
      } catch {
        // A single failed poll is transient; stop and say so once it keeps failing.
        failures += 1;
        if (failures >= 3) {
          window.clearInterval(timer);
          setStatusError("Cannot read the deployment status right now. The status shown may be out of date.");
        }
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [deploymentId, status]);

  useEffect(() => {
    if (!deploymentId) return;

    let active = true;

    const loadEvents = async () => {
      try {
        const data = await api.getDeploymentEvents(deploymentId, 180);
        if (!active) return;
        setLogs(data.events || []);
        setLogsError(null);
      } catch (error: any) {
        if (!active) return;
        const detail = error?.response?.data?.detail;
        setLogsError(typeof detail === "string" ? detail : "Live logs are currently unavailable.");
      }
    };

    loadEvents();
    const timer = window.setInterval(loadEvents, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [deploymentId]);

  const timeline = useMemo(() => {
    const current = status?.status || "IDLE";
    return [
      { label: "Queued", active: current !== "IDLE" },
      { label: "Building", active: ["BUILDING", "INITIALIZING", "READY", "ERROR", "CANCELED"].includes(current) },
      { label: "Ready", active: current === "READY" },
    ];
  }, [status]);

  const canDeploy = !!repoValidated && !!branch.trim() && (!deployByCommit || !!selectedCommit.trim());
  // Safely normalize – status.url might already contain the scheme or be a bare host
  const rawUrl = status?.url || "";
  const deploymentPublicUrl = rawUrl
    ? rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : `https://${rawUrl}`
    : "";
  const primaryDomain = status?.domains?.[0] || (deploymentPublicUrl ? normalizeHost(deploymentPublicUrl) : "");
  const previewCandidates = buildPreviewCandidates({
    primaryDomain,
    deploymentPublicUrl,
    statusProjectName: status?.projectName,
    healthProjectName: healthQuery.data?.project_name,
  });
  const previewUrl = previewCandidates[0] || "";
  const selectedCommitMessage = repoOptions?.commits?.find((item) => item.sha === selectedCommit)?.message;

  const triggeredBy = status?.triggeredBy;
  const actorLabel = triggeredBy?.username || triggeredBy?.email || "unknown";
  const isDeploying = !!status && !FINAL_STATES.has(status.status);

  const checklist = [
    { label: "Backend configured", done: !!healthQuery.data?.configured },
    { label: "Repository validated", done: repoValidated },
    { label: "Deployment created", done: !!status?.deploymentId },
    { label: "Deployment ready", done: status?.status === "READY" },
    { label: "Live events streaming", done: logs.length > 0 },
  ];

  const logRows = useMemo(
    () => logs.map((event, idx) => parseLogEvent(event, idx, formatEventTime)),
    [logs]
  );

  const previewFrameClass = useMemo(() => {
    if (previewViewport === "mobile") {
      return "w-full max-w-[390px] h-[700px]";
    }
    if (previewViewport === "tablet") {
      return "w-full max-w-[900px] h-[600px]";
    }
    return "w-full h-[560px]";
  }, [previewViewport]);

  function formatEventTime(value?: string | number) {
    if (value === undefined || value === null || value === "") return "--:--:--";
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
      : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "--:--:--";
    return date.toLocaleTimeString();
  }

  const refreshCommitsForBranch = async (nextBranch: string) => {
    try {
      const data = await api.getDeploymentRepoOptions(repoUrl.trim(), nextBranch.trim());
      setRepoOptions(data);
      setSelectedCommit(data.commits[0]?.sha || "");
    } catch {
      // Keep existing data if commit refresh fails.
    }
  };

  const renderSetupScreen = () => (
    <>
      <PageHeader
        title="Deployments"
        description="Pick a repository, branch and target, then trigger a Vercel deployment. After triggering, this page switches to a monitor for that deployment."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <PageCard title="New deployment" className="lg:col-span-2">
          <div className="space-y-4">
            <div>
              <label htmlFor="deploy-repo" className={fieldLabel}>
                GitHub repository URL
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="deploy-repo"
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    setRepoValidated(false);
                  }}
                  placeholder="https://github.com/owner/repo"
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => repoOptionsMutation.mutate({ repoUrl: repoUrl.trim() })}
                  disabled={!repoUrl.trim() || repoOptionsMutation.isPending}
                >
                  {repoOptionsMutation.isPending ? "Validating..." : "Validate repo"}
                </Button>
                {repoValidated && <StatusBadge tone="success">Validated</StatusBadge>}
              </div>
              {repoOptionsMutation.isError && (
                <p className="mt-2 text-sm text-destructive">
                  {(repoOptionsMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
                    "The repository could not be validated."}
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="deploy-branch" className={fieldLabel}>
                  Branch
                </label>
                {repoOptions?.branches?.length ? (
                  <select
                    id="deploy-branch"
                    value={branch}
                    onChange={async (e) => {
                      const next = e.target.value;
                      setBranch(next);
                      await refreshCommitsForBranch(next);
                    }}
                    disabled={!repoValidated}
                    className={selectClass}
                  >
                    {repoOptions.branches.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="deploy-branch"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    disabled={!repoValidated}
                  />
                )}
              </div>

              <div>
                <span className={fieldLabel}>Target</span>
                <div className="flex h-10 items-center gap-2">
                  {(["production", "preview"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTarget(option)}
                      aria-pressed={target === option}
                      className={cn(pill, "capitalize", target === option ? pillOn : pillOff)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="deploy-by-commit" className="flex items-center gap-2 text-xs text-ink-secondary">
                <input
                  id="deploy-by-commit"
                  type="checkbox"
                  checked={deployByCommit}
                  onChange={(e) => setDeployByCommit(e.target.checked)}
                  disabled={!repoValidated}
                  className="h-3.5 w-3.5 accent-current"
                />
                Deploy a specific commit instead of the latest branch head
              </label>
              {deployByCommit && (
                <>
                  {repoOptions?.commits?.length ? (
                    <select
                      value={selectedCommit}
                      onChange={(e) => setSelectedCommit(e.target.value)}
                      disabled={!repoValidated}
                      aria-label="Commit"
                      className={cn(selectClass, "mt-2")}
                    >
                      {repoOptions.commits.map((item) => (
                        <option key={item.sha} value={item.sha}>
                          {item.short_sha} - {item.message}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={selectedCommit}
                      onChange={(e) => setSelectedCommit(e.target.value)}
                      placeholder="Paste commit SHA"
                      aria-label="Commit SHA"
                      disabled={!repoValidated}
                      className="mt-2 font-mono text-xs"
                    />
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => triggerMutation.mutate()}
              disabled={!canDeploy || triggerMutation.isPending || !healthQuery.data?.configured}
            >
              {triggerMutation.isPending ? "Triggering..." : "Deploy and open monitor"}
            </Button>
          </div>

          {triggerMutation.isError && (
            <p className="mt-3 text-sm text-destructive">
              <ErrorText error={triggerMutation.error} fallback="The deployment could not be started." />
            </p>
          )}
        </PageCard>

        <PageCard
          title="Vercel configuration"
          actions={
            <StatusBadge tone={healthQuery.data?.configured ? "success" : "critical"}>
              {healthQuery.data?.configured ? "Configured" : "Missing configuration"}
            </StatusBadge>
          }
          padding={false}
        >
          {!healthQuery.data?.configured && (
            <p className="border-b border-border/60 px-4 py-3 text-xs text-ink-secondary">
              Add a Vercel token and project name in{" "}
              <Link to="/settings/connectors" className="text-ink underline underline-offset-2">
                Settings → Connectors
              </Link>
              . Env vars are the fallback if connectors are empty.
            </p>
          )}
          <dl>
            {[
              { label: "Project name", value: healthQuery.data?.project_name || "-" },
              { label: "Repo ID", value: healthQuery.data?.has_repo_id ? "available" : "missing" },
              { label: "Project ID", value: healthQuery.data?.has_project_id ? "available" : "optional" },
              { label: "Team ID", value: healthQuery.data?.has_team_id ? "available" : "optional" },
              { label: "Dynamic repo", value: healthQuery.data?.dynamic_repo_supported ? "enabled" : "not available" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0">
                <dt className="text-ink-tertiary">{row.label}</dt>
                <dd className="min-w-0 truncate text-ink-secondary">{row.value}</dd>
              </div>
            ))}
          </dl>

          {repoOptions?.branches?.length ? (
            <div className="border-t border-border/60 px-4 py-3">
              <p className={eyebrow}>Branches</p>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {repoOptions.branches.slice(0, 8).map((item) => (
                  <li key={item.name} className={cn("font-mono text-xs", item.name === branch ? "text-ink" : "text-ink-tertiary")}>
                    {item.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </PageCard>
      </div>
    </>
  );

  const renderMonitorScreen = () => (
    <>
      <PageHeader
        title="Deployment Monitor"
        description="Status, preview and build log for this deployment. Refreshes every 5 seconds."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setScreen("setup")}>
              <ArrowLeft className="h-4 w-4" />
              New deployment
            </Button>
            {status?.inspectorUrl && (
              <Button asChild variant="outline" size="sm" className="gap-2">
                <a href={status.inspectorUrl} target="_blank" rel="noreferrer">
                  Inspector
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </>
        }
      />

      {triggerMutation.isError && !status && (
        <Panel>
          <p className="text-sm text-destructive">
            <ErrorText error={triggerMutation.error} fallback="The deployment could not be started." />
          </p>
        </Panel>
      )}

      <Panel padded={false}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <StatusBadge tone={statusTone(status?.status || "IDLE")}>{status?.status || "QUEUED"}</StatusBadge>
          {status?.deploymentId && <span className="font-mono text-xs text-ink-secondary">{status.deploymentId}</span>}
          <ol className="flex items-center gap-2 text-xs">
            {timeline.map((item, i) => (
              <li key={item.label} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-4 bg-stroke-muted" />}
                <span className={cn("flex items-center gap-1.5", item.active ? "text-ink" : "text-ink-quaternary")}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", item.active ? "bg-primary" : "bg-status-neutral")} />
                  {item.label}
                </span>
              </li>
            ))}
          </ol>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-ink underline underline-offset-2">
              Open deployment
            </a>
          )}
        </div>
        <p
          className={cn(
            "border-t border-border/60 px-4 py-2.5 text-sm",
            status?.status === "ERROR" || status?.status === "CANCELED" ? "text-destructive" : "text-ink-secondary",
          )}
        >
          {status?.status === "READY" && "Deployment is live and ready."}
          {(status?.status === "ERROR" || status?.status === "CANCELED") && "Deployment failed. Check the logs and the inspector."}
          {isDeploying && "Build in progress."}
          {!status && !triggerMutation.isError && "Waiting for the deployment to be created."}
          {!status && triggerMutation.isError && "No deployment was created."}
        </p>
        {statusError && <p className="border-t border-border/60 px-4 py-2.5 text-sm text-destructive">{statusError}</p>}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <PageCard
          title="Live preview"
          className="lg:col-span-2"
          actions={
            <>
              {(["desktop", "tablet", "mobile"] as const).map((viewport) => (
                <button
                  key={viewport}
                  type="button"
                  onClick={() => setPreviewViewport(viewport)}
                  aria-pressed={previewViewport === viewport}
                  className={cn(pill, "capitalize", previewViewport === viewport ? pillOn : pillOff)}
                >
                  {viewport}
                </button>
              ))}
            </>
          }
        >
          {isDeploying || !previewUrl ? (
            <div className={cn(previewFrameClass, "mx-auto flex items-center justify-center rounded-md bg-raised")}>
              <div className="text-center">
                <img src={LOGO_ICON_SRC} alt={`${BRAND_NAME} logo`} className="mx-auto mb-3 h-10 w-10 object-contain" />
                <p className="text-sm text-ink-secondary">{isDeploying ? "Deployment in progress" : "No preview yet"}</p>
                <p className="mt-1 text-xs text-ink-tertiary">The live URL appears once the deployment is ready.</p>
              </div>
            </div>
          ) : (
            <div className={cn(previewFrameClass, "mx-auto overflow-hidden rounded-md border border-stroke-muted")}>
              <iframe
                src={previewUrl}
                title="Deployment public preview"
                className="h-full w-full border-0"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}
        </PageCard>

        <div className="space-y-4">
          <PageCard title="Deployment" padding={false}>
            <dl>
              {[
                { label: "Project", value: status?.projectName || healthQuery.data?.project_name || "-", mono: false },
                { label: "Target", value: status?.target || target, mono: false },
                { label: "Created", value: formatDateTime(status?.createdAt), mono: false },
                { label: "Triggered by", value: actorLabel, mono: false },
                ...(triggeredBy?.email && triggeredBy.email !== actorLabel
                  ? [{ label: "Email", value: triggeredBy.email, mono: false }]
                  : []),
                { label: "Source branch", value: status?.sourceBranch || branch || "-", mono: true },
                { label: "Commit", value: (status?.sourceCommitSha || selectedCommit || "").slice(0, 10) || "-", mono: true },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-xs">
                  <dt className="shrink-0 text-ink-tertiary">{row.label}</dt>
                  <dd className={cn("min-w-0 truncate text-ink-secondary", row.mono && "font-mono")}>{row.value}</dd>
                </div>
              ))}
              {(status?.sourceCommitMessage || selectedCommitMessage) && (
                <div className="border-b border-border/60 px-4 py-2.5 text-xs">
                  <dt className="text-ink-tertiary">Commit message</dt>
                  <dd className="mt-1 truncate text-ink-secondary" title={status?.sourceCommitMessage || selectedCommitMessage}>
                    {status?.sourceCommitMessage || selectedCommitMessage}
                  </dd>
                </div>
              )}
              <div className="px-4 py-2.5 text-xs">
                <dt className="text-ink-tertiary">Domain</dt>
                <dd className="mt-1">
                  {previewUrl ? (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 break-all text-ink underline underline-offset-2"
                    >
                      {primaryDomain || previewUrl}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  ) : (
                    <span className="break-all text-ink-secondary">{primaryDomain || "-"}</span>
                  )}
                </dd>
              </div>
            </dl>
          </PageCard>

          <PageCard title="Checklist" padding={false}>
            <ul>
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 text-xs last:border-b-0">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", item.done ? "bg-status-success" : "bg-status-neutral")} />
                  <span className={item.done ? "text-ink" : "text-ink-tertiary"}>{item.label}</span>
                  <span className="ml-auto text-ink-quaternary">{item.done ? "Done" : "Pending"}</span>
                </li>
              ))}
            </ul>
          </PageCard>
        </div>
      </div>

      <PageCard title="Build log" description="Refreshes every 5 seconds" padding={false}>
        {logsError && <p className="border-b border-border/60 px-4 py-2.5 text-xs text-destructive">{withConnectorsLink(logsError)}</p>}

        <DataTable
          bare
          columns={LOG_COLUMNS}
          rows={logRows}
          rowKey={(row) => row.id}
          empty="No log lines yet. Logs appear once the build emits events."
          searchText={(row) => `${row.level} ${row.summary} ${row.meta ?? ""}`}
          searchPlaceholder="Filter log lines"
          stickyHeader
          maxHeightClassName="max-h-80"
          canExpand={logHasDetail}
          renderExpanded={(row) => (
            <div className="space-y-1 font-mono text-xs">
              <pre className="whitespace-pre-wrap break-words text-ink">{row.summary}</pre>
              {row.meta && <p className="break-words text-[11px] text-ink-tertiary">{row.meta}</p>}
            </div>
          )}
        />
      </PageCard>
    </>
  );

  return <PageShell>{screen === "setup" ? renderSetupScreen() : renderMonitorScreen()}</PageShell>;
}
