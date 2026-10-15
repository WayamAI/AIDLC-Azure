import { ErrorText, withConnectorsLink } from "@/components/ErrorText";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useActiveRepo } from "@/context/RepoContext";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";

// Sprint Intelligence combines two sources into one report:
//   GitHub (required): GitHub Actions workflow-run counts over the last 14 days.
//   Jira (optional): the issues in the current sprint.
// The summary paragraph is written by the model from those numbers.

const PRIORITY_TONE: Record<string, StatusTone> = {
  Critical: "critical",
  Highest: "critical",
  High: "warning",
  Medium: "info",
  Low: "neutral",
  Lowest: "neutral",
};

const PRIORITY_RANK: Record<string, number> = { Critical: 6, Highest: 5, High: 4, Medium: 3, Low: 2, Lowest: 1 };
const NO_PRIORITY = "No priority";

interface SprintIssue {
  key: string;
  summary: string;
  status?: string;
  assignee?: string;
  priority?: string;
}

const ISSUE_COLUMNS: DataTableColumn<SprintIssue>[] = [
  { id: "key", header: "Key", mono: true, width: "w-28", cell: (s) => s.key, sortValue: (s) => s.key },
  { id: "summary", header: "Summary", grow: true, cell: (s) => <span className="text-ink">{s.summary}</span>, title: (s) => s.summary, sortValue: (s) => s.summary },
  { id: "status", header: "Status", hideBelow: "sm", cell: (s) => s.status ?? "", sortValue: (s) => s.status },
  { id: "assignee", header: "Assignee", hideBelow: "md", cell: (s) => s.assignee ?? "", sortValue: (s) => s.assignee },
  {
    id: "priority",
    header: "Priority",
    width: "w-28",
    cell: (s) => (s.priority ? <StatusBadge tone={PRIORITY_TONE[s.priority] ?? "neutral"}>{s.priority}</StatusBadge> : ""),
    sortValue: (s) => (s.priority ? (PRIORITY_RANK[s.priority] ?? 0) : null),
  },
];

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const optional = "font-normal text-ink-quaternary";

