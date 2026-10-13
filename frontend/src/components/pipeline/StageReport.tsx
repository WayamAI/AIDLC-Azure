import { Loader2, RotateCcw } from "lucide-react";
import { Mark } from "@/components/Mark";
import type { MarkId } from "@/lib/marks";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";
import { usePipelineContext } from "@/context/PipelineContext";
import { useEvaluatePipeline, usePipelineRuns } from "@/hooks/use-pipeline";
import { useQueryClient } from "@tanstack/react-query";
import type { PipelineRunSummary } from "@/lib/api";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

// Pipeline stage numbers (see PipelineStageBar).
const STAGE_CODE_REVIEW = 2;
const STAGE_LIVE_TESTS = 4;

function ScoreGauge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex h-[120px] w-[180px] flex-col items-center justify-center rounded-lg bg-raised text-center">
        <span className="text-sm font-medium text-ink">Not evaluated</span>
        <span className="mt-1 text-xs text-ink-tertiary">No score was computed</span>
      </div>
    );
  }
  const color = score >= 75 ? "var(--color-status-success)" : score >= 50 ? "var(--color-status-warning)" : "var(--color-status-critical)";
  return (
    <div className="relative flex items-center justify-center">
      <ResponsiveContainer width={180} height={180}>
        <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" startAngle={180} endAngle={0} data={[{ value: score, fill: color }]}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "hsl(var(--muted)/30)" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-6">
        <span className="font-display text-[28px] leading-tight tabular-nums text-ink">{score}</span>
        <span className="text-xs text-ink-tertiary">/ 100</span>
      </div>
    </div>
  );
}

/** Verdict label → its 3D mark. */
const VERDICT_MARK: Record<string, MarkId> = {
  GO: "mark-verdict-go",
  "NO-GO": "mark-verdict-no-go",
  CONDITIONAL: "mark-verdict-conditional",
  "INSUFFICIENT DATA": "mark-verdict-not-evaluated",
};

const VERDICT_CFG: Record<string, { tone: StatusTone; label: string; description: string }> = {
  "GO":          { tone: "success",  label: "GO",          description: "The score meets the GO threshold and no blocker was found." },
  "NO-GO":       { tone: "critical", label: "NO-GO",       description: "A blocker was found or the score is below the minimum. Do not release until it is resolved." },
  "CONDITIONAL": { tone: "warning",  label: "CONDITIONAL", description: "Release is possible only after addressing the listed conditions and re-validating." },
  "INSUFFICIENT_DATA": { tone: "neutral", label: "INSUFFICIENT DATA", description: "Neither a CI signal nor live-test results were available, so no score or verdict was computed." },
};

function verdictConfig(raw: unknown) {
  const key = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const normalised = key === "NO_GO" || key === "NOGO" ? "NO-GO" : key;
  return VERDICT_CFG[normalised] ?? {
    tone: "neutral" as StatusTone,
    label: key || "UNKNOWN",
    description: "The report returned a verdict this page does not recognise.",
  };
}

type SignalStatus = "ok" | "warn" | "fail" | "none";

const SIGNAL_LABELS: Record<string, string> = {
  ci_pass_rate: "CI pass rate",
  live_test_pass_rate: "Live test pass rate",
  review_recommendation: "Code review",
  open_critical_bugs: "Open critical bugs",
  unresolved_security_findings: "Critical review findings",
};

// How a review verdict is shown. The report endpoint takes the review stage's
// verdict as it is and returns it unchanged; reports saved by older clients
// carry GO / CONDITIONAL / NO-GO, so those are labelled too. Verdicts with
// status "none" are reported by the endpoint but not scored.
const REVIEW_SIGNAL: Record<string, { label: string; status: SignalStatus }> = {
  APPROVE:          { label: "Approved",                status: "ok" },
  GO:               { label: "Approved",                status: "ok" },
  REQUEST_CHANGES:  { label: "Changes requested",       status: "fail" },
  "NO-GO":          { label: "Changes requested",       status: "fail" },
  NO_GO:            { label: "Changes requested",       status: "fail" },
  COMMENT:          { label: "Commented, not blocking", status: "warn" },
  CONDITIONAL:      { label: "Conditional",             status: "warn" },
  INCOMPLETE:       { label: "Review incomplete",       status: "none" },
  NEEDS_DISCUSSION: { label: "Needs discussion",        status: "none" },
};

