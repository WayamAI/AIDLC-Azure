import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitBranch,
  Globe,
  Rocket,
  ServerCrash,
  ShieldCheck,
  TerminalSquare,
  User2,
} from "lucide-react";
import { api, DeploymentLogEvent, DeploymentRepoOptionsResponse, DeploymentStatusResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { BRAND_NAME, LOGO_ICON_SRC } from "@/lib/brand";

const FINAL_STATES = new Set(["READY", "ERROR", "CANCELED"]);

type ScreenMode = "setup" | "monitor";
type PreviewViewport = "desktop" | "tablet" | "mobile";

function statusTone(status: string) {
  if (status === "READY") return "text-positive border-positive/25 bg-positive/10";
  if (status === "ERROR" || status === "CANCELED") return "text-red-700 border-red-200 bg-red-50";
  return "text-amber-800 border-amber-200 bg-amber-50";
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
  if (level.includes("error") || level.includes("fatal")) return "text-red-700";
  if (level.includes("warn")) return "text-amber-700";
  if (level.includes("debug")) return "text-violet-700";
  if (level.includes("stdout") || level.includes("info")) return "text-cyan-700";
  return "text-slate-700";
}

export default function Deployments() {

  const [screen, setScreen] = useState<ScreenMode>("setup");
  const [repoUrl, setRepoUrl] = useState("");
  const [repoValidated, setRepoValidated] = useState(false);
  const [branch, setBranch] = useState("");
  const [selectedCommit, setSelectedCommit] = useState("");
  const [deployByCommit, setDeployByCommit] = useState(false);
  const [repoOptions, setRepoOptions] = useState<DeploymentRepoOptionsResponse | null>(null);
  const [target, setTarget] = useState<"production" | "preview">("production");
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeploymentStatusResponse | null>(null);
  const [logs, setLogs] = useState<DeploymentLogEvent[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
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
      setBranch(data.selected_branch || data.repo.default_branch || "main");
      setSelectedCommit(data.commits[0]?.sha || "");
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

    const timer = window.setInterval(async () => {
      try {
        const latest = await api.getDeploymentStatus(deploymentId);
        setStatus(latest);
      } catch {
        // Keep polling; transient API errors should not terminate the UI loop.
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
        icon={Rocket}
        title="Deployment Control Tower"
        description="Configure your repository and trigger a deployment. After triggering, you will move to a dedicated monitor screen."
      />

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="floating-card p-5 lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            <p className="text-[13px] font-semibold tracking-tight">Step-by-Step Deployment Wizard</p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Step 1: GitHub Repository URL</label>
              <Input
                value={repoUrl}
                onChange={(e) => {
                  setRepoUrl(e.target.value);
                  setRepoValidated(false);
                }}
                placeholder="https://github.com/owner/repo"
                className="mt-1"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => repoOptionsMutation.mutate({ repoUrl: repoUrl.trim() })}
                  disabled={!repoUrl.trim() || repoOptionsMutation.isPending}
                >
                  {repoOptionsMutation.isPending ? "Validating..." : "Validate Repo"}
                </Button>
                {repoValidated && <Badge className="border border-positive/25 bg-positive/10 text-positive">Repo Ready</Badge>}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Step 2: Branch</label>
              {repoOptions?.branches?.length ? (
                <select
                  value={branch}
                  onChange={async (e) => {
                    const next = e.target.value;
                    setBranch(next);
                    await refreshCommitsForBranch(next);
                  }}
                  disabled={!repoValidated}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {repoOptions.branches.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  disabled={!repoValidated}
                  className="mt-1"
                />
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Step 3: Commit (optional)</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="deploy-by-commit"
                  type="checkbox"
                  checked={deployByCommit}
                  onChange={(e) => setDeployByCommit(e.target.checked)}
                  disabled={!repoValidated}
                />
                <label htmlFor="deploy-by-commit" className="text-xs text-muted-foreground">
                  Deploy a specific commit SHA instead of latest branch head
                </label>
              </div>
              {deployByCommit && (
                <>
                  {repoOptions?.commits?.length ? (
                    <select
                      value={selectedCommit}
                      onChange={(e) => setSelectedCommit(e.target.value)}
                      disabled={!repoValidated}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                      disabled={!repoValidated}
                      className="mt-2"
                    />
                  )}
                </>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Step 4: Target</label>
              <div className="mt-1 flex gap-2">
                <Button type="button" variant={target === "production" ? "default" : "outline"} onClick={() => setTarget("production")} className="w-full">
                  Production
                </Button>
                <Button type="button" variant={target === "preview" ? "default" : "outline"} onClick={() => setTarget("preview")} className="w-full">
                  Preview
                </Button>
              </div>
            </div>
          </div>

          <Button
            onClick={() => triggerMutation.mutate()}
            disabled={!canDeploy || triggerMutation.isPending || !healthQuery.data?.configured}
            className="w-full md:w-auto"
          >
            {triggerMutation.isPending ? "Triggering..." : "Deploy And Open Monitor"}
          </Button>

          {triggerMutation.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {(triggerMutation.error as any)?.response?.data?.detail || "Failed to trigger deployment."}
            </div>
          )}
        </div>

        <div className="floating-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-positive" />
            <p className="text-[13px] font-semibold tracking-tight">Backend Config Health</p>
          </div>
          <Badge className={healthQuery.data?.configured ? "bg-positive/10 text-positive border border-positive/25" : "bg-red-50 text-red-700 border border-red-200"}>
            {healthQuery.data?.configured ? "Configured" : "Missing Configuration"}
          </Badge>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Project Name: {healthQuery.data?.project_name || "-"}</p>
            <p>Repo ID: {healthQuery.data?.has_repo_id ? "available" : "missing"}</p>
            <p>Project ID: {healthQuery.data?.has_project_id ? "available" : "optional"}</p>
            <p>Team ID: {healthQuery.data?.has_team_id ? "available" : "optional"}</p>
            <p>Dynamic Repo: {healthQuery.data?.dynamic_repo_supported ? "enabled" : "not available"}</p>
          </div>

          {repoOptions?.branches?.length ? (
            <>
              <div className="pt-2 border-t border-border/30" />
              <p className="text-xs font-medium">Active Branches</p>
              <div className="flex flex-wrap gap-2">
                {repoOptions.branches.slice(0, 8).map((item) => (
                  <Badge key={item.name} variant="outline" className={item.name === branch ? "border-primary/50 text-primary" : ""}>
                    {item.name}
                  </Badge>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );

  const renderMonitorScreen = () => (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <PageHeader
          className="mb-0 flex-1"
          icon={Activity}
          title="Deployment Monitor"
          description="Dedicated live tracking view for this deployment."
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setScreen("setup")}> 
            <ArrowLeft className="h-4 w-4 mr-1" />
            New Deployment
          </Button>
          {status?.inspectorUrl && (
            <Button asChild variant="outline">
              <a href={status.inspectorUrl} target="_blank" rel="noreferrer">
                Inspector <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {triggerMutation.isError && !status && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 mb-4">
          {(triggerMutation.error as any)?.response?.data?.detail || "Failed to trigger deployment."}
        </div>
      )}

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
              <p className="text-[13px] font-semibold tracking-tight text-foreground">Live Preview</p>
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
                <div className={`${previewFrameClass} mx-auto flex items-center justify-center bg-gradient-to-b from-slate-100 to-slate-200 rounded` }>
                  <div className="text-center">
                    <img src={LOGO_ICON_SRC} alt={`${BRAND_NAME} logo`} className="h-16 w-16 mx-auto mb-3 object-contain" />
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
              <p className="font-medium text-foreground">{actorLabel}</p>
              {!!triggeredBy?.email && <p className="text-xs text-foreground/70">{triggeredBy.email}</p>}
            </div>

            <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-1 text-xs">
              <p className="text-foreground/70">Deployment</p>
              <p className="font-medium text-foreground break-all">{status?.projectName || healthQuery.data?.project_name || "-"}</p>
              <p className="text-foreground/75">Target: {status?.target || target}</p>
              <p className="text-foreground/75">Created: {formatDateTime(status?.createdAt)}</p>
            </div>

            <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-1 text-xs">
              <p className="text-foreground/70 flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> Domain</p>
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary break-all hover:underline inline-flex items-center gap-1"
                >
                  {primaryDomain || previewUrl}
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              ) : (
                <p className="font-medium text-foreground break-all">{primaryDomain || "-"}</p>
              )}
              <p className="text-foreground/75">Source branch: {status?.sourceBranch || branch || "-"}</p>
              <p className="text-foreground/75">Commit: {(status?.sourceCommitSha || selectedCommit || "").slice(0, 10) || "-"}</p>
              {status?.sourceCommitMessage && <p className="text-foreground/70 truncate" title={status.sourceCommitMessage}>{status.sourceCommitMessage}</p>}
              {!status?.sourceCommitMessage && selectedCommitMessage && <p className="text-foreground/70 truncate" title={selectedCommitMessage}>{selectedCommitMessage}</p>}
            </div>

            <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2">
              <p className="text-[13px] font-semibold tracking-tight">Checklist</p>
              {checklist.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-xs">
                  <span className={item.done ? "text-positive" : "text-muted-foreground"}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <span className={item.done ? "text-foreground" : "text-foreground/70"}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {timeline.map((item) => (
            <div
              key={item.label}
              className={`rounded-md border p-3 text-center text-xs ${item.active ? "border-primary/50 bg-primary/10" : "border-border/40 bg-muted/20"}`}
            >
              {item.label}
            </div>
          ))}
        </div>

        {status?.status === "READY" && (
          <div className="rounded-md border border-positive/25 bg-positive/10 p-3 text-sm text-positive flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Deployment is live and ready.
          </div>
        )}

        {(status?.status === "ERROR" || status?.status === "CANCELED") && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
            <ServerCrash className="h-4 w-4" />
            Deployment failed. Check logs and inspector.
          </div>
        )}

        {isDeploying && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            Build in progress. This monitor auto-refreshes every 5 seconds.
          </div>
        )}
      </div>

      <div className="floating-card p-5 mt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-primary" />
            <p className="text-[13px] font-semibold tracking-tight">Live Build Logs</p>
          </div>
          <span className="text-xs text-muted-foreground">Auto-refresh every 5s</span>
        </div>

        {logsError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {logsError}
          </div>
        )}

        <div className="rounded-md border border-slate-300 bg-slate-50 h-80 overflow-y-auto p-3 font-mono text-xs">
          {logRows.length === 0 ? (
            <p className="text-slate-600">No log lines yet. Logs appear once the build emits events.</p>
          ) : (
            <div className="space-y-2">
              {logRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded border border-slate-300 bg-white px-2.5 py-2"
                >
                  <div className="grid grid-cols-[84px_88px_1fr] gap-2 items-start">
                    <span className="text-slate-500">{row.time}</span>
                    <span className={`uppercase font-semibold ${levelColor(row.level)}`}>{row.level}</span>
                    <span className="text-slate-900 break-words leading-5">{row.summary}</span>
                  </div>
                  {row.meta && (
                    <p className="text-[11px] mt-1 pl-[174px] break-words text-slate-500">
                      {row.meta}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
        {screen === "setup" ? renderSetupScreen() : renderMonitorScreen()}
      </motion.div>
    </PageShell>
  );
}
