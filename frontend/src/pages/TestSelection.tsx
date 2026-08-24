import { useState } from "react";
import { motion } from "framer-motion";
import { ListFilter, Sparkles, Clock, Layers, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/PageShell";
import { PageHeader, PageStat } from "@/components/PageHeader";
import {
  useTestSelectionHistory, useAnalyzeTestSelection,
  useExecuteTestSelection, useTestOptimizationReport,
} from "@/hooks/use-test-selection";

const PRIORITY_STYLE: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-500",
  high: "border-[var(--color-status-warning)]/30 bg-[var(--color-status-warning)]/10 text-[var(--color-warning)]",
  medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  low: "border-muted-foreground/30 bg-muted/20 text-muted-foreground",
};

export default function TestSelection() {
  const [repoId, setRepoId] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [oldSha, setOldSha] = useState("");
  const [newSha, setNewSha] = useState("");
  const [targetUrl, setTargetUrl] = useState("");

  const { data: history } = useTestSelectionHistory();
  const analyzeMutation = useAnalyzeTestSelection();
  const latestRun = analyzeMutation.data ?? history?.runs?.[0];
  const executeMutation = useExecuteTestSelection(latestRun?.id ?? "");
  const { data: optimization } = useTestOptimizationReport(repoId || latestRun?.repo_id);

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <PageHeader
          icon={ListFilter}
          title="Intelligent Test Selection"
          description="Skip the full suite. AI maps your changed files to the tests that actually cover them, explains why, and runs only what matters."
        />
      </motion.div>

      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Current Change</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Input placeholder="Repo ID (baseline repo_id)" value={repoId} onChange={(e) => setRepoId(e.target.value)} />
          <Input placeholder="GitHub URL" value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} />
          <Input placeholder="Old commit SHA (optional)" value={oldSha} onChange={(e) => setOldSha(e.target.value)} />
          <Input placeholder="New commit SHA (optional)" value={newSha} onChange={(e) => setNewSha(e.target.value)} />
        </div>
        <Button
          className="mt-4"
          disabled={!repoId || !githubUrl || analyzeMutation.isPending}
          onClick={() => analyzeMutation.mutate({ repoId, githubUrl, oldSha: oldSha || undefined, newSha: newSha || undefined })}
        >
          {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
        </Button>
        {analyzeMutation.isError && (
          <p className="mt-2 text-xs text-destructive">Could not analyze this repo/commit range check the repo ID and URL.</p>
        )}
      </div>

      {latestRun && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <PageStat icon={Layers} label="Total Tests" value={latestRun.summary.total_tests} accent="primary" />
            <PageStat icon={Sparkles} label="Selected Tests" value={latestRun.summary.selected_tests} accent="success" />
            <PageStat icon={ListFilter} label="Skipped Tests" value={latestRun.summary.skipped_tests} accent="warning" />
            <PageStat
              icon={Clock}
              label="Estimated Savings"
              value={latestRun.summary.estimated_savings_pct != null ? `${latestRun.summary.estimated_savings_pct}%` : "Not available"}
              accent="destructive"
            />
          </div>

          {!latestRun.diff_available && (
            <div className="floating-card border-yellow-500/30 bg-yellow-500/5 p-4 text-xs text-yellow-700">
              No commit diff was available (missing SHAs, or this is the first scan) the full suite was selected as a safe fallback.
            </div>
          )}

          <div className="floating-card p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[13px] font-semibold tracking-tight">Selected Tests</h2>
              <div className="flex items-center gap-2">
                <Input placeholder="Target app URL to run against" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className="w-64" />
                <Button
                  size="sm"
                  disabled={!targetUrl || executeMutation.isPending}
                  onClick={() => executeMutation.mutate(targetUrl)}
                >
                  {executeMutation.isPending ? "Starting…" : "Execute Selected"}
                </Button>
              </div>
            </div>
            {executeMutation.isSuccess && (
              <p className="mt-2 text-xs text-emerald-500">Execution started ({executeMutation.data.test_count} tests, run {executeMutation.data.run_id.slice(0, 8)}) check Live Test Runner for progress.</p>
            )}
            {executeMutation.isError && (
              <p className="mt-2 text-xs text-destructive">Could not start execution.</p>
            )}
            <div className="mt-4 space-y-2">
              {latestRun.tests.map((t) => (
                <div key={t.test_id} className={`rounded-lg border px-4 py-3 ${t.selected ? "border-border/30 bg-muted/10" : "border-border/10 opacity-60"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{t.name}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={PRIORITY_STYLE[t.priority]}>{t.priority}</Badge>
                      <span className="text-xs font-semibold text-muted-foreground">{t.score}</span>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    {t.reasons.map((r, i) => (
                      <p key={i} className={`text-xs ${r.matched ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {r.matched ? "✓" : "○"} {r.label}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {optimization && (
        <div className="floating-card p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight">Test Suite Optimization</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Potential Duplicates</p><p className="font-medium">{optimization.potential_duplicates}</p></div>
            <div><p className="text-xs text-muted-foreground">Coverage Gaps</p><p className="font-medium">{optimization.coverage_gaps}</p></div>
            <div><p className="text-xs text-muted-foreground">Flaky Tests</p><p className="font-medium">{optimization.flaky_tests ?? "Not available"}</p></div>
            <div><p className="text-xs text-muted-foreground">Long-Running Tests</p><p className="font-medium">{optimization.long_running_tests ?? "Not available"}</p></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Optimization opportunity: <span className="font-semibold uppercase">{optimization.optimization_opportunity}</span></p>
          <div className="mt-4 space-y-2">
            {optimization.findings.filter(f => f.available).map((f, i) => (
              <div key={i} className="rounded-lg border border-border/20 bg-muted/10 px-3 py-2 text-xs">{f.description}</div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
