import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileCode,
  FlaskConical,
  Play,
  Loader2,
  Globe,
  AlertTriangle,
  Zap,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  Layers,
  ExternalLink,
  ArrowLeft,
  Info,
  Search,
  Code2,
  Check,
  ChevronUp,
  ArrowUpCircle,
  Plus,
  Database,
  Filter,
} from "lucide-react";
import { AiIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { usePipelineContext } from "@/context/PipelineContext";
import LiveTestRunner from "@/pages/LiveTestRunner";
import { cn } from "@/lib/utils";
import { useLiveTesting } from "@/hooks/use-live-testing";
import { api, baselineApi, type WorkspacePlaywrightTest, type PlaywrightTestCase, type TestStep, type LiveTestResult, type BaselineTest } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { downloadLiveTestReport } from "@/lib/pdf-report";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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
  const [testPassword, setTestPassword] = useState("1234567890");
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
      <div className="space-y-6">
        <div className="rounded-[2.5rem] border border-primary/20 bg-primary/5 p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
             <Database className="h-24 w-24 text-primary" />
          </div>
          <div className="flex items-center gap-4 mb-6 relative">
            <div className="p-3 rounded-2xl bg-primary/20 border border-primary/30 shadow-inner">
               <Zap className="h-6 w-6 text-primary fill-current" />
            </div>
            <div>
              <h3 className="text-lg font-black uppercase tracking-tight text-primary">Execution Environment</h3>
              <p className="text-xs text-muted-foreground font-medium">Verify {tests.length} intelligence units against the target system</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-1">Target Cluster URL</label>
              <div className="relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/40" />
                <Input
                  placeholder="https://your-app.vercel.app"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  className="h-12 pl-12 bg-background border-border/40 rounded-2xl shadow-sm focus-visible:ring-primary/20 transition-all font-medium"
                />
              </div>
              {isLocalhost && (
                <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-yellow-500/20 p-3 mt-2">
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-800/80 leading-relaxed font-medium">
                    Internal cluster detected. Ensure the application is accessible from the simulation engine's bridge.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-[2rem] border border-border/40 bg-background/40 p-6 backdrop-blur-sm shadow-inner">
              <p className="text-[10px] font-black text-foreground/70 uppercase tracking-[0.2em] ml-1">Access Protocol</p>
              <div className="grid grid-cols-1 gap-3">
                <Input
                  type="email"
                  placeholder="Simulation Identity (Email)"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="h-11 bg-background/50 border-border/30 rounded-xl font-medium"
                />
                <Input
                  type="password"
                  placeholder="Access Key"
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  className="h-11 bg-background/50 border-border/30 rounded-xl font-medium"
                />
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-6 flex items-start gap-3 rounded-[1.5rem] bg-red-50 border border-red-500/20 p-4 animate-in fade-in slide-in-from-top-2">
              <AlertTriangle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{errorMsg}</p>
            </div>
          )}

          <Button
            className="mt-8 w-full h-14 rounded-2xl shadow-[0_15px_40px_rgba(var(--primary),0.25)] font-black uppercase tracking-[0.15em] text-sm group"
            disabled={!canRun}
            onClick={() => handleExecuteDirect(tests, targetUrl.trim(), testEmail || undefined, testPassword || undefined)}
          >
            {isExecutingDirect ? (
              <><Loader2 className="h-5 w-5 mr-3 animate-spin" />Initialising Simulation...</>
            ) : (
              <><Play className="h-5 w-5 mr-3 fill-current group-hover:scale-110 transition-transform" />Trigger Intelligence Suite</>
            )}
          </Button>
        </div>
      </div>
    );
  }

  if (!runStatus) {
    return (
      <div className="flex flex-col items-center py-24 gap-4 animate-pulse">
        <div className="p-4 rounded-3xl bg-primary/10 border border-primary/20">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
        <p className="text-sm font-black text-muted-foreground uppercase tracking-widest">Wait for Engine Bootstrap...</p>
      </div>
    );
  }

  const { results, total, passed, failed, status } = runStatus;
  const completedCount = results.filter((r) => r.status === "passed" || r.status === "failed").length;
  const progressPercent = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const successRatePercent = total > 0 ? Math.round((passed / total) * 100) : 0;

  const activeRunningTest = results.find((r) => r.status === "running");
  const latestFrame = activeRunningTest?.step_results.slice().reverse().find((s) => s.screenshot)?.screenshot ?? null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
      {/* Simulation Monitor */}
      <div className="rounded-[3rem] border border-border/50 bg-black overflow-hidden shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-3 px-6 py-4 bg-zinc-900 border-b border-border/30">
          <div className="flex gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500/70 shadow-[0_0_10px_rgba(239,68,68,0.4)]" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/70 shadow-[0_0_10px_rgba(234,179,8,0.4)]" />
            <div className="h-3 w-3 rounded-full bg-primary/70 shadow-[0_0_10px_rgba(255,161,43,0.4)]" />
          </div>
          <div className="flex-1 mx-4 bg-zinc-800/50 rounded-xl px-4 py-1.5 text-[11px] text-muted-foreground font-mono truncate border border-zinc-700/50">
            {activeRunningTest ? `Active Observer: ${activeRunningTest.test_name}` : "Playwright Simulation Engine"}
          </div>
          {status === "running" && (
            <div className="flex items-center gap-2.5 text-[10px] text-amber-700 font-black bg-yellow-400/10 px-3 py-1 rounded-full border border-yellow-400/20 tracking-widest uppercase">
              <span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
              Live Feed
            </div>
          )}
        </div>
        <div className="relative aspect-video bg-zinc-950 flex items-center justify-center min-h-[400px]">
          <AnimatePresence mode="wait">
            {latestFrame ? (
              <motion.img
                key={latestFrame.slice(-20)}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                src={`data:image/png;base64,${latestFrame}`}
                alt="Live browser feed"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 text-muted-foreground text-center max-w-xs animate-in zoom-in-95 duration-500">
                <div className="p-5 rounded-full bg-muted/10 border border-border/20 mb-2">
                  <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
                </div>
                <p className="text-sm font-black uppercase tracking-widest opacity-60">Synchronizing Visual Clusters...</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         <div className="lg:col-span-2 rounded-[2.5rem] border border-border/40 bg-card/60 backdrop-blur-md p-8 shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-8 relative">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "p-3 rounded-2xl border transition-all duration-500",
                  status === "running" ? "bg-amber-50 border-amber-200 animate-pulse" : "bg-positive/10 border-positive/25"
                )}>
                  {status === "running" ? (
                    <Loader2 className="h-6 w-6 animate-spin text-amber-700" />
                  ) : (
                    <CheckCircle2 className="h-6 w-6 text-positive" />
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground/60 mb-0.5">Simulation Vector</p>
                  <p className="text-lg font-black uppercase tracking-tight">
                    {status === "running" ? `Infiltrating Unit ${completedCount + 1} of ${total}` : "Protocol Fully Validated"}
                  </p>
                </div>
              </div>
              {phase === "done" && (
                <div className="flex items-center gap-3">
                  <Button 
                    variant="outline" 
                    className="h-12 px-6 rounded-2xl border-border/40 bg-background/50 hover:bg-background font-black uppercase tracking-widest text-[10px] shadow-sm transform hover:scale-105 transition-all"
                    onClick={() => downloadLiveTestReport(runStatus!)}
                  >
                    <Download className="h-4 w-4 mr-2.5 text-primary" /> Export Intelligence
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="h-12 w-12 rounded-2xl border border-border/20 hover:bg-muted/40 transition-all p-0"
                    onClick={reset}
                  >
                    <RotateCcw className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                <span>Network Coverage</span>
                <span className="text-primary font-bold">{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-3 rounded-full bg-muted/30 shadow-inner" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Validated", value: passed, icon: CheckCircle2, color: "text-positive", bg: "bg-primary/5" },
                { label: "Friction", value: failed, icon: AlertTriangle, color: "text-red-700", bg: "bg-red-400/5" },
                { label: "Resolved", value: completedCount, icon: Play, color: "text-primary", bg: "bg-primary/5" },
              ].map((stat) => (
                <div key={stat.label} className={cn("p-5 rounded-3xl border border-border/20 backdrop-blur-sm transition-all hover:border-border/40", stat.bg)}>
                  <div className="flex items-center justify-between mb-2">
                    <stat.icon className={cn("h-4 w-4", stat.color)} />
                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/60">{stat.label}</span>
                  </div>
                  <p className="text-3xl font-black tabular-nums tracking-tighter">{stat.value}</p>
                </div>
              ))}
            </div>
         </div>

         <div className="rounded-[2.5rem] border border-border/40 bg-gradient-to-br from-primary/10 to-primary/5 p-8 flex flex-col justify-center items-center text-center backdrop-blur-md shadow-2xl relative overflow-hidden group">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(var(--primary),0.15),transparent)] opacity-50 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="relative space-y-4">
              <div className="p-5 rounded-full bg-background/50 border border-primary/20 shadow-2xl inline-block mb-2 transform group-hover:scale-110 transition-transform duration-700">
                <AiIcon className="h-10 w-10 text-primary animate-pulse" />
              </div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-primary/70">{total} Active Units</p>
              <div className="space-y-1">
                <p className="text-6xl font-black tabular-nums tracking-tighter text-primary">
                  {status === "running" ? Math.round(progressPercent) : successRatePercent}
                  <span className="text-2xl ml-1 text-primary/60">%</span>
                </p>
                <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">
                  {status === "running" ? "Cluster Progress" : "Accuracy Rating"}
                </p>
              </div>
            </div>
         </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
             <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
             <h2 className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.25em]">Sub-Unit Stream</h2>
          </div>
          <div className="flex items-center gap-8">
             <div className="flex items-center gap-2 group">
                <span className="text-[10px] font-black text-muted-foreground group-hover:text-positive transition-colors tracking-widest uppercase">Verified</span>
                <span className="text-xl font-black tabular-nums text-positive">{passed}</span>
             </div>
             <div className="flex items-center gap-2 group">
                <span className="text-[10px] font-black text-muted-foreground group-hover:text-red-700 transition-colors tracking-widest uppercase">Friction</span>
                <span className="text-xl font-black tabular-nums text-red-700">{failed}</span>
             </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results.map((r) => <MiniTestCard key={r.test_id} result={r} />)}
        </div>
      </div>
    </motion.div>
  );
}

