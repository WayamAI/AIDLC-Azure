import { withConnectorsLink } from "@/components/ErrorText";
import type { MarkId } from "@/lib/marks";
import { Mark } from "@/components/Mark";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useActiveRepo } from "@/context/RepoContext";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";

type Verdict = "GO" | "NO-GO" | "CONDITIONAL" | "INSUFFICIENT_DATA";

interface ReleaseBug {
  key: string;
  summary: string;
  priority?: string;
}

interface ReleaseEvaluation {
  version: string;
  score: number | null;
  verdict: {
    verdict: Verdict;
    reason: string;
    primary_blocker: string | null;
    blockers: string[];
    recommendation: string;
    conditions: string[];
  };
  signals: {
    test_pass_rate: number | null;
    open_critical_bugs: ReleaseBug[] | null;
    open_critical_bug_count: number | null;
    unresolved_security_findings: number | null;
    avg_defect_risk: number | null;
    workflow_summary?: { total_runs?: number; recent_evaluated?: number };
  };
  scored_signals: string[];
  not_evaluated: Record<string, string>;
  errors: string[];
}

const VERDICT: Record<Verdict, { label: string; tone: StatusTone; mark: MarkId }> = {
  GO: { label: "Go", tone: "success", mark: "mark-verdict-go" },
  "NO-GO": { label: "No-go", tone: "critical", mark: "mark-verdict-no-go" },
  CONDITIONAL: { label: "Conditional", tone: "warning", mark: "mark-verdict-conditional" },
  INSUFFICIENT_DATA: { label: "Insufficient data", tone: "neutral", mark: "mark-verdict-not-evaluated" },
};

const SIGNAL_LABEL: Record<string, string> = {
  test_pass_rate: "CI pass rate",
  open_critical_bugs: "Open critical bugs",
  unresolved_security_findings: "Security findings",
  avg_defect_risk: "Defect risk",
};

const BUG_PRIORITY_RANK: Record<string, number> = { Blocker: 5, Highest: 4, Critical: 4, High: 3, Medium: 2, Low: 1, Lowest: 0 };

const BUG_COLUMNS: DataTableColumn<ReleaseBug>[] = [
  { id: "key", header: "Key", mono: true, width: "w-28", cell: (b) => b.key, sortValue: (b) => b.key },
  { id: "summary", header: "Summary", grow: true, cell: (b) => b.summary, sortValue: (b) => b.summary },
  {
    id: "priority",
    header: "Priority",
    width: "w-28",
    cell: (b) => b.priority ?? "",
    sortValue: (b) => (b.priority ? (BUG_PRIORITY_RANK[b.priority] ?? 0) : null),
  },
];

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
// A tile without a measurement says so in body type; the display face is for figures.
const NOT_EVALUATED = <span className="font-sans text-base font-medium text-ink-tertiary">Not evaluated</span>;

function errorDetail(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : "Evaluation failed. Check repository access and API keys.";
}

