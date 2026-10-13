import { useParams, useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { ArrowLeft, GitCommit, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { PageCard } from "@/components/PageCard";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { useRootCauseDetail, useRerunRootCauseTest } from "@/hooks/use-root-cause";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, StatusTone> = {
  completed: "success",
  analyzing: "pending",
  failed: "critical",
};

const SEVERITY_TONE: Record<string, StatusTone> = {
  critical: "critical",
  high: "warning",
  medium: "info",
  low: "neutral",
};

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

export default function RootCauseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useRootCauseDetail(id);
  const rerunMutation = useRerunRootCauseTest(id ?? "");

  if (isLoading) {
    return (
      <PageShell>
        <Panel>
          <EmptyState kind="loading">Loading investigation…</EmptyState>
        </Panel>
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell>
        <Panel>
          <EmptyState kind="error">
            Could not load this analysis. It may not exist for your organization.
          </EmptyState>
        </Panel>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={data.test_name}
        description={data.repository ?? "No repository linked"}
        badge={
          <StatusBadge tone={STATUS_TONE[data.status] ?? "neutral"} className="capitalize">
            {data.status}
          </StatusBadge>
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/root-cause")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Root Cause Analysis
          </Button>
        }
      />

      <Panel padded={false}>
        <dl className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3">
            <dt className={eyebrow}>Severity</dt>
            <dd className="mt-1.5">
              <StatusBadge tone={SEVERITY_TONE[data.severity] ?? "neutral"} className="capitalize">
                {data.severity}
              </StatusBadge>
            </dd>
          </div>
          <div className="px-4 py-3">
            <dt className={eyebrow}>Confidence</dt>
            <dd className="mt-1.5 text-sm tabular-nums text-ink">
              {data.status === "completed" ? `${data.confidence}% (${data.confidence_label})` : "–"}
            </dd>
          </div>
          <div className="px-4 py-3">
            <dt className={eyebrow}>Failure type</dt>
            <dd className="mt-1.5 text-sm capitalize text-ink">{data.failure_type.replace(/_/g, " ")}</dd>
          </div>
        </dl>
      </Panel>

      <PageCard title="Root cause">
        {data.ai_error ? (
          <p className="text-sm text-destructive">
            AI analysis failed: {data.ai_error}. The evidence below was still collected and is available for manual review.
          </p>
        ) : (
          <>
            <p className="text-sm font-medium text-ink">{data.root_cause_summary}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{data.root_cause_explanation}</p>
            {data.likely_commit && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-raised px-3 py-2 text-xs">
                <GitCommit className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
                <span className="shrink-0 font-mono text-ink">{data.likely_commit.sha}</span>
                <span className="min-w-0 truncate text-ink-secondary">{data.likely_commit.message}</span>
              </div>
            )}
          </>
        )}
      </PageCard>

      <PageCard
        title="Evidence"
        description={`Git data: ${
          data.evidence.has_git_data ? `${data.evidence.recent_commits.length} recent commits found` : "not available for this run"
        }`}
        padding={false}
      >
        {data.evidence.step_trace.length === 0 ? (
          <EmptyState kind="noResults">No step trace available.</EmptyState>
        ) : (
          <ol>
            {data.evidence.step_trace.map((s) => (
              <li key={s.step_number} className="flex items-start gap-2.5 border-b border-border/60 px-4 py-2.5 text-sm last:border-b-0">
                <span
                  className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", s.status === "fail" ? "bg-status-critical" : "bg-status-neutral")}
                />
                <span className="w-8 shrink-0 font-mono text-xs leading-5 tabular-nums text-ink-quaternary">#{s.step_number}</span>
                <span className="min-w-0">
                  <span className="text-ink-secondary">{s.step_description}</span>
                  {s.error && <span className="mt-0.5 block font-mono text-xs text-destructive">{s.error}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </PageCard>

      <section className="space-y-2">
        <h3 className={eyebrow}>Impact</h3>
        <div className="grid grid-cols-3 gap-3">
          <KpiStat mark="mark-code-impact" label="Affected files" value={data.affected_files.length} />
          <KpiStat mark="mark-test-suite" label="Affected tests" value={data.affected_tests.length} />
          <KpiStat mark="mark-int-hosting" label="Affected services" value={data.affected_services.length} />
        </div>
      </section>

      <PageCard
        title="AI recommendation"
        actions={
          <Button size="sm" variant="outline" className="gap-2" disabled={rerunMutation.isPending} onClick={() => rerunMutation.mutate()}>
            <RefreshCw className="h-4 w-4" />
            {rerunMutation.isPending ? "Starting…" : "Re-run test"}
          </Button>
        }
      >
        <p className="text-sm text-ink-secondary">{data.recommendation ?? "No recommendation available."}</p>
        {rerunMutation.isSuccess && (
          <p className="mt-3 text-xs text-ink-secondary">
            Re-run started (run <span className="font-mono">{rerunMutation.data.run_id.slice(0, 8)}</span>). Check Live Test Runner for progress.
          </p>
        )}
        {rerunMutation.isError && (
          <p className="mt-3 text-xs text-destructive">
            Could not start the re-run. The original test or repository analysis may no longer exist.
          </p>
        )}
      </PageCard>
    </PageShell>
  );
}