// ── Mini live test card ────────────────────────────────────────────────────────

function MiniTestCard({ result }: { result: LiveTestResult }) {
  const [open, setOpen] = useState(false);
  const icon = {
    running: <Loader2 className="h-4 w-4 animate-spin text-amber-700" />,
    passed: <CheckCircle2 className="h-4 w-4 text-positive" />,
    failed: <XCircle className="h-4 w-4 text-red-700" />,
    pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  }[result.status];

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="flex-1 text-sm font-medium truncate">{result.test_name}</span>
        {result.duration_ms && (
          <span className="text-[11px] text-muted-foreground mr-1">
            {(result.duration_ms / 1000).toFixed(1)}s
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {result.steps_completed}/{result.total_steps} steps
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-1" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5">
              {result.error && (
                <div className="flex items-start gap-2 rounded bg-red-50 border border-red-500/20 p-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">{result.error}</p>
                </div>
              )}
              {result.step_results.map((sr, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-xs rounded p-1.5 ${
                    sr.status === "fail" ? "bg-red-50 border border-red-500/20" : "bg-muted/30"
                  }`}
                >
                  {sr.status === "pass" ? (
                    <CheckCircle2 className="h-3 w-3 text-positive mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3 w-3 text-red-700 mt-0.5 flex-shrink-0" />
                  )}
                  <span className="text-muted-foreground flex-1">{sr.step_description}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── StageTestRunner ────────────────────────────────────────────────────────────

export function StageTestRunner() {
  const { liveTestSummary, setLiveTestSummary, testSuite, repoUrl, deployedUrl, completeStage, goToStage } = usePipelineContext();
  const [baselineTests, setBaselineTests] = useState<BaselineTest[]>([]);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [selectedBaselineIds, setSelectedBaselineIds] = useState<Set<string>>(new Set());
  const [isLoadingBaseline, setIsLoadingBaseline] = useState(false);

  useEffect(() => {
    if (!repoUrl) return;
    (window as any).__REPO_URL__ = repoUrl;
    const fetchBaseline = async () => {
      setIsLoadingBaseline(true);
      try {
        const repoId = await api.getRepoId(repoUrl);
        const data = await baselineApi.getRepoTests(repoId);
        setBaselineTests(data.tests);
        // Initially empty for the toggle flow
      } catch (err) {
        console.error("Failed to fetch baseline:", err);
      } finally {
        setIsLoadingBaseline(false);
      }
    };
    fetchBaseline();
  }, [repoUrl]);

  const sessionTests = testSuite.map(t => ({ ...t, source: "session" }));
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
    <div className="flex flex-col h-full bg-background/50 overflow-hidden">
      {/* Banner */}
      <div className="flex items-center justify-between px-6 py-4 bg-card border-b border-border/50 flex-shrink-0 backdrop-blur-md">
        <div className="flex items-center gap-4 text-xs text-muted-foreground min-w-0">
          <div className="flex items-center gap-2.5 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            <span className="font-black uppercase tracking-widest text-[9px]">Engine Status: Active</span>
          </div>
          <span className="hidden md:inline font-medium opacity-60">High-fidelity automation environment for Playwright clusters.</span>
          {deployedUrl && (
            <div className="h-4 w-px bg-border/50 hidden md:block" />
          )}
          {deployedUrl && (
            <a
              href={deployedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 flex-shrink-0 font-bold bg-primary/5 px-3 py-1 rounded-lg border border-primary/10"
            >
              <Globe className="h-3 w-3" />
              {deployedUrl.replace("https://", "").split("/")[0]}
              <ExternalLink className="h-3 w-3 ml-0.5 opacity-50" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-3 ml-4">
          <Button variant="ghost" size="sm" className="h-9 px-4 text-[11px] font-black uppercase tracking-widest text-muted-foreground hover:bg-muted/50 rounded-xl" onClick={() => goToStage(3)}>
            <ArrowLeft className="h-3.5 w-3.5 mr-2" /> Back
          </Button>
          {liveTestSummary && (
            <Button size="sm" className="h-9 px-5 text-[11px] font-black uppercase tracking-widest shadow-xl shadow-primary/10 rounded-xl" onClick={() => completeStage(4)}>
              Review Analysis <ArrowRight className="h-3.5 w-3.5 ml-2" />
            </Button>
          )}
        </div>
      </div>

      {/* Mode choice & Baseline Toggle */}
      {hasCommittedTests && (
        <div className="flex flex-col px-8 py-5 bg-muted/5 border-b border-border/30 gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <div className="flex rounded-2xl border border-border/50 bg-background/80 p-1.5 gap-1.5 shadow-sm">
                <button
                  onClick={() => setMode("committed")}
                  className={cn(
                    "flex items-center gap-2.5 px-6 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all",
                    mode === "committed"
                      ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 scale-[1.02]"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  <Zap className={cn("h-3.5 w-3.5", mode === "committed" ? "fill-current" : "")} />
                  Production Deck
                </button>
                <button
                  onClick={() => setMode("new")}
                  className={cn(
                    "flex items-center gap-2.5 px-6 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all",
                    mode === "new"
                      ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 scale-[1.02]"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  <AiIcon className={cn("h-3.5 w-3.5", mode === "new" ? "opacity-100" : "")} />
                  Vibe Growth
                </button>
              </div>

              {baselineTests.length > 0 && mode === "committed" && (
                <div className="flex items-center gap-4 pl-4 border-l border-border/20">
                  <div className="flex flex-col">
                    <Label htmlFor="baseline-toggle" className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 mb-1.5 cursor-pointer">
                      Integrate Baseline
                    </Label>
                    <div className="flex items-center gap-3">
                      <Switch 
                        id="baseline-toggle" 
                        checked={selectedBaselineIds.size > 0}
                        onCheckedChange={(checked) => {
                          if (checked) setShowSyncModal(true);
                          else {
                            setSelectedBaselineIds(new Set());
                            toast.info("Repo baseline tests detached from current run.");
                          }
                        }}
                      />
                      <span className="text-[10px] font-bold text-muted-foreground/40">{selectedBaselineIds.size} Units Included</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-6">
              {sessionTests.length > 0 && mode === "committed" && (
                <Button 
                   variant="outline" 
                   size="sm" 
                   className="h-10 text-[10px] gap-2.5 text-orange-700 border-orange-500/20 hover:bg-orange-50 font-black uppercase tracking-widest px-5 rounded-[1.25rem] transition-all hover:border-orange-500/40"
                   onClick={async (e) => {
                     e.stopPropagation();
                     const repoUrl = (window as any).__REPO_URL__;
                     if (!repoUrl) return toast.error("Repo context invalid");
                     try {
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
                       const res = await baselineApi.syncTests(repoId, mapped, "live_runner");
                       toast.success(`Pipeline success: ${res.added_count} units promoted!`);
                       window.location.reload(); 
                     } catch (err) {
                       toast.error("Promotion failed");
                     }
                   }}
                 >
                   <ArrowUpCircle className="h-4 w-4" />
                   Sync Session
                 </Button>
              )}
              {mode === "committed" && (
                <div className="bg-primary/10 border border-primary/20 px-5 py-2.5 rounded-2xl flex flex-col items-end min-w-[120px]">
                  <span className="text-[9px] font-black text-primary uppercase tracking-[0.2em] opacity-70">Total Load</span>
                  <span className="text-xl font-black text-primary tracking-tighter">{mergedTestsCount}<span className="text-[10px] font-bold ml-1 opacity-50 uppercase">Units</span></span>
                </div>
              )}
            </div>
          </div>
          
          {baselineTests.length > 0 && mode === "committed" && selectedBaselineIds.size === 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              className="flex items-center gap-5 py-4 px-6 bg-primary/5 border border-primary/20 rounded-3xl overflow-hidden shadow-sm"
            >
              <div className="p-3 w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex flex-col items-center justify-center">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-[11px] font-black text-primary uppercase tracking-widest mb-1">
                  Baseline Synergy Detected
                </p>
                <p className="text-[10px] text-muted-foreground/80 font-medium max-w-md">
                  Found <span className="text-primary font-bold">{baselineTests.length} legacy testcases</span> in the centralized repository baseline. Enable "Integrate Baseline" to augment your current session intelligence.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                  variant="link" 
                  className="h-8 text-[11px] text-primary font-black uppercase tracking-widest p-0 group"
                  onClick={() => {
                    setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)));
                    toast.success("Synergetic integration active: All units attached.");
                  }}
                >
                  Quick Attach All <ChevronRight className="h-3.5 w-3.5 ml-1 transition-transform group-hover:translate-x-1" />
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {mode === "committed" && hasCommittedTests ? (
          <div className="p-8 space-y-10 max-w-7xl mx-auto">
            <UnifiedTestIntelligence tests={combinedTests} />
            <CommittedTestsRunner
              tests={combinedTests}
              defaultTargetUrl={deployedUrl || ""}
              onRunComplete={handleRunComplete}
            />
          </div>
        ) : (
          <LiveTestRunner
            onRunComplete={handleRunComplete}
            initialGithubUrl={repoUrl || undefined}
            initialAppUrl={deployedUrl || undefined}
          />
        )}
      </div>

      <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden border-border/40 shadow-2xl backdrop-blur-3xl rounded-[2.5rem]">
          <div className="p-8 bg-primary/5 border-b border-border/20">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-4 text-xl font-black uppercase tracking-widest">
                <div className="p-2.5 rounded-2xl bg-primary/10 border border-primary/20 shadow-inner">
                  <Layers className="h-6 w-6 text-primary" />
                </div>
                Repo Baseline Inventory
              </DialogTitle>
              <DialogDescription className="text-muted-foreground/70 font-medium ml-14">
                Query and segment existing intelligence units from the global baseline to augment your current simulation suite.
              </DialogDescription>
            </DialogHeader>

              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-primary/40" />
                  <Input 
                    placeholder="Query repository baseline by identity or description..." 
                    className="pl-12 h-12 bg-background border-border/40 rounded-2xl shadow-sm focus-visible:ring-primary/20 transition-all font-medium text-sm"
                    value={baselineSearch}
                    onChange={(e) => setBaselineSearch(e.target.value)}
                  />
                </div>
                
                <Select value={activePageFilter} onValueChange={setActivePageFilter}>
                  <SelectTrigger className="w-[240px] h-12 bg-background border-border/40 rounded-2xl shadow-sm focus:ring-primary/20 font-black uppercase tracking-widest text-[10px]">
                    <div className="flex items-center gap-2">
                       <Filter className="h-3.5 w-3.5 text-primary/60" />
                       <SelectValue placeholder="Segment by Page" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border-border/40 shadow-2xl backdrop-blur-xl">
                    <SelectItem value="All" className="text-[10px] font-black uppercase tracking-widest py-3">Global Stream</SelectItem>
                    {uniquePages.map(page => (
                      <SelectItem key={page} value={page} className="text-[10px] font-black uppercase tracking-widest py-3">
                        {page === "/" ? "App Root" : page.replace(/^\//, "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
          </div>

          <div className="px-8 py-6">
            <ScrollArea className="h-[500px] pr-6">
              <div className="space-y-3 ml-14">
                {filteredBaselines.length === 0 ? (
                  <div className="py-24 text-center space-y-4">
                    <div className="p-4 w-16 h-16 rounded-3xl bg-muted/20 border border-dashed border-border mx-auto flex items-center justify-center">
                      <Search className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">Zero Units Resolved</p>
                      <p className="text-xs text-muted-foreground/60 font-medium">Refine your query parameters to discover baseline intelligence.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredBaselines.map(bt => {
                      const isSelected = selectedBaselineIds.has(bt.test_id);
                      return (
                        <div 
                          key={bt.test_id} 
                          className={cn(
                            "group relative flex items-start gap-4 p-5 rounded-[1.75rem] border transition-all cursor-pointer",
                            isSelected 
                              ? "bg-primary/5 border-primary/40 shadow-inner" 
                              : "bg-muted/5 border-border/40 hover:border-primary/20 hover:bg-muted/10"
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
                            className={cn(
                              "mt-1 rounded-md transition-transform duration-300",
                              isSelected && "scale-110"
                            )}
                          />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-3">
                              <span className="text-[13px] font-black truncate text-foreground/90 uppercase tracking-tight">
                                {bt.name}
                              </span>
                              <Badge variant="outline" className={cn(
                                "text-[8px] h-4 px-1.5 uppercase font-black shrink-0 tracking-widest rounded-md",
                                bt.severity.toLowerCase() === "critical" ? "border-red-500/50 text-red-700 bg-red-400/5" :
                                bt.severity.toLowerCase() === "high" ? "border-orange-500/50 text-orange-700 bg-orange-400/5" :
                                "border-muted-foreground/30 text-muted-foreground"
                              )}>
                                {bt.severity.slice(0, 3)}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2.5 text-[10px] text-muted-foreground/60 font-medium">
                              <div className="flex items-center gap-1.5 bg-muted/30 px-2 py-0.5 rounded-lg font-mono text-[9px] border border-border/10">
                                <Code2 className="h-3 w-3 opacity-40" />
                                {bt.page_path || "/"}
                              </div>
                            </div>
                            {bt.description && (
                                <p className="text-[10px] text-muted-foreground/50 italic line-clamp-1 border-l border-border/20 pl-2">{bt.description}</p>
                            )}
                          </div>
                          {isSelected && (
                            <motion.div 
                              initial={{ scale: 0 }} 
                              animate={{ scale: 1 }}
                              className="absolute -right-1 -top-1"
                            >
                              <div className="bg-primary text-primary-foreground h-5 w-5 p-0 flex items-center justify-center rounded-full border-2 border-background shadow-2xl">
                                <Check className="h-2.5 w-2.5 stroke-[3]" />
                              </div>
                            </motion.div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="p-8 pt-4 bg-muted/20 border-t border-border/20 backdrop-blur-md">
            <div className="flex items-center justify-between mb-6 ml-14">
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.25em] mb-1">Queue Configuration</span>
                <div className="text-xs font-bold text-foreground">
                  <span className="text-primary text-lg font-black mr-1.5">{selectedBaselineIds.size}</span> Units selected for synchronization
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-background/80 rounded-xl px-4"
                  onClick={() => setSelectedBaselineIds(new Set())}
                >
                  Clear Suite
                </Button>
                <div className="w-px h-4 bg-border" />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 text-[10px] font-black uppercase tracking-widest text-primary hover:bg-primary/5 rounded-xl px-4"
                  onClick={() => setSelectedBaselineIds(new Set(baselineTests.map(t => t.test_id)))}
                >
                  Select All
                </Button>
              </div>
            </div>
            <div className="ml-14">
               <Button className="w-full font-black uppercase tracking-widest h-12 shadow-[0_10px_30px_rgba(var(--primary),0.2)] rounded-2xl text-[11px]" onClick={() => setShowSyncModal(false)}>
                Confirm Suite Composition
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