export default function ReleaseGate() {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [form, setForm] = useState({
    version: "",
    owner: activeRepo?.owner ?? "",
    repo: activeRepo?.repo ?? "",
    jira_project: "",
  });

  const evaluateMutation = useMutation({
    mutationFn: (): Promise<ReleaseEvaluation> => api.evaluateRelease({
      version: form.version || "HEAD",
      owner: form.owner,
      repo: form.repo,
      jira_project: form.jira_project || undefined,
    }),
  });

  const result = evaluateMutation.data;
  const verdict = result?.verdict;
  const signals = result?.signals;
  const notEvaluated = result?.not_evaluated ?? {};
  const vcfg = verdict ? VERDICT[verdict.verdict] ?? VERDICT.INSUFFICIENT_DATA : null;
  const insufficient = verdict?.verdict === "INSUFFICIENT_DATA";
  const bugCount = signals?.open_critical_bug_count ?? signals?.open_critical_bugs?.length ?? null;

  return (
    <PageShell>
      <PageHeader
        title="Release Gate"
        description="Scores release readiness from the signals that could be measured. The verdict follows fixed thresholds; a signal that was not evaluated is shown as such and earns no points."
      />

      <Panel className="bg-container">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="rg-owner" className={fieldLabel}>GitHub owner</label>
            <Input id="rg-owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="e.g. expressjs" />
          </div>
          <div>
            <label htmlFor="rg-repo" className={fieldLabel}>Repository</label>
            <Input id="rg-repo" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} placeholder="e.g. express" />
          </div>
          <div>
            <label htmlFor="rg-version" className={fieldLabel}>Version / tag</label>
            <Input id="rg-version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="e.g. v2.3.1" />
          </div>
          <div>
            <label htmlFor="rg-jira" className={fieldLabel}>
              Jira project key <span className="font-normal text-ink-quaternary">(optional)</span>
            </label>
            <Input id="rg-jira" value={form.jira_project} onChange={(e) => setForm({ ...form, jira_project: e.target.value })} placeholder="e.g. PROJ" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-xs text-ink-tertiary">
            Without a Jira project key the bug signal is not evaluated and is left out of the score.
          </p>
          <Button
            onClick={() => {
              if (form.owner && form.repo) setActiveRepo({ owner: form.owner, repo: form.repo, repoUrl: `https://github.com/${form.owner}/${form.repo}`, branch: activeRepo?.branch || "main" });
              evaluateMutation.mutate();
            }}
            disabled={!form.owner || !form.repo || evaluateMutation.isPending}
            className="gap-2"
          >
            {evaluateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {evaluateMutation.isPending ? "Evaluating" : "Evaluate release"}
          </Button>
        </div>
        {evaluateMutation.isError && <p className="mt-3 text-sm text-destructive">{errorDetail(evaluateMutation.error)}</p>}
      </Panel>

      {result && verdict && vcfg && signals && (
        <>
          <Panel className="bg-container" padded={false}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stroke-muted px-4 py-3">
              <Mark id={vcfg.mark} size={40} />
              <StatusBadge tone={vcfg.tone} size="md">{vcfg.label}</StatusBadge>
              <span className="font-mono text-xs text-ink-secondary">{result.version}</span>
              <span className="ml-auto text-xs tabular-nums text-ink-tertiary">
                {result.score === null ? "No score" : `Score ${result.score} / 100`}
              </span>
            </div>
            <div className="space-y-4 px-4 py-4">
              <div>
                <h2 className={eyebrow}>{insufficient ? "Why there is no verdict" : "Why this verdict"}</h2>
                <p className="mt-1.5 text-sm text-ink">{verdict.reason}</p>
                {insufficient && (
                  <p className="mt-1.5 text-xs text-ink-tertiary">
                    A release is not scored without completed CI runs. Fix the cause above and evaluate again.
                  </p>
                )}
              </div>
              {verdict.blockers.length > 0 && (
                <div>
                  <h2 className={eyebrow}>Blockers</h2>
                  <ul className="mt-1.5 space-y-1">
                    {verdict.blockers.map((b) => (
                      <li key={b} className="text-sm text-destructive">{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              {verdict.conditions.length > 0 && (
                <div>
                  <h2 className={eyebrow}>Conditions to resolve</h2>
                  <ul className="mt-1.5 space-y-1">
                    {verdict.conditions.map((c) => (
                      <li key={c} className="text-sm text-ink-secondary">{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {verdict.recommendation && (
                <div>
                  <h2 className={eyebrow}>Recommendation · AI-written summary of the figures above</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{verdict.recommendation}</p>
                </div>
              )}
            </div>
          </Panel>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiStat mark="mark-kpi-pass-rate"
              className="bg-container"
              label="CI pass rate"
              value={signals.test_pass_rate === null ? NOT_EVALUATED : `${signals.test_pass_rate}%`}
              hint={
                signals.test_pass_rate === null
                  ? notEvaluated.test_pass_rate
                  : `of the last ${signals.workflow_summary?.recent_evaluated ?? 0} completed runs`
              }
            />
            <KpiStat mark="mark-int-issue-tracker"
              className="bg-container"
              label="Open critical bugs"
              value={bugCount === null ? NOT_EVALUATED : bugCount}
              hint={bugCount === null ? notEvaluated.open_critical_bugs : "blocker, critical or high priority"}
            />
            <KpiStat mark="mark-release-gate"
              className="bg-container"
              label="Security findings"
              value={signals.unresolved_security_findings === null ? NOT_EVALUATED : signals.unresolved_security_findings}
              hint={signals.unresolved_security_findings === null ? notEvaluated.unresolved_security_findings : "unresolved"}
            />
            <KpiStat mark="mark-change-hotspots"
              className="bg-container"
              label="Defect risk"
              value={signals.avg_defect_risk === null ? NOT_EVALUATED : `${signals.avg_defect_risk}%`}
              hint={signals.avg_defect_risk === null ? notEvaluated.avg_defect_risk : "average across changed files"}
            />
          </div>

          <Panel className="bg-container">
            <h2 className={eyebrow}>What the score used</h2>
            <p className="mt-1.5 text-sm text-ink-secondary">
              {result.scored_signals.length
                ? result.scored_signals.map((s) => SIGNAL_LABEL[s] ?? s).join(", ")
                : "Nothing: no signal could be scored."}
            </p>
            {Object.keys(notEvaluated).length > 0 && (
              <p className="mt-1 text-xs text-ink-tertiary">
                Left out: {Object.keys(notEvaluated).map((s) => SIGNAL_LABEL[s] ?? s).join(", ")}.
              </p>
            )}
          </Panel>

          {(signals.open_critical_bugs?.length ?? 0) > 0 && (
            <DataTable
              caption="Open critical bugs"
              columns={BUG_COLUMNS}
              rows={signals.open_critical_bugs!}
              rowKey={(b) => b.key}
              searchText={signals.open_critical_bugs!.length > 20 ? (b) => `${b.key} ${b.summary} ${b.priority ?? ""}` : undefined}
              searchPlaceholder="Filter bugs"
              pageSize={25}
            />
          )}

          {result.errors.length > 0 && (
            <Panel className="bg-container">
              <h2 className={eyebrow}>Problems during evaluation</h2>
              <ul className="mt-1.5 space-y-1">
                {result.errors.map((e) => (
                  <li key={e} className="text-xs text-ink-secondary">{withConnectorsLink(e)}</li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </PageShell>
  );
}
