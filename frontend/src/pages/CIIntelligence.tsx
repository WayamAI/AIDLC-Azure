import { RepoInput } from "@/components/RepoInput";
import { EmptyState } from "@/components/EmptyState";
import { GITHUB_STALE_MS } from "@/lib/query-times";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api";
import { ErrorText } from "@/components/ErrorText";
import { parseGithubRepo } from "@/lib/github-repo";
import { useActiveRepo } from "@/context/RepoContext";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { DataTable, FilterPills, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { ChartTooltipBox } from "@/components/dashboard/DashboardUi";
import { DS_CHART } from "@/lib/design-system";

const CONCLUSION: Record<string, { label: string; tone: StatusTone }> = {
  success: { label: "Success", tone: "success" },
  failure: { label: "Failure", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "warning" },
  in_progress: { label: "In progress", tone: "info" },
};

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

interface WorkflowStat {
  name: string;
  total: number;
  /** Null when none of this workflow's runs concluded success or failure. */
  failure_rate: number | null;
}

interface UnstableWorkflow {
  workflow: string;
  failures: number;
  total_runs: number;
  flakiness_score: number;
  verdict: string;
}

interface WorkflowRun {
  id: number;
  name: string;
  run_number: number;
  status?: string | null;
  conclusion?: string | null;
  head_branch?: string | null;
  head_sha?: string | null;
  created_at?: string | null;
}

interface FailureExplanation {
  explanation?: string;
  fix?: string;
  category?: string;
  is_flaky_candidate?: boolean;
}

const runOutcome = (run: WorkflowRun) =>
  CONCLUSION[run.conclusion || run.status || ""] || {
    label: String(run.conclusion || run.status || "Unknown"),
    tone: "neutral" as StatusTone,
  };

const WORKFLOW_COLUMNS: DataTableColumn<WorkflowStat>[] = [
  { id: "name", header: "Workflow", grow: true, cell: (wf) => <span className="text-ink">{wf.name}</span>, title: (wf) => wf.name, sortValue: (wf) => wf.name },
  { id: "runs", header: "Runs", align: "right", width: "w-20", cell: (wf) => wf.total, sortValue: (wf) => wf.total },
  { id: "failed", header: "Failed", align: "right", width: "w-24", cell: (wf) => (wf.failure_rate != null ? `${wf.failure_rate}%` : "–"), sortValue: (wf) => wf.failure_rate },
  {
    id: "share",
    header: "Passed share",
    width: "w-32",
    hideBelow: "sm",
    cell: (wf) =>
      wf.failure_rate == null ? (
        <span className="text-xs text-ink-tertiary">Not evaluated</span>
      ) : (
        <div className="h-1 w-24 overflow-hidden rounded-full bg-raised-2" role="img" aria-label={`${100 - wf.failure_rate}% of completed runs passed`}>
          <div className="h-full rounded-full bg-status-success" style={{ width: `${100 - wf.failure_rate}%` }} />
        </div>
      ),
  },
];

const UNSTABLE_COLUMNS: DataTableColumn<UnstableWorkflow>[] = [
  { id: "workflow", header: "Workflow", grow: true, cell: (fw) => <span className="text-ink">{fw.workflow}</span>, title: (fw) => fw.workflow, sortValue: (fw) => fw.workflow },
  { id: "failures", header: "Failed", align: "right", width: "w-24", cell: (fw) => fw.failures, sortValue: (fw) => fw.failures },
  { id: "runs", header: "Runs", align: "right", width: "w-20", cell: (fw) => fw.total_runs, sortValue: (fw) => fw.total_runs },
  { id: "share", header: "Failure share", align: "right", width: "w-32", cell: (fw) => `${fw.flakiness_score}%`, sortValue: (fw) => fw.flakiness_score },
  {
    id: "verdict",
    header: "Verdict",
    width: "w-48",
    cell: (fw) => (
      <StatusBadge tone={fw.verdict === "likely_flaky" ? "critical" : "warning"}>
        {fw.verdict === "likely_flaky" ? "3+ failures" : "Fewer than 3 failures"}
      </StatusBadge>
    ),
    sortValue: (fw) => (fw.verdict === "likely_flaky" ? 1 : 0),
  },
];


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-11" -> "Sep 11", or "Sep 11 '25" when the chart spans more than one year. */
function dayLabel(iso: string, withYear: boolean): string {
  const [y, m, d] = String(iso).split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month || !d) return String(iso);
  return `${month} ${Number(d)}${withYear ? ` '${y.slice(2)}` : ""}`;
}

