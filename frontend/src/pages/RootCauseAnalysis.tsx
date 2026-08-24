import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ShieldQuestion, Sparkles, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { useRootCauseList, useUnanalyzedFailures, useAnalyzeFailure } from "@/hooks/use-root-cause";
import { DS_RISK_BADGE } from "@/lib/design-system";

const SEVERITY_STYLE: Record<string, string> = {
  critical: DS_RISK_BADGE.critical,
  high: DS_RISK_BADGE.high,
  medium: DS_RISK_BADGE.medium,
  low: DS_RISK_BADGE.low,
};

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "text-emerald-500",
  medium: "text-yellow-600",
  low: "text-red-500",
};

export default function RootCauseAnalysis() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useRootCauseList();
  const { data: failuresData, isLoading: failuresLoading } = useUnanalyzedFailures();
  const analyzeMutation = useAnalyzeFailure();

  const summary = data?.summary;

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <PageHeader
          icon={ShieldQuestion}
          title="AI Root Cause Analysis"
          description="AI-correlated failure evidence and Git history for every failed test what broke, why, and what likely caused it."
        />
      </motion.div>

      {isLoading && (
        <div className="floating-card p-8 text-center text-sm text-muted-foreground">Loading analyses…</div>
      )}
      {isError && (
        <div className="floating-card border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Could not load root cause analyses. Try again shortly.
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <PageStat icon={AlertTriangle} label="Total Failures" value={summary.total_failures} accent="destructive" />
          <PageStat icon={Sparkles} label="Root Causes Identified" value={summary.root_causes_identified} accent="primary" />
          <PageStat icon={CheckCircle2} label="High Confidence" value={summary.high_confidence} accent="success" />
          <PageStat icon={ShieldQuestion} label="Needs Human Review" value={summary.requires_human_review} accent="warning" />
          <PageStat icon={Clock} label="Unresolved" value={summary.unresolved_failures} accent="destructive" />
        </div>
      )}

      {/* Unanalyzed failures real data pulled live from playwright_runs */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Failures Awaiting Analysis</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Failed test results from recent Live Test Runner runs that haven't been analyzed yet.
        </p>
        <div className="mt-4 space-y-2">
          {failuresLoading && <p className="text-xs text-muted-foreground">Checking recent runs…</p>}
          {!failuresLoading && (failuresData?.failures.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">No unanalyzed failures nice.</p>
          )}
          {failuresData?.failures.map((f) => (
            <div key={`${f.run_id}-${f.test_id}`} className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{f.test_name}</p>
                <p className="truncate text-xs text-muted-foreground">{f.error || "No error message captured"}</p>
              </div>
              <Button
                size="sm"
                disabled={analyzeMutation.isPending}
                onClick={() => analyzeMutation.mutate({ runId: f.run_id, testId: f.test_id })}
              >
                {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
              </Button>
            </div>
          ))}
        </div>
        {analyzeMutation.isError && (
          <p className="mt-2 text-xs text-destructive">Could not analyze this failure try again.</p>
        )}
      </div>

      {/* Analyzed failures list */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Investigations</h2>
        <div className="mt-4 space-y-2">
          {(data?.items.length ?? 0) === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">No investigations yet analyze a failure above to start one.</p>
          )}
          {data?.items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/root-cause/${item.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-4 py-3 text-left transition hover:bg-muted/20"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.test_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.repository ?? "No repository"} · {item.failure_type.replace(/_/g, " ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={SEVERITY_STYLE[item.severity]}>{item.severity}</Badge>
                {item.status === "completed" ? (
                  <span className={`text-xs font-semibold ${CONFIDENCE_STYLE[item.confidence_label]}`}>
                    {item.confidence}% confidence
                  </span>
                ) : item.status === "analyzing" ? (
                  <Badge variant="outline">Analyzing…</Badge>
                ) : (
                  <Badge variant="outline" className="border-destructive/30 text-destructive">AI analysis failed</Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
