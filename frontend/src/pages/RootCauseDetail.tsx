import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, GitCommit, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { useRootCauseDetail, useRerunRootCauseTest } from "@/hooks/use-root-cause";

export default function RootCauseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useRootCauseDetail(id);
  const rerunMutation = useRerunRootCauseTest(id ?? "");

  if (isLoading) {
    return (
      <PageShell size="lg" className="py-12 text-center text-sm text-muted-foreground">
        Loading investigation…
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell size="lg" className="py-12 text-center text-sm text-destructive">
        Could not load this analysis. It may not exist for your organization.
      </PageShell>
    );
  }

  return (
    <PageShell size="lg" className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/root-cause")} className="gap-1.5">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Root Cause Analysis
      </Button>

      {/* Failure summary */}
      <div className="floating-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">{data.test_name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{data.repository ?? "No repository linked"}</p>
          </div>
          <Badge variant="outline" className="uppercase">{data.status}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Severity</p><p className="font-medium capitalize">{data.severity}</p></div>
          <div><p className="text-xs text-muted-foreground">Confidence</p><p className="font-medium">{data.status === "completed" ? `${data.confidence}% (${data.confidence_label})` : "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Failure Type</p><p className="font-medium capitalize">{data.failure_type.replace(/_/g, " ")}</p></div>
        </div>
      </div>

      {/* Root cause */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Root Cause</h2>
        {data.ai_error ? (
          <p className="mt-2 text-sm text-destructive">AI analysis failed: {data.ai_error}. Evidence below is still real and available for manual review.</p>
        ) : (
          <>
            <p className="mt-2 text-sm font-medium">{data.root_cause_summary}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{data.root_cause_explanation}</p>
            {data.likely_commit && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/30 bg-muted/10 px-3 py-2 text-xs">
                <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono">{data.likely_commit.sha}</span>
                <span className="text-muted-foreground">{data.likely_commit.message}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Evidence */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Evidence</h2>
        <div className="mt-3 space-y-1">
          {data.evidence.step_trace.length === 0 && (
            <p className="text-xs text-muted-foreground">No step trace available.</p>
          )}
          {data.evidence.step_trace.map((s) => (
            <div key={s.step_number} className={`rounded border px-3 py-2 text-xs ${s.status === "fail" ? "border-destructive/30 bg-destructive/5" : "border-border/20"}`}>
              <span className="font-mono text-muted-foreground">#{s.step_number}</span> {s.step_description}
              {s.error && <p className="mt-1 text-destructive">{s.error}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Git data: {data.evidence.has_git_data ? `${data.evidence.recent_commits.length} recent commits found` : "Not available for this run"}
        </p>
      </div>

      {/* Impact */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Impact</h2>
        <div className="mt-3 grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Affected Files</p><p className="font-medium">{data.affected_files.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Affected Tests</p><p className="font-medium">{data.affected_tests.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Affected Services</p><p className="font-medium">{data.affected_services.length}</p></div>
        </div>
      </div>

      {/* Recommendation + actions */}
      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">AI Recommendation</h2>
        <p className="mt-2 text-sm text-muted-foreground">{data.recommendation ?? "No recommendation available."}</p>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={rerunMutation.isPending} onClick={() => rerunMutation.mutate()}>
            <RefreshCw className="h-3.5 w-3.5" /> {rerunMutation.isPending ? "Starting…" : "Re-run Test"}
          </Button>
        </div>
        {rerunMutation.isSuccess && (
          <p className="mt-2 text-xs text-emerald-500">Re-run started (run {rerunMutation.data.run_id.slice(0, 8)}) check Live Test Runner for progress.</p>
        )}
        {rerunMutation.isError && (
          <p className="mt-2 text-xs text-destructive">Could not start re-run the original test or repository analysis may no longer exist.</p>
        )}
      </div>
    </PageShell>
  );
}