function reviewSignal(raw: unknown): { label: string; status: SignalStatus } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return REVIEW_SIGNAL[raw.trim().toUpperCase()] ?? { label: raw, status: "none" };
}

const NOT_EVALUATED = "Not evaluated";

const DOT: Record<SignalStatus, string> = {
  ok: "bg-status-success",
  warn: "bg-status-warning",
  fail: "bg-status-critical",
  none: "bg-status-neutral",
};

function VerdictLegend() {
  return (
    <div className="rounded-lg border border-stroke-muted bg-container text-left">
      <p className={`${eyebrow} border-b border-stroke-muted px-4 py-3`}>What each verdict means</p>
      {Object.values(VERDICT_CFG).map(({ tone, label, description }) => (
        <div key={label} className="flex items-start gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
          <StatusBadge tone={tone} className="w-[132px] justify-center">{label}</StatusBadge>
          <p className="text-xs text-ink-secondary leading-relaxed">{description}</p>
        </div>
      ))}
    </div>
  );
}

function errorDetail(err: unknown): string {
  const e = err as { response?: { data?: { detail?: unknown } }; message?: string } | null;
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return e?.message || "The report request failed.";
}

export function StageReport() {
  const {
    owner, repo, commitSha,
    reviewResult, liveTestSummary,
    reportResult, setReportResult,
    setLiveTestSummary,
    setReviewResult, setReviewStatus, setReviewCoverage,
    goToStage, resetPipeline,
  } = usePipelineContext();

  const evaluateMutation = useEvaluatePipeline();
  const runsQuery = usePipelineRuns();
  const queryClient = useQueryClient();

  const rawVerdict = reviewResult?.review?.recommendation;
  const reviewVerdict = typeof rawVerdict === "string" && rawVerdict.trim() ? rawVerdict.trim() : undefined;
  const reviewInput = reviewSignal(reviewVerdict);

  const handleGenerate = async () => {
    const criticalCount = reviewResult
      ? (reviewResult.review?.findings ?? []).filter((f) => f.severity?.toLowerCase() === "critical").length
      : undefined;
    try {
      const result = await evaluateMutation.mutateAsync({
        owner,
        repo,
        version: commitSha ? commitSha.slice(0, 7) : "HEAD",
        commit_sha: commitSha ?? undefined,
        live_test_passed: liveTestSummary?.passed ?? 0,
        live_test_failed: liveTestSummary?.failed ?? 0,
        live_test_total: liveTestSummary?.total ?? 0,
        // The review's own verdict, as the review stage returned it. Omitted
        // when no review ran, so the report marks the signal as not evaluated
        // instead of scoring an invented verdict.
        review_recommendation: reviewVerdict,
        review_critical_count: criticalCount,
      });
      setReportResult(result);
      void queryClient.invalidateQueries({ queryKey: ["pipeline-runs"] });
    } catch {
      // Shown inline from evaluateMutation.error.
    }
  };

  const r = reportResult;
  const vcfg = verdictConfig(r?.verdict?.verdict);
  const insufficient = r?.verdict?.verdict === "INSUFFICIENT_DATA";
  const signals = r?.signals;
  const notEvaluated = r?.not_evaluated ?? {};
  const scoredSignals = r?.scored_signals;
  const blockers = r?.verdict?.blockers?.length
    ? r.verdict.blockers
    : r?.verdict?.primary_blocker ? [r.verdict.primary_blocker] : [];

  const signalRows: { key: string; value: string; status: SignalStatus }[] = [];
  if (r && signals) {
    const ci = signals.ci_pass_rate ?? null;
    signalRows.push({
      key: "ci_pass_rate",
      value: ci === null ? NOT_EVALUATED : `${ci}%`,
      status: ci === null ? "none" : ci >= 80 ? "ok" : "warn",
    });
    const live = signals.live_test_total > 0 ? signals.live_test_pass_rate ?? null : null;
    signalRows.push({
      key: "live_test_pass_rate",
      value: live === null ? NOT_EVALUATED : `${live}% (${signals.live_test_passed}/${signals.live_test_total})`,
      status: live === null ? "none" : live >= 80 ? "ok" : "warn",
    });
    const review = reviewSignal(signals.review_recommendation);
    signalRows.push({
      key: "review_recommendation",
      value: !review ? NOT_EVALUATED : review.status === "none" ? `${review.label} (not evaluated)` : review.label,
      status: review?.status ?? "none",
    });
    const bugs = signals.open_critical_bug_count ?? signals.open_critical_bugs?.length ?? null;
    signalRows.push({
      key: "open_critical_bugs",
      value: bugs === null ? NOT_EVALUATED : String(bugs),
      status: bugs === null ? "none" : bugs === 0 ? "ok" : "fail",
    });
    const findings = signals.unresolved_security_findings ?? signals.review_critical_findings ?? null;
    signalRows.push({
      key: "unresolved_security_findings",
      value: findings === null ? NOT_EVALUATED : String(findings),
      status: findings === null ? "none" : findings === 0 ? "ok" : "warn",
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Banner */}
      <div className="flex h-11 items-center justify-between border-b border-stroke-muted px-4 flex-shrink-0">
        <p className={eyebrow}>Release report</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => goToStage(STAGE_LIVE_TESTS)}>Back</Button>
          {reportResult && (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetPipeline}>
              <RotateCcw className="h-4 w-4 mr-1" /> New pipeline
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 max-w-3xl mx-auto space-y-5">
          {/* Trigger */}
          {!reportResult && (
            <div className="rounded-lg border border-stroke-muted bg-container p-4 space-y-4">
              <div className="space-y-1">
                <h3 className={eyebrow}>Generate release report</h3>
                <p className="text-sm text-ink-tertiary">
                  Combines the repository's recent CI runs, the code review verdict, and live test results into one score and a go/no-go verdict.
                </p>
              </div>
              {/* Summary of what we have */}
              <div className="grid grid-cols-2 gap-3 text-left">
                {[
                  { label: "Code Review", value: reviewResult ? reviewInput?.label ?? "Reviewed, no verdict returned" : "Not run" },
                  { label: "Live Test Run", value: liveTestSummary ? `${liveTestSummary.pass_rate}% pass rate (${liveTestSummary.passed}/${liveTestSummary.total})` : "Not run" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-stroke-muted bg-raised p-3">
                    <p className={eyebrow}>{label}</p>
                    <p className="text-sm text-ink mt-1">{value}</p>
                  </div>
                ))}
              </div>
              <VerdictLegend />
              {evaluateMutation.isError && (
                <p className="text-sm text-destructive">Report failed: {errorDetail(evaluateMutation.error)}</p>
              )}
              <Button onClick={handleGenerate} disabled={evaluateMutation.isPending || !owner || !repo}>
                {evaluateMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating report…</>
                  : "Generate report"}
              </Button>
              {(!owner || !repo) && (
                <p className="text-xs text-ink-tertiary">Connect a repository in the Workspace stage first.</p>
              )}
              <PipelineRunHistory runs={runsQuery.data} loading={runsQuery.isLoading} error={runsQuery.isError} />
            </div>
          )}

          {/* Results */}
          {r && (
            <div className="space-y-5">
              {/* Verdict + Score */}
              <div className="rounded-lg border border-stroke-muted bg-container p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <p className="font-mono text-xs text-ink-tertiary">{owner}/{repo} · {r.commit_sha?.slice(0, 7) ?? "HEAD"}</p>
                    <Mark id={VERDICT_MARK[vcfg.label] ?? "mark-verdict-not-evaluated"} size={40} />
                    <StatusBadge tone={vcfg.tone} size="md">{vcfg.label}</StatusBadge>
                    <p className="text-sm text-ink">{vcfg.description}</p>
                    {r.verdict?.reason && (
                      <div className="rounded-lg bg-raised p-3">
                        <p className={`${eyebrow} mb-1`}>Reason</p>
                        <p className="text-sm text-ink-secondary leading-relaxed">{r.verdict.reason}</p>
                      </div>
                    )}
                    {!insufficient && r.verdict?.recommendation && (
                      <p className="text-sm text-ink-secondary leading-relaxed">{r.verdict.recommendation}</p>
                    )}
                    {blockers.length > 0 && (
                      <div className="rounded-lg bg-raised p-3">
                        <p className={`${eyebrow} mb-1`}>{blockers.length === 1 ? "Blocker" : "Blockers"}</p>
                        <ul className="space-y-0.5">
                          {blockers.map((b, i) => <li key={i} className="text-sm text-destructive">{b}</li>)}
                        </ul>
                      </div>
                    )}
                    {r.verdict?.conditions?.length > 0 && (
                      <div>
                        <p className={`${eyebrow} mb-1.5`}>Conditions to resolve</p>
                        <ul className="list-disc space-y-0.5 pl-4">
                          {r.verdict.conditions.map((c, i) => <li key={i} className="text-xs text-ink-secondary">{c}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <ScoreGauge score={typeof r.score === "number" ? r.score : null} />
                  </div>
                </div>
              </div>

              {/* Signal breakdown */}
              <div className="rounded-lg border border-stroke-muted bg-container">
                <p className={`${eyebrow} border-b border-stroke-muted px-4 py-3`}>Signal breakdown</p>
                <div>
                  {signalRows.map(({ key, value, status }) => {
                    const used = scoredSignals ? scoredSignals.includes(key) : null;
                    return (
                      <div key={key} className="flex items-start gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
                        <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${DOT[status]}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{SIGNAL_LABELS[key] ?? key}</p>
                          {notEvaluated[key] && (
                            <p className="mt-0.5 break-words text-xs text-ink-tertiary">{notEvaluated[key]}</p>
                          )}
                        </div>
                        <span className={`text-sm tabular-nums ${status === "none" ? "text-ink-tertiary" : "text-ink-secondary"}`}>{value}</span>
                        {used !== null && (
                          <StatusBadge tone={used ? "info" : "neutral"}>{used ? "In score" : "Not in score"}</StatusBadge>
                        )}
                      </div>
                    );
                  })}
                </div>
                {scoredSignals && (
                  <p className="border-t border-stroke-muted px-4 py-3 text-xs text-ink-tertiary">
                    {scoredSignals.length > 0
                      ? <>Score computed from: {scoredSignals.map((s) => SIGNAL_LABELS[s] ?? s).join(", ")}. Signals that were not evaluated add neither points nor weight.</>
                      : "No signal was scored."}
                  </p>
                )}
              </div>

              {r.errors?.length > 0 && (
                <div className="rounded-lg border border-stroke-muted bg-container p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <StatusBadge tone="warning">Partial data</StatusBadge>
                    <span className="text-xs text-ink-tertiary">Some signals could not be read; the verdict was computed without them.</span>
                  </div>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {r.errors.map((e, i) => <li key={i} className="text-xs text-ink-secondary">{e}</li>)}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <PipelineRunHistory runs={runsQuery.data} loading={runsQuery.isLoading} error={runsQuery.isError} />

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    // Clear review-downstream results so the review stage runs fresh
                    setReviewResult(null);
                    setReviewStatus("idle");
                    setReviewCoverage(null);
                    setLiveTestSummary(null);
                    setReportResult(null);
                    goToStage(STAGE_CODE_REVIEW);
                  }}
                >
                  Re-run review
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    // Clear test & report results so the test runner starts fresh
                    setLiveTestSummary(null);
                    setReportResult(null);
                    goToStage(STAGE_LIVE_TESTS);
                  }}
                >
                  Re-run tests
                </Button>
                <Button variant="outline" className="flex-1" onClick={resetPipeline}>
                  <RotateCcw className="h-4 w-4 mr-1.5" /> New pipeline
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function PipelineRunHistory({
  runs,
  loading,
  error,
}: {
  runs?: PipelineRunSummary[];
  loading: boolean;
  error: boolean;
}) {
  return (
    <div className="rounded-lg border border-stroke-muted bg-container text-left">
      <p className={`${eyebrow} border-b border-stroke-muted px-4 py-3`}>Recent reports</p>
      {loading && <EmptyState kind="loading" compact>Loading history…</EmptyState>}
      {!loading && error && (
        <EmptyState kind="error" compact>Could not load the report history.</EmptyState>
      )}
      {!loading && !error && (!runs || runs.length === 0) && (
        <EmptyState kind="noResults" compact>No saved reports yet. Generate one to keep a history.</EmptyState>
      )}
      <div>
        {(runs ?? []).map((run) => {
          const cfg = verdictConfig(run.verdict);
          return (
            <div key={run.id} className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {run.owner}/{run.repo} · {run.version}
                </p>
                <p className="font-mono text-xs text-ink-tertiary">
                  {run.commit_sha ? run.commit_sha.slice(0, 7) : "HEAD"}
                  {run.created_at ? ` · ${new Date(run.created_at).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="font-mono tabular-nums text-ink-secondary">
                  {typeof run.score === "number" ? `${run.score}/100` : "Not evaluated"}
                </span>
                <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
