import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Play,
  Loader2,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  ExternalLink,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { usePipelineContext } from "@/context/PipelineContext";
import LiveTestRunner from "@/pages/LiveTestRunner";
import { HealFailedTest } from "@/components/live-testing/HealFailedTest";
import { cn } from "@/lib/utils";
import { useLiveTesting } from "@/hooks/use-live-testing";
import { api, baselineApi, type WorkspacePlaywrightTest, type LiveTestResult, type BaselineTest } from "@/lib/api";
import { downloadLiveTestReport } from "@/lib/pdf-report";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnifiedTestIntelligence } from "./UnifiedTestIntelligence";
import { KpiStat } from "@/components/imcc/Panel";
import { StatusBadge } from "@/components/imcc/StatusBadge";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const pill = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const pillOn = "border-transparent bg-primary text-primary-foreground";
const pillOff = "border-border text-ink-secondary hover:bg-raised";

function CommittedTestsRunner({
  tests,
  defaultTargetUrl,
  onRunComplete,
}: {
  tests: WorkspacePlaywrightTest[];
  defaultTargetUrl: string;
  onRunComplete: (summary: { passed: number; failed: number; total: number; pass_rate: number }) => void;
}) {
  const [targetUrl, setTargetUrl] = useState(defaultTargetUrl || "");
  const [testEmail, setTestEmail] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const {
    phase,
    runStatus,
    errorMsg,
    handleExecuteDirect,
    reset,
    isExecutingDirect,
  } = useLiveTesting();

  const isLocalhost = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");
  const canRun = targetUrl.trim().startsWith("http") && !isExecutingDirect && phase === "idle";

  useEffect(() => {
    if (phase !== "done" || !runStatus) return;
    const t = runStatus.total ?? 0;
    const p = runStatus.passed ?? 0;
    const f = runStatus.failed ?? 0;
    const key = `${runStatus.run_id}-committed-reported`;
    if (t > 0 && !sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      onRunComplete({ passed: p, failed: f, total: t, pass_rate: t > 0 ? Math.round((p / t) * 100) : 0 });
    }
  }, [phase, runStatus, onRunComplete]);

  if (phase === "idle") {
    return (
      <div className="rounded-lg border border-stroke-muted bg-container">
        <div className="border-b border-stroke-muted px-4 py-3">
          <h3 className={eyebrow}>Run setup</h3>
          <p className="mt-1 text-sm text-ink-tertiary">
            Runs the {tests.length} test{tests.length === 1 ? "" : "s"} listed above in a browser against the URL below.
          </p>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="pipeline-run-target" className={fieldLabel}>Target URL</label>
              <Input
                id="pipeline-run-target"
                placeholder="URL of the deployed app"
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pipeline-run-email" className={fieldLabel}>
                Test account email <span className="font-normal text-ink-quaternary">(optional)</span>
              </label>
              <Input
                id="pipeline-run-email"
                type="email"
                autoComplete="off"
                placeholder="Email of a test account"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="pipeline-run-password" className={fieldLabel}>
                Test account password <span className="font-normal text-ink-quaternary">(optional)</span>
              </label>
              <Input
                id="pipeline-run-password"
                type="password"
                autoComplete="new-password"
                placeholder="Password of the test account"
                value={testPassword}
                onChange={(e) => setTestPassword(e.target.value)}
              />
            </div>
          </div>
          {isLocalhost && (
            <p className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This is a local address. The browser runs inside the backend, so the app must be reachable from that machine.
            </p>
          )}
          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
          <div className="flex justify-end">
            <Button
              className="gap-2"
              disabled={!canRun}
              onClick={() => handleExecuteDirect(tests, targetUrl.trim(), testEmail || undefined, testPassword || undefined)}
            >
              {isExecutingDirect ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isExecutingDirect ? "Starting…" : "Run tests"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!runStatus) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-ink-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Starting the run…
      </p>
    );
  }

  const { results, total, passed, failed, status } = runStatus;
  const completedCount = results.filter((r) => r.status === "passed" || r.status === "failed").length;
  const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const successRatePercent = total > 0 ? Math.round((passed / total) * 100) : 0;

  const activeRunningTest = results.find((r) => r.status === "running");
  const latestFrame = activeRunningTest?.step_results.slice().reverse().find((s) => s.screenshot)?.screenshot ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stroke-muted bg-container">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <StatusBadge tone={status === "running" ? "info" : failed > 0 ? "critical" : "success"}>
            {status === "running" ? "Running" : "Finished"}
          </StatusBadge>
          <span className="min-w-0 truncate text-sm text-ink-secondary">
            {status === "running"
              ? activeRunningTest
                ? activeRunningTest.test_name
                : "Preparing the browser"
              : "All tests have finished"}
          </span>
          <span className="ml-auto text-xs tabular-nums text-ink-tertiary">
            {completedCount} of {total}
          </span>
          {phase === "done" && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => downloadLiveTestReport(runStatus!)}>
                <Download className="h-4 w-4" /> Download report
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={reset}>
                <RotateCcw className="h-4 w-4" /> Run again
              </Button>
            </div>
          )}
        </div>
        {status === "running" && <Progress value={progressPercent} className="h-0.5 rounded-none bg-raised-2" />}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiStat mark="mark-kpi-pass-rate"
          label={status === "running" ? "Progress" : "Pass rate"}
          value={`${status === "running" ? progressPercent : successRatePercent}%`}
          hint={status === "running" ? `${completedCount} of ${total} finished` : `of ${total} tests`}
        />
        <KpiStat mark="mark-kpi-passed" label="Passed" value={passed} />
        <KpiStat mark="mark-kpi-failed" label="Failed" value={failed} />
        <KpiStat mark="mark-test-suite" label="Total" value={total} />
      </div>

      <div className="overflow-hidden rounded-lg border border-stroke-muted bg-container">
        <div className="flex h-11 items-center gap-3 border-b border-stroke-muted px-4">
          <h2 className={eyebrow}>Browser</h2>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-tertiary">
            {activeRunningTest ? activeRunningTest.test_name : ""}
          </span>
        </div>
        <div className="relative flex aspect-video min-h-[400px] items-center justify-center bg-raised">
          {latestFrame ? (
            <img
              key={latestFrame.slice(-20)}
              src={`data:image/png;base64,${latestFrame}`}
              alt="Live browser feed"
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink-tertiary">
              {status === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
              {status === "running" ? "Waiting for the first screenshot…" : "No screenshot to show."}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className={eyebrow}>Results</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {results.map((r) => (
            <MiniTestCard
              key={r.test_id}
              result={r}
              runId={runStatus.run_id}
              targetUrl={targetUrl}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Mini live test card ────────────────────────────────────────────────────────

function MiniTestCard({
  result,
  runId,
  targetUrl,
}: {
  result: LiveTestResult;
  runId?: string;
  targetUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const icon = {
    running: <Loader2 className="h-4 w-4 animate-spin text-warning" />,
    passed: <CheckCircle2 className="h-4 w-4 text-positive" />,
    failed: <XCircle className="h-4 w-4 text-destructive" />,
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  }[result.status];

  return (
    <div className="rounded-lg border border-stroke-muted bg-container overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-raised transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="flex-1 text-sm font-medium text-ink truncate">{result.test_name}</span>
        {result.duration_ms && (
          <span className="font-mono text-xs tabular-nums text-ink-tertiary mr-1">
            {(result.duration_ms / 1000).toFixed(1)}s
          </span>
        )}
        <span className="text-xs tabular-nums text-ink-tertiary">
          {result.steps_completed}/{result.total_steps} steps
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
      </button>
      <>
        {open && (
          <div
            className="overflow-hidden"
          >
            <div className="space-y-1.5 border-t border-stroke-muted px-4 pb-3 pt-3">
              {result.error && <p className="font-mono text-xs text-destructive">{result.error}</p>}
              {result.status === "failed" && runId && targetUrl && (
                <HealFailedTest runId={runId} testId={result.test_id} targetUrl={targetUrl} />
              )}
              {result.step_results.map((sr, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg bg-raised px-3 py-2 text-xs"
                >
                  {sr.status === "pass" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-positive mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 flex-shrink-0" />
                  )}
                  <span className={`flex-1 ${sr.status === "fail" ? "text-destructive" : "text-ink-secondary"}`}>{sr.step_description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    </div>
  );
}

// ── StageTestRunner ────────────────────────────────────────────────────────────

export function StageTestRunner() {
  const { liveTestSummary, setLiveTestSummary, testSuite, repoUrl, deployedUrl, completeStage, goToStage } = usePipelineContext();
  const queryClient = useQueryClient();
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [selectedBaselineIds, setSelectedBaselineIds] = useState<Set<string>>(new Set());

  // Saved baseline tests for the connected repository. A repository that has
  // never been scanned answers 404, which is "no baseline", not a failure.
  const baselineQuery = useQuery({
    queryKey: ["pipeline-baseline-tests", repoUrl],
    enabled: !!repoUrl,
    queryFn: async (): Promise<BaselineTest[]> => {
      const repoId = await api.getRepoId(repoUrl);
      try {
        const data = await baselineApi.getRepoTests(repoId);
        return data.tests ?? [];
      } catch (err) {
        if ((err as { response?: { status?: number } })?.response?.status === 404) return [];
        throw err;
      }
    },
  });
  const baselineTests: BaselineTest[] = baselineQuery.data ?? [];

  const sessionTests = testSuite.map(t => ({ ...t, source: "session" }));

  const saveBaselineMutation = useMutation({
    mutationFn: async () => {
      const repoId = await api.getRepoId(repoUrl);
      const mapped = sessionTests.map(t => ({
        test_id: t.id,
        name: t.name,
        description: t.description,
        category: "ui_component",
        page_path: t.page_name || "/",
        severity: t.severity,
        steps: t.steps.map(s => ({
          action: s.action,
          target: s.selector || "",
          value: s.value || "",
          assertion: s.description || ""
        }))
      } as any));
      return baselineApi.syncTests(repoId, mapped, "live_runner");
    },
    onSuccess: (res) => {
      toast.success(`${res.added_count} test${res.added_count === 1 ? "" : "s"} saved to the baseline.`);
      void queryClient.invalidateQueries({ queryKey: ["pipeline-baseline-tests", repoUrl] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      toast.error(typeof detail === "string" && detail ? `Could not save tests to the baseline: ${detail}` : "Could not save tests to the baseline.");
    },
  });
  const hasCommittedTests = sessionTests.length > 0;
  const mergedTestsCount = sessionTests.length + selectedBaselineIds.size;
  const [mode, setMode] = useState<"committed" | "new">(hasCommittedTests ? "committed" : "new");

  const handleRunComplete = (summary: { passed: number; failed: number; total: number; pass_rate: number }) => {
    setLiveTestSummary(summary);
  };

  const getCombinedTests = (): WorkspacePlaywrightTest[] => {
    const baselineMapped: WorkspacePlaywrightTest[] = baselineTests
      .filter(bt => selectedBaselineIds.has(bt.test_id))
      .map(bt => ({
        id: bt.test_id,
        analysis_id: "baseline",
        name: bt.name,
        description: bt.description,
        page_name: bt.page_path || "/",
        severity: bt.severity,
        steps: bt.steps.map(s => ({
          action: s.action,
          selector: s.target,
          value: s.value,
          description: s.assertion || ""
        })),
        source: "baseline"
      } as any));
    return [...sessionTests, ...baselineMapped];
  };

  const combinedTests = getCombinedTests();
  const [baselineSearch, setBaselineSearch] = useState("");
  const [activePageFilter, setActivePageFilter] = useState<string>("All");

  const filteredBaselines = baselineTests.filter(bt => {
    const matchSearch = bt.name.toLowerCase().includes(baselineSearch.toLowerCase()) || 
                      bt.description?.toLowerCase().includes(baselineSearch.toLowerCase());
    const matchPage = activePageFilter === "All" || bt.page_path === activePageFilter;
    return matchSearch && matchPage;
  });

  const uniquePages = Array.from(new Set(baselineTests.map(t => t.page_path || "/"))).sort();

  return (
    <div className="flex flex-col h-full bg-container overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-11 items-center justify-between border-b border-stroke-muted px-4 flex-shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className={eyebrow}>Live tests</span>
          {deployedUrl && (
            <a
              href={deployedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-ink-secondary transition-colors hover:text-ink"
            >
              <span className="truncate">{deployedUrl.replace("https://", "").split("/")[0]}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => goToStage(3)}>
            Back
          </Button>
          {liveTestSummary && (
            <Button size="sm" className="h-8 text-xs" onClick={() => completeStage(4)}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* Mode choice & Baseline Toggle */}
      {hasCommittedTests && (
        <div className="flex flex-col gap-3 border-b border-stroke-muted px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={mode === "committed"}
                  onClick={() => setMode("committed")}
                  className={cn(pill, mode === "committed" ? pillOn : pillOff)}
                >
                  Tests from this session
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "new"}
                  onClick={() => setMode("new")}
                  className={cn(pill, mode === "new" ? pillOn : pillOff)}
                >
                  Generate new tests
                </button>
              </div>

              {baselineTests.length > 0 && mode === "committed" && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="baseline-toggle"
                    checked={selectedBaselineIds.size > 0}
                    onCheckedChange={(checked) => {
                      if (checked) setShowSyncModal(true);
                      else {
                        setSelectedBaselineIds(new Set());
                        toast.info("Baseline tests removed from this run.");
                      }
                    }}
                  />
                  <Label htmlFor="baseline-toggle" className="cursor-pointer text-xs text-ink-secondary">
                    Include baseline tests
                  </Label>
                  <span className="text-xs tabular-nums text-ink-tertiary">{selectedBaselineIds.size} selected</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {mode === "committed" && (
                <span className="text-xs tabular-nums text-ink-tertiary">{mergedTestsCount} tests in this run</span>
              )}
              {sessionTests.length > 0 && mode === "committed" && (
                <Button
                   variant="outline"
                   size="sm"
                   className="h-8 gap-1.5 text-xs"
                   title={repoUrl ? "Save this session's tests to the repository baseline." : "No repository is connected."}
                   disabled={!repoUrl || saveBaselineMutation.isPending}
                   onClick={(e) => {
                     e.stopPropagation();
                     saveBaselineMutation.mutate();
                   }}
                 >
                   {saveBaselineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                   {saveBaselineMutation.isPending ? "Saving…" : "Save to baseline"}
                 </Button>
              )}
            </div>
          </div>

          {mode === "committed" && baselineQuery.isLoading && (
            <p className="flex items-center gap-2 text-xs text-ink-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading saved baseline tests…
            </p>
          )}
          {mode === "committed" && baselineQuery.isError && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3 py-2">
              <p className="min-w-0 flex-1 text-xs text-destructive">Could not load the saved baseline tests for this repository.</p>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => baselineQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {baselineTests.length > 0 && mode === "committed" && selectedBaselineIds.size === 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-raised px-3 py-2">
              <p className="min-w-0 flex-1 text-xs text-ink-secondary">
                <span className="tabular-nums text-ink">{baselineTests.length}</span> saved baseline tests exist for this repository. Turn on "Include baseline tests" to choose some, or add them all.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)));
                  toast.success("All baseline tests added to this run.");
                }}
              >
                Add all
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {mode === "committed" && hasCommittedTests ? (
          <div className="space-y-4 p-4">
            <UnifiedTestIntelligence tests={combinedTests} />
            <CommittedTestsRunner
              tests={combinedTests}
              defaultTargetUrl={deployedUrl || ""}
              onRunComplete={handleRunComplete}
            />
          </div>
        ) : (
          <div className="p-4">
            <LiveTestRunner
              embedded
              onRunComplete={handleRunComplete}
              initialGithubUrl={repoUrl || undefined}
              initialAppUrl={deployedUrl || undefined}
            />
          </div>
        )}
      </div>

      <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden border-stroke-muted rounded-lg">
          <div className="border-b border-stroke-muted p-4">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-ink">Baseline tests for this repository</DialogTitle>
              <DialogDescription className="text-sm text-ink-tertiary">
                Select saved baseline tests to run together with this session's tests.
              </DialogDescription>
            </DialogHeader>

              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-quaternary" />
                  <Input
                    placeholder="Filter by name or description"
                    className="pl-9"
                    value={baselineSearch}
                    onChange={(e) => setBaselineSearch(e.target.value)}
                  />
                </div>

                <Select value={activePageFilter} onValueChange={setActivePageFilter}>
                  <SelectTrigger className="w-[240px]">
                    <SelectValue placeholder="Filter by page" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All pages</SelectItem>
                    {uniquePages.map(page => (
                      <SelectItem key={page} value={page}>
                        {page === "/" ? "App root" : page.replace(/^\//, "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
          </div>

          <div className="px-4 py-4">
            <ScrollArea className="h-[500px] pr-4">
              <div className="space-y-3">
                {filteredBaselines.length === 0 ? (
                  <EmptyState kind="noResults">
                    No baseline tests match this filter.
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredBaselines.map(bt => {
                      const isSelected = selectedBaselineIds.has(bt.test_id);
                      return (
                        <div 
                          key={bt.test_id} 
                          className={cn(
                            "flex items-start gap-3 px-4 py-3 rounded-lg border transition-colors cursor-pointer",
                            isSelected 
                              ? "bg-raised-2 border-stroke" 
                              : "bg-container border-stroke-muted hover:bg-raised"
                          )}
                          onClick={() => {
                            setSelectedBaselineIds(prev => {
                              const next = new Set(prev);
                              if (next.has(bt.test_id)) next.delete(bt.test_id);
                              else next.add(bt.test_id);
                              return next;
                            });
                          }}
                        >
                          <Checkbox 
                            id={bt.test_id} 
                            checked={isSelected}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 truncate text-sm font-medium text-ink">
                                {bt.name}
                              </span>
                              <StatusBadge
                                tone={bt.severity.toLowerCase() === "critical" ? "critical" : bt.severity.toLowerCase() === "high" ? "warning" : "neutral"}
                                className="capitalize"
                              >
                                {bt.severity}
                              </StatusBadge>
                            </div>
                            <p className="font-mono text-xs text-ink-tertiary">{bt.page_path || "/"}</p>
                            {bt.description && (
                              <p className="text-xs text-ink-tertiary line-clamp-1">{bt.description}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-stroke-muted px-4 py-3">
            <span className="text-sm text-ink-secondary">
              <span className="tabular-nums text-ink">{selectedBaselineIds.size}</span> selected
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedBaselineIds(new Set())}>
              Clear selection
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)))}>
              Select all
            </Button>
            <Button className="ml-auto" onClick={() => setShowSyncModal(false)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