export default function SprintIntelligence() {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [form, setForm] = useState({
    owner: activeRepo?.owner ?? "",
    repo: activeRepo?.repo ?? "",
    jira_project: "",
    sprint_name: "",
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      api.generateSprintReport({
        owner: form.owner,
        repo: form.repo,
        jira_project: form.jira_project || undefined,
        sprint_name: form.sprint_name || "Current Sprint",
      }),
  });

  const data = reportMutation.data as any;
  const dora = data?.dora || {};
  const stories: SprintIssue[] = data?.stories || [];
  const errors: string[] = data?.errors || [];

  const hasGitHub = !!form.owner.trim() && !!form.repo.trim();
  const hasJira = !!form.jira_project.trim();

  const jiraNotConfigured = errors.some((e) => /jira is not configured/i.test(e));
  const jiraFailed = errors.some((e) => /^jira:/i.test(e));
  const otherErrors = errors.filter((e) => !/jira is not configured/i.test(e));

  // Both rates are shares of the runs that finished with success or failure among
  // the 30 most recent; the two run counts beside them cover the last 14 days.
  const evaluatedRuns: number | undefined = data?.ci_summary?.evaluated_runs;
  const rateHint = (verb: string) =>
    evaluatedRuns ? `${verb} of ${evaluatedRuns} completed runs (30 most recent)` : "of completed runs (30 most recent)";

  // Only the metrics the report actually returned.
  const ciStats = [
    { mark: "mark-kpi-pass-rate" as const, label: "Run pass rate", value: data?.test_pass_rate, suffix: "%", hint: rateHint("succeeded") },
    { mark: "mark-kpi-ci-failure-rate" as const, label: "Run failure rate", value: dora.change_failure_rate, suffix: "%", hint: rateHint("failed") },
    { mark: "mark-ci-intelligence" as const, label: "Workflow runs", value: dora.total_ci_runs_14d, suffix: "", hint: "last 14 days" },
    { mark: "mark-kpi-successful-runs" as const, label: "Successful runs", value: dora.successful_runs_14d, suffix: "", hint: "last 14 days" },
    { mark: "mark-kpi-successful-runs" as const, label: "Successful runs (7d)", value: dora.deployment_frequency_per_week, suffix: "", hint: "workflow runs, not deployments" },
  ].filter((s) => s.value != null);

  const jiraStats = jiraFailed
    ? []
    : [
        { mark: "mark-sprint-intelligence" as const, label: "Issues in sprint", value: data?.stories_delivered, hint: "every issue, any status" },
        { mark: "mark-empty-not-found" as const, label: "Thin descriptions", value: data?.ambiguous_stories_detected, hint: "description under 50 characters" },
        { mark: "mark-kpi-high-priority" as const, label: "High priority", value: data?.high_priority_stories, hint: "High, Highest or Critical" },
      ].filter((s) => s.value != null);

  const storiesByPriority = Object.entries(
    stories.reduce<Record<string, number>>((acc, s) => {
      // An issue without a priority is counted as such, not folded into a real band.
      const p = s.priority || NO_PRIORITY;
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {}),
  ).map(([priority, count]) => ({ priority, count }));
  const maxPriorityCount = Math.max(1, ...storiesByPriority.map((p) => p.count));

  return (
    <PageShell>
      <PageHeader
        title="Sprint Health"
        description="GitHub Actions run metrics for the last 14 days, the issues in the current Jira sprint if a project key is given, and a model-written summary of both."
      />

      <Panel>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="sprint-owner" className={fieldLabel}>
              GitHub owner
            </label>
            <Input
              id="sprint-owner"
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
              placeholder="expressjs"
            />
          </div>
          <div>
            <label htmlFor="sprint-repo" className={fieldLabel}>
              Repository
            </label>
            <Input
              id="sprint-repo"
              value={form.repo}
              onChange={(e) => setForm({ ...form, repo: e.target.value })}
              placeholder="express"
            />
          </div>
          <div>
            <label htmlFor="sprint-jira" className={fieldLabel}>
              Jira project key <span className={optional}>(optional)</span>
            </label>
            <Input
              id="sprint-jira"
              value={form.jira_project}
              onChange={(e) => setForm({ ...form, jira_project: e.target.value.toUpperCase() })}
              placeholder="PROJ"
              className="uppercase"
            />
          </div>
          <div>
            <label htmlFor="sprint-label" className={fieldLabel}>
              Sprint label <span className={optional}>(optional, display only)</span>
            </label>
            <Input
              id="sprint-label"
              value={form.sprint_name}
              onChange={(e) => setForm({ ...form, sprint_name: e.target.value })}
              placeholder="Sprint 24"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-xs text-ink-tertiary">
            {hasJira
              ? "Reads GitHub Actions workflow runs and the current Jira sprint."
              : "Reads GitHub Actions workflow runs only. Add a Jira project key to include sprint issues."}
          </p>
          <Button
            onClick={() => {
              if (form.owner && form.repo) {
                setActiveRepo({
                  owner: form.owner,
                  repo: form.repo,
                  repoUrl: `https://github.com/${form.owner}/${form.repo}`,
                  branch: activeRepo?.branch || "main",
                });
              }
              reportMutation.mutate();
            }}
            disabled={!hasGitHub || reportMutation.isPending}
            className="gap-2"
          >
            {reportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {reportMutation.isPending ? "Generating" : hasJira ? "Generate sprint report" : "Generate CI report"}
          </Button>
        </div>

        {reportMutation.isError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            <ErrorText
              error={reportMutation.error}
              fallback="The report could not be generated. Check the GitHub owner and repository, and the connections under Settings → Connectors."
            />
          </p>
        )}
      </Panel>

      {data && (
        <>
          <Panel padded={false}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs">
              <span className="text-sm text-ink">{data.sprint_name}</span>
              <span className="font-mono text-ink-secondary">
                {form.owner}/{form.repo}
              </span>
              {form.jira_project && <span className="font-mono text-ink-secondary">Jira {form.jira_project}</span>}
            </div>
            {jiraNotConfigured && (
              <p className="border-t border-border/60 px-4 py-3 text-sm text-ink-secondary">
                Jira is not configured, so this report has no sprint issues. Connect it under{" "}
                <Link to="/settings/connectors" className="text-ink underline underline-offset-2">
                  Settings → Connectors
                </Link>
                .
              </p>
            )}
            {otherErrors.length > 0 && (
              <div className="border-t border-border/60 px-4 py-3">
                <p className={eyebrow}>Sources that could not be read</p>
                <ul className="mt-1.5 space-y-1">
                  {otherErrors.map((e, i) => (
                    <li key={i} className="text-xs text-destructive">
                      {withConnectorsLink(e)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {ciStats.length > 0 && (
            <section className="space-y-2">
              <h3 className={eyebrow}>CI run metrics</h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {ciStats.map((s) => (
                  <KpiStat key={s.label} mark={s.mark} label={s.label} value={`${s.value}${s.suffix}`} hint={s.hint} />
                ))}
              </div>
              <p className="text-xs text-ink-tertiary">
                Counted from GitHub Actions workflow runs. These are not DORA deployment or change-failure measurements.
              </p>
            </section>
          )}

          {jiraStats.length > 0 && (
            <section className="space-y-2">
              <h3 className={eyebrow}>Jira sprint</h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {jiraStats.map((s) => (
                  <KpiStat key={s.label} mark={s.mark} label={s.label} value={s.value} hint={s.hint} />
                ))}
              </div>
            </section>
          )}

          {data.ai_summary ? (
            <PageCard title="AI summary" description="Written by the model from the numbers above">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">{data.ai_summary}</p>
            </PageCard>
          ) : (
            <PageCard title="AI summary">
              <p className="text-sm text-ink-tertiary">
                Not available: the model did not return a summary for this report. The figures above are measured and
                do not depend on it.
              </p>
            </PageCard>
          )}

          {storiesByPriority.length > 0 && (
            <PageCard title="Issues by priority">
              <ul className="space-y-2.5">
                {storiesByPriority.map((p) => (
                  <li key={p.priority} className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0 truncate text-ink-secondary">{p.priority}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised-2">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(p.count / maxPriorityCount) * 100}%` }} />
                    </div>
                    <span className="w-8 shrink-0 text-right tabular-nums text-ink">{p.count}</span>
                  </li>
                ))}
              </ul>
            </PageCard>
          )}

          {stories.length > 0 && (
            <DataTable
              caption={`Issues in sprint (${stories.length})`}
              columns={ISSUE_COLUMNS}
              rows={stories}
              rowKey={(s) => s.key}
              searchText={(s) => `${s.key} ${s.summary} ${s.status ?? ""} ${s.assignee ?? ""} ${s.priority ?? ""}`}
              searchPlaceholder="Filter issues"
              pageSize={25}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