export default function CIIntelligence() {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [repoCoords, setRepoCoords] = useState<{ owner: string; repo: string } | null>(
    activeRepo ? { owner: activeRepo.owner, repo: activeRepo.repo } : null,
  );
  const [explainRunId, setExplainRunId] = useState<number | null>(null);
  const [runsFilter, setRunsFilter] = useState<"all" | "failed">("all");

  const healthQuery = useQuery({
    queryKey: ["ci-health", repoCoords?.owner, repoCoords?.repo],
    queryFn: () => api.getCIHealth(repoCoords!.owner, repoCoords!.repo),
    enabled: !!(repoCoords?.owner && repoCoords?.repo),
    staleTime: GITHUB_STALE_MS,
  });

  const flakyQuery = useQuery({
    queryKey: ["ci-flaky", repoCoords?.owner, repoCoords?.repo],
    queryFn: () => api.getFlakyTests(repoCoords!.owner, repoCoords!.repo),
    enabled: !!(repoCoords?.owner && repoCoords?.repo),
    staleTime: GITHUB_STALE_MS,
  });

  const explainMutation = useMutation({
    mutationFn: ({ runId }: { runId: number }) =>
      api.explainCIFailure(repoCoords!.owner, repoCoords!.repo, runId),
  });

  const data = healthQuery.data as any;
  const flaky = flakyQuery.data as { flaky_workflows?: UnstableWorkflow[]; total?: number } | undefined;
  const unstable = flaky?.flaky_workflows ?? [];
  const summary = data?.summary || {};
  const trend = data?.trend || [];
  // The 14 days with runs can span years; then each label carries its year.
  const multiYear = trend.length > 1 && String(trend[0].date).slice(0, 4) !== String(trend[trend.length - 1].date).slice(0, 4);
  const byWorkflow: WorkflowStat[] = data?.by_workflow || [];
  const runs: WorkflowRun[] = data?.runs || [];
  const dora = data?.dora || {};
  const explanation = explainMutation.data as FailureExplanation | undefined;

  // The explanation belongs to one run; it opens under that row once the request settles.
  const hasExplainResult = (run: WorkflowRun) =>
    explainRunId === run.id && !explainMutation.isPending && (explainMutation.isError || !!explanation);

  const runColumns: DataTableColumn<WorkflowRun>[] = [
    {
      id: "run",
      header: "Run",
      grow: true,
      cell: (run) => (
        <span className="text-ink">
          {run.name} <span className="tabular-nums text-ink-tertiary">#{run.run_number}</span>
        </span>
      ),
      title: (run) => `${run.name} #${run.run_number}`,
      sortValue: (run) => run.run_number,
    },
    { id: "branch", header: "Branch", mono: true, hideBelow: "sm", cell: (run) => run.head_branch ?? "–", sortValue: (run) => run.head_branch },
    { id: "sha", header: "Commit", mono: true, hideBelow: "md", width: "w-24", cell: (run) => run.head_sha ?? "–" },
    {
      id: "started",
      header: "Started",
      hideBelow: "lg",
      width: "w-44",
      cell: (run) => (run.created_at ? new Date(run.created_at).toLocaleString() : "–"),
      sortValue: (run) => (run.created_at ? new Date(run.created_at) : null),
    },
    {
      id: "outcome",
      header: "Outcome",
      width: "w-32",
      cell: (run) => <StatusBadge tone={runOutcome(run).tone}>{runOutcome(run).label}</StatusBadge>,
      sortValue: (run) => runOutcome(run).label,
    },
    {
      id: "explain",
      header: "",
      label: "Explain failure",
      align: "right",
      width: "w-24",
      cell: (run) => {
        if (run.conclusion !== "failure") return null;
        const isExplaining = explainMutation.isPending && explainRunId === run.id;
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={isExplaining}
            onClick={() => {
              setExplainRunId(run.id);
              explainMutation.mutate({ runId: run.id });
            }}
          >
            {isExplaining ? <Loader2 className="h-3 w-3 animate-spin" /> : "Explain"}
          </Button>
        );
      },
    },
  ];

  const evaluatedRuns: number | undefined = summary.evaluated_runs;
  const evaluatedHint = (verb: string) =>
    evaluatedRuns
      ? `${verb} of ${evaluatedRuns} completed ${evaluatedRuns === 1 ? "run" : "runs"}`
      : "no run has finished with success or failure";

  const outcomes = [
    { name: "Success", value: summary.success_count || 0, dot: "bg-status-success" },
    { name: "Failure", value: summary.failure_count || 0, dot: "bg-status-critical" },
    { name: "Cancelled", value: summary.cancelled_count || 0, dot: "bg-status-warning" },
  ].filter((d) => d.value > 0);
  const outcomeTotal = outcomes.reduce((sum, d) => sum + d.value, 0);

  const isLoading = healthQuery.isLoading || flakyQuery.isLoading;

  return (
    <PageShell>
      <PageHeader
        title="CI Health"
        description="Outcomes of the most recent GitHub Actions workflow runs for a repository, with an on-demand explanation for failed runs."
      />

      <RepoInput
        id="ci-repo"
        action="Load"
        busy={healthQuery.isFetching}
        defaultUrl={activeRepo?.repoUrl ?? ""}
        onSearch={(owner, repo) => {
          setRepoCoords({ owner, repo });
          setActiveRepo({ owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, branch: activeRepo?.branch || "main" });
        }}
      />

      {isLoading && (
        <Panel>
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading workflow runs…
          </p>
        </Panel>
      )}

      {healthQuery.isError && (
        <Panel>
          <EmptyState kind="error" compact>
            <ErrorText error={healthQuery.error} fallback="Could not load CI data for this repository." />
          </EmptyState>
        </Panel>
      )}

      {data && !healthQuery.isError && runs.length === 0 && (
        <Panel>
          <EmptyState kind="noRuns">
            No GitHub Actions workflow runs were found for {repoCoords?.owner}/{repoCoords?.repo}. The repository may not
            use GitHub Actions, or its runs are not visible without a token.
          </EmptyState>
        </Panel>
      )}

      {!repoCoords && (
        <Panel>
          <EmptyState kind="noResults" mark="mark-ci-intelligence">
            Enter a GitHub repository above to see its recent workflow runs.
          </EmptyState>
        </Panel>
      )}

      {data && !healthQuery.isError && runs.length > 0 && (
        <>
          {/* Both rates are shares of the runs that concluded success or failure;
              cancelled, skipped and in-progress runs are not in the denominator. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiStat mark="mark-kpi-pass-rate"
              label="Success rate"
              value={summary.success_rate != null ? `${summary.success_rate}%` : "–"}
              hint={evaluatedHint("succeeded")}
            />
            <KpiStat mark="mark-kpi-ci-failure-rate"
              label="Run failure rate"
              value={summary.failure_rate != null ? `${summary.failure_rate}%` : "–"}
              hint={evaluatedHint("failed")}
            />
            <KpiStat mark="mark-kpi-successful-runs" label="Successful runs (7d)" value={dora.deployment_frequency_per_week ?? "–"} hint="workflow runs, not deployments" />
            <KpiStat mark="mark-ci-intelligence" label="Runs analysed" value={summary.total_runs ?? "–"} hint="the 30 most recent" />
          </div>

          {trend.length > 0 && (
            <PageCard title="Runs per day" description="Successful and failed runs per day, for the 14 most recent days that had runs">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend} barCategoryGap="30%">
                  <CartesianGrid stroke="var(--color-stroke-muted)" vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v: string) => dayLabel(v, multiYear)} stroke="var(--color-stroke-muted)" />
                  <YAxis tick={AXIS_TICK} stroke="var(--color-stroke-muted)" allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--ink) / 0.05)" }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <ChartTooltipBox
                          label={label}
                          rows={payload.map((p) => ({
                            name: String(p.name),
                            value: typeof p.value === "number" || typeof p.value === "string" ? p.value : Number(p.value) || 0,
                            color: p.name === "Success" ? DS_CHART.pass : DS_CHART.fail,
                          }))}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="success" stackId="runs" fill={DS_CHART.pass} name="Success" maxBarSize={36} isAnimationActive={false} />
                  <Bar dataKey="failure" stackId="runs" fill={DS_CHART.fail} name="Failure" maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </PageCard>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <DataTable
              caption="Workflows"
              columns={WORKFLOW_COLUMNS}
              rows={byWorkflow}
              rowKey={(wf) => wf.name}
              empty="No workflows found."
            />

            {outcomes.length > 0 && (
              <PageCard title="Run outcomes">
                <div className="flex h-2 overflow-hidden rounded-full bg-raised-2">
                  {outcomes.map((o) => (
                    <div key={o.name} className={o.dot} style={{ width: `${(o.value / outcomeTotal) * 100}%` }} />
                  ))}
                </div>
                <ul className="mt-4 space-y-2">
                  {outcomes.map((o) => (
                    <li key={o.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 text-ink-secondary">
                        <span className={`h-2 w-2 rounded-full ${o.dot}`} />
                        {o.name}
                      </span>
                      <span className="tabular-nums text-ink">
                        {o.value}
                        <span className="ml-2 text-xs text-ink-tertiary">{Math.round((o.value / outcomeTotal) * 100)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </PageCard>
            )}
          </div>

          {unstable.length > 0 && (
            <PageCard
              title={`Unstable workflows (${flaky?.total ?? unstable.length})`}
              description="Workflows that both passed and failed in the 30 most recent runs. This is run-level instability, not per-test flakiness."
              padding={false}
            >
              <DataTable bare columns={UNSTABLE_COLUMNS} rows={unstable} rowKey={(fw) => fw.workflow} />
            </PageCard>
          )}

          {runs.length > 0 && (
            <DataTable
              caption="Recent workflow runs"
              columns={runColumns}
              rows={runsFilter === "failed" ? runs.filter((run) => run.conclusion === "failure") : runs}
              rowKey={(run) => String(run.id)}
              pageSize={10}
              empty="No failed runs among the runs analysed."
              toolbar={
                <FilterPills<"all" | "failed">
                  label="Run outcome"
                  value={runsFilter}
                  onChange={setRunsFilter}
                  options={[
                    { value: "all", label: "All", count: runs.length },
                    { value: "failed", label: "Failed", count: runs.filter((run) => run.conclusion === "failure").length },
                  ]}
                />
              }
              canExpand={hasExplainResult}
              defaultExpanded={hasExplainResult}
              renderExpanded={() =>
                explainMutation.isError ? (
                  <p className="text-xs text-destructive">
                    <ErrorText error={explainMutation.error} fallback="The explanation could not be generated." />
                  </p>
                ) : (
                  <div className="space-y-2 rounded-md bg-raised p-3 text-xs">
                    <p className="text-ink-secondary">{explanation?.explanation}</p>
                    {explanation?.fix && (
                      <p className="text-ink">
                        <span className="font-medium">Suggested fix:</span> {explanation.fix}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      {explanation?.category && <StatusBadge tone="neutral">{explanation.category}</StatusBadge>}
                      {explanation?.is_flaky_candidate && <StatusBadge tone="warning">Flaky candidate</StatusBadge>}
                    </div>
                  </div>
                )
              }
            />
          )}
        </>
      )}
    </PageShell>
  );
}
