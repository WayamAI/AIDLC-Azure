import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
  ServerCrash,
  TerminalSquare,
  User2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { usePipelineContext } from "@/context/PipelineContext";
import { BRAND_NAME, LOGO_ICON_SRC } from "@/lib/brand";
import {
  api,
  type DeploymentCommitOption,
  type DeploymentLogEvent,
  type DeploymentRepoOptionsResponse,
  type DeploymentStatusResponse,
} from "@/lib/api";

// ── Constants ─────────────────────────────────────────────────────────────────

const FINAL_STATES = new Set(["READY", "ERROR", "CANCELED"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusTone(status: string) {
  if (status === "READY") return "text-positive border-positive/25 bg-positive/10";
  if (status === "ERROR" || status === "CANCELED") return "text-red-700 border-red-200 bg-red-50";
  return "text-amber-800 border-amber-200 bg-amber-50";
}

function formatEventTime(value?: string | number): string {
  if (value === undefined || value === null || value === "") return "--:--:--";
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString();
}

type LogView = { id: string; time: string; level: string; summary: string };

function parseLogEvent(event: DeploymentLogEvent, index: number): LogView {
  const message = String(event.message || "").trim();
  const level = (event.level || "info").toLowerCase();
  const time = formatEventTime(event.timestamp);
  let summary = message || "(empty)";

  if (message.startsWith("{") || message.startsWith("[")) {
    try {
      const parsed = JSON.parse(message);
      const parsedText = parsed?.text || parsed?.message || parsed?.payload?.text;
      summary = String(parsedText || parsed.type || "Build event");
    } catch { /* keep original */ }
  }

  return { id: `${event.id || event.timestamp || "evt"}-${index}`, time, level, summary };
}

function levelColor(level: string) {
  if (level.includes("error") || level.includes("fatal")) return "text-red-700";
  if (level.includes("warn")) return "text-amber-700";
  if (level.includes("stdout") || level.includes("info")) return "text-cyan-700";
  return "text-slate-700";
}

function normalizeHost(urlOrHost: string): string {
  return (urlOrHost || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function buildPreviewCandidates(args: {
  primaryDomain: string;
  deploymentPublicUrl: string;
  statusProjectName?: string;
}) {
  const hosts = [
    normalizeHost(args.primaryDomain),
    normalizeHost(args.deploymentPublicUrl),
    normalizeHost(args.statusProjectName || ""),
  ].filter(Boolean);

  const normalizedHosts = hosts.map((host) => (host.includes(".") ? host : `${host}.vercel.app`));
  return Array.from(new Set(normalizedHosts)).map((host) => `https://${host}`);
}

function formatDateTime(value?: number) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

// ── StageDeployment ───────────────────────────────────────────────────────────

export function StageDeployment() {
  const {
    repoUrl,
    branch,
    commitSha,
    commitMessage,
    commitUrl,
    deployedUrl,
    setDeployedUrl,
    setCommit,
    completeStage,
    goToStage,
    githubPat,
  } = usePipelineContext();

  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeploymentStatusResponse | null>(null);
  const [logs, setLogs] = useState<DeploymentLogEvent[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [repoOptions, setRepoOptions] = useState<DeploymentRepoOptionsResponse | null>(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitInputMode, setCommitInputMode] = useState<"list" | "manual">("list");
  const [selectedCommit, setSelectedCommit] = useState("");
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");

  const selectedCommitMeta = useMemo<DeploymentCommitOption | undefined>(
    () => repoOptions?.commits?.find((c) => c.sha === selectedCommit),
    [repoOptions?.commits, selectedCommit],
  );

  const refreshCommits = async (preferCurrentSelection = true) => {
    if (!repoUrl) return;
    setCommitsLoading(true);
    try {
      const data = await api.getDeploymentRepoOptions(repoUrl, branch || "main");
      setRepoOptions(data);
      if (commitInputMode === "manual") return;

      const pipelineSha = commitSha?.trim() || "";
      const hasPipelineSha = !!pipelineSha && data.commits.some((c) => c.sha === pipelineSha);

      if (preferCurrentSelection && selectedCommit && data.commits.some((c) => c.sha === selectedCommit)) {
        return;
      }

      if (hasPipelineSha) {
        setSelectedCommit(pipelineSha);
        return;
      }

      setSelectedCommit(data.commits[0]?.sha || "");
    } finally {
      setCommitsLoading(false);
    }
  };

  useEffect(() => {
    if (!repoUrl) return;
    void refreshCommits(false);
  }, [repoUrl, branch]);

  useEffect(() => {
    if (commitInputMode === "manual") return;
    if (!commitSha) return;
    setSelectedCommit((prev) => prev || commitSha);
  }, [commitSha, commitInputMode]);

  // Derive deployed URL from status
  const deploymentPublicUrl = status?.url ? `https://${status.url}` : "";
  const primaryDomain = status?.domains?.[0] || deploymentPublicUrl.replace(/^https:\/\//, "");
  const previewCandidates = buildPreviewCandidates({
    primaryDomain,
    deploymentPublicUrl,
    statusProjectName: status?.projectName,
  });
  const previewUrl = previewCandidates[0] || "";

  const liveUrl = useMemo(() => {
    if (previewUrl) return previewUrl;
    if (!status?.url) return "";
    const host = normalizeHost(status.url);
    const hostWithDomain = host.includes(".") ? host : `${host}.vercel.app`;
    return `https://${hostWithDomain}`;
  }, [previewUrl, status]);

  const isReady = status?.status === "READY";
  const isFailed = status?.status === "ERROR" || status?.status === "CANCELED";
  const isDeploying = !!deploymentId && !FINAL_STATES.has(status?.status ?? "");

  const previewFrameClass = useMemo(() => {
    if (previewViewport === "mobile") return "w-full max-w-[390px] h-[520px]";
    if (previewViewport === "tablet") return "w-full max-w-[900px] h-[440px]";
    return "w-full h-[420px]";
  }, [previewViewport]);

  // Sync liveUrl → pipeline context when ready
  useEffect(() => {
    if (isReady && liveUrl && liveUrl !== deployedUrl) {
      setDeployedUrl(liveUrl);
    }
  }, [isReady, liveUrl, deployedUrl, setDeployedUrl]);

  // Poll status
  useEffect(() => {
    if (!deploymentId || (status && FINAL_STATES.has(status.status))) return;
    const timer = window.setInterval(async () => {
      try {
        const latest = await api.getDeploymentStatus(deploymentId);
        setStatus(latest);
      } catch { /* transient */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [deploymentId, status]);

  // Poll logs
  useEffect(() => {
    if (!deploymentId) return;
    let active = true;
    const load = async () => {
      try {
        const data = await api.getDeploymentEvents(deploymentId, 150);
        if (!active) return;
        setLogs(data.events || []);
        setLogsError(null);
      } catch (err: any) {
        if (!active) return;
        const detail = err?.response?.data?.detail;
        setLogsError(typeof detail === "string" ? detail : "Logs temporarily unavailable.");
      }
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [deploymentId]);

  const handleDeploy = async () => {
    if (!repoUrl) return;
    setTriggering(true);
    setTriggerError(null);
    setLogs([]);
    setLogsError(null);
    setStatus(null);
    try {
      const commitToDeploy = selectedCommit.trim();
      const result = await api.triggerDeployment({
        repo_url: repoUrl,
        branch: branch || "main",
        commit_sha: commitToDeploy || undefined,
        target: "production",
        github_pat: githubPat || undefined,
      });

      if (commitToDeploy) {
        const selected = repoOptions?.commits?.find((c) => c.sha === commitToDeploy);
        setCommit(commitToDeploy, selected?.message || commitMessage || "", commitUrl || "");
      }

      setDeploymentId(result.deploymentId);
      setStatus({
        deploymentId: result.deploymentId,
        status: result.status,
        url: result.url,
        createdAt: result.createdAt,
        inspectorUrl: result.inspectorUrl,
        triggeredBy: result.triggeredBy,
        projectName: result.projectName,
        domains: result.domains,
        target: result.target,
        sourceBranch: result.sourceBranch,
        sourceCommitSha: result.sourceCommitSha,
        ready: result.status === "READY",
      });
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setTriggerError(typeof detail === "string" ? detail : "Failed to trigger deployment.");
    } finally {
      setTriggering(false);
    }
  };

  const logRows = useMemo(
    () => logs.map((event, idx) => parseLogEvent(event, idx)),
    [logs]
  );

  const timeline = useMemo(() => {
    const current = status?.status || "IDLE";
    return [
      { label: "Queued",   active: current !== "IDLE" },
      { label: "Building", active: ["BUILDING", "INITIALIZING", "READY", "ERROR", "CANCELED"].includes(current) },
      { label: "Ready",    active: current === "READY" },
    ];
  }, [status]);

  return (
    <div className="flex flex-col h-full">
      {/* Banner */}
      <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/20 flex-shrink-0">
        <div className="flex items-center gap-3 text-xs text-primary/80 min-w-0">
          <Rocket className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Stage 3 Deploy your commit to production and capture the live URL (or skip and continue to tests).</span>
          {isReady && liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-positive hover:underline flex-shrink-0"
            >
              <Globe className="h-3 w-3" />
              {liveUrl.replace("https://", "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => goToStage(2)}>
            ← Back
          </Button>
          {!isReady && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => completeStage(3)}>
              Skip Deploy to Live Tests
            </Button>
          )}
          {isReady && (
            <Button size="sm" className="h-7 text-xs" onClick={() => completeStage(3)}>
              Continue to Live Tests <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Setup card */}
        <div className="floating-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">Deployment Configuration</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-1">
              <p className="text-muted-foreground">Repository</p>
              <p className="font-mono font-medium text-foreground truncate" title={repoUrl}>
                {repoUrl?.replace("https://github.com/", "") || "—"}
              </p>
            </div>
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-1">
              <p className="text-muted-foreground">Branch</p>
              <p className="font-mono font-medium text-foreground">{branch || "main"}</p>
            </div>
            <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Commit SHA</p>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                  onClick={() => void refreshCommits(true)}
                  disabled={commitsLoading}
                >
                  <RefreshCw className={`h-3 w-3 ${commitsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

              {commitInputMode === "list" ? (
                repoOptions?.commits?.length ? (
                  <select
                    value={selectedCommit}
                    onChange={(e) => setSelectedCommit(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-[11px]"
                  >
                    {repoOptions.commits.map((item) => (
                      <option key={item.sha} value={item.sha}>
                        {item.short_sha} · {item.message}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-muted-foreground/60 italic">No commits loaded yet</p>
                )
              ) : (
                <Input
                  value={selectedCommit}
                  onChange={(e) => setSelectedCommit(e.target.value)}
                  placeholder="Paste commit SHA"
                  className="h-8 text-[11px]"
                />
              )}

              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => setCommitInputMode((prev) => (prev === "list" ? "manual" : "list"))}
              >
                {commitInputMode === "list" ? "Use manual SHA" : "Pick from recent commits"}
              </button>

              <p className="font-mono text-[11px] text-positive truncate">
                {(selectedCommit || commitSha || "latest branch head").slice(0, selectedCommit || commitSha ? 10 : undefined)}
              </p>
            </div>
          </div>

          {selectedCommitMeta && (
            <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
              Selected commit: <span className="font-mono">{selectedCommitMeta.short_sha}</span> {selectedCommitMeta.message}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleDeploy}
              disabled={triggering || isDeploying || !repoUrl}
              className="gap-2"
            >
              {triggering || isDeploying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {deploymentId ? "Re-deploy" : "Deploy to Production"}
            </Button>

            {status && (
              <Badge className={`border ${statusTone(status.status)}`}>
                {status.status}
              </Badge>
            )}

            {isDeploying && (
              <span className="text-xs text-amber-800 flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                Auto-refreshing every 5s…
              </span>
            )}
          </div>

          {triggerError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {triggerError}
            </div>
          )}
        </div>

        {/* Status monitor (shows after deploy is triggered) */}
        {deploymentId && (
          <div className="floating-card p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={`border ${statusTone(status?.status || "IDLE")}`}>{status?.status || "QUEUED"}</Badge>
              {status?.deploymentId && <span className="text-xs text-muted-foreground">ID: {status.deploymentId}</span>}
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline-offset-4 hover:underline">
                  Open deployment
                </a>
              )}
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 rounded-md border border-border/50 bg-muted/10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">Live Preview</p>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-md border border-border/60 bg-background/80 p-0.5">
                      <button
                        type="button"
                        onClick={() => setPreviewViewport("desktop")}
                        className={`px-2 py-1 text-[11px] rounded ${previewViewport === "desktop" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}
                      >
                        Desktop
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewViewport("tablet")}
                        className={`px-2 py-1 text-[11px] rounded ${previewViewport === "tablet" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}
                      >
                        Tablet
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewViewport("mobile")}
                        className={`px-2 py-1 text-[11px] rounded ${previewViewport === "mobile" ? "bg-primary text-primary-foreground" : "text-foreground/70"}`}
                      >
                        Mobile
                      </button>
                    </div>
                    <p className="text-xs text-foreground/70">{isDeploying ? "Preparing deployment..." : "Live"}</p>
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-white p-2">
                  {isDeploying || !previewUrl ? (
                    <div className={`${previewFrameClass} mx-auto flex items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 rounded`}>
                      <div className="text-center">
                        <img src={LOGO_ICON_SRC} alt={`${BRAND_NAME} logo`} className="h-14 w-14 mx-auto mb-3 object-contain" />
                        <p className="text-sm font-medium text-slate-700">Deployment in progress</p>
                        <p className="text-xs text-slate-500 mt-1">Live URL will appear after readiness checks pass.</p>
                      </div>
                    </div>
                  ) : (
                    <div className={`${previewFrameClass} mx-auto overflow-hidden bg-white rounded border border-slate-200`}>
                      <iframe
                        src={previewUrl}
                        title="Deployment public preview"
                        className="w-full h-full border-0"
                        loading="lazy"
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-sm">
                  <div className="flex items-center gap-2 text-foreground/70 text-xs mb-1">
                    <User2 className="h-3.5 w-3.5" />
                    Triggered By
                  </div>
                  <p className="font-medium text-foreground">{status?.triggeredBy?.username || status?.triggeredBy?.email || "unknown"}</p>
                  {!!status?.triggeredBy?.email && <p className="text-xs text-foreground/70">{status.triggeredBy.email}</p>}
                </div>

                <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-1 text-xs">
                  <p className="text-foreground/70">Deployment</p>
                  <p className="font-medium text-foreground break-all">{status?.projectName || "-"}</p>
                  <p className="text-foreground/75">Target: {status?.target || "production"}</p>
                  <p className="text-foreground/75">Created: {formatDateTime(status?.createdAt)}</p>
                </div>

                <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-1 text-xs">
                  <p className="text-foreground/70 flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> Domain</p>
                  <p className="font-medium text-foreground break-all">{primaryDomain || "-"}</p>
                  <p className="text-foreground/75">Source branch: {status?.sourceBranch || branch || "-"}</p>
                  <p className="text-foreground/75">Commit: {(status?.sourceCommitSha || selectedCommit || "").slice(0, 10) || "-"}</p>
                  {status?.sourceCommitMessage && <p className="text-foreground/70 truncate" title={status.sourceCommitMessage}>{status.sourceCommitMessage}</p>}
                  {!status?.sourceCommitMessage && selectedCommitMeta?.message && <p className="text-foreground/70 truncate" title={selectedCommitMeta.message}>{selectedCommitMeta.message}</p>}
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="grid grid-cols-3 gap-3">
              {timeline.map((item) => (
                <div
                  key={item.label}
                  className={`rounded-md border p-3 text-center text-xs ${
                    item.active ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 bg-muted/20 text-muted-foreground"
                  }`}
                >
                  {item.label}
                </div>
              ))}
            </div>

            {/* Status messages */}
            {isReady && (
              <div className="rounded-md border border-positive/25 bg-positive/10 p-3 text-sm text-positive flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                <span>
                  Deployment is live at{" "}
                  <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-primary">
                    {liveUrl}
                  </a>
                  . Click <strong>Continue to Live Tests</strong> above to run tests against it.
                </span>
              </div>
            )}

            {isFailed && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
                <ServerCrash className="h-4 w-4 flex-shrink-0" />
                Deployment failed ({status?.status}). Check logs below and try re-deploying.
              </div>
            )}

            {isDeploying && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-center gap-2">
                <Clock3 className="h-4 w-4 flex-shrink-0" />
                Build in progress. This view auto-refreshes every 5 seconds.
              </div>
            )}

            {/* Metadata */}
            {status && (
              <div className="grid sm:grid-cols-3 gap-3 text-xs">
                <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-1">
                  <p className="text-muted-foreground">Deployment ID</p>
                  <p className="font-mono text-foreground truncate">{status.deploymentId}</p>
                </div>
                <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-1">
                  <p className="text-muted-foreground">Project</p>
                  <p className="font-medium text-foreground">{status.projectName || "—"}</p>
                </div>
                <div className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-1">
                  <p className="text-muted-foreground">Deployed URL</p>
                  {liveUrl ? (
                    <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono truncate block">
                      {liveUrl.replace("https://", "")}
                    </a>
                  ) : (
                    <p className="text-muted-foreground/60">Waiting…</p>
                  )}
                </div>
              </div>
            )}

            {/* Live logs */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TerminalSquare className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Live Build Logs</p>
                {isDeploying && (
                  <span className="text-[10px] text-muted-foreground ml-auto">auto-refresh 5s</span>
                )}
              </div>

              {logsError && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 mb-2">
                  {logsError}
                </div>
              )}

              <div className="rounded-md border border-slate-300 bg-slate-50 h-56 overflow-y-auto p-3 font-mono text-xs">
                {logRows.length === 0 ? (
                  <p className="text-slate-600">
                    {isDeploying ? "Waiting for build events…" : "No log lines yet."}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {logRows.map((row) => (
                      <div
                        key={row.id}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5"
                      >
                        <div className="grid grid-cols-[80px_80px_1fr] gap-2 items-start">
                          <span className="text-slate-500">{row.time}</span>
                          <span className={`uppercase font-semibold ${levelColor(row.level)}`}>{row.level}</span>
                          <span className="text-slate-900 break-words leading-5">{row.summary}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
