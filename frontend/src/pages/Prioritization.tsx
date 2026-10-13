import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrioritizedTests, useRefreshPrioritization } from "@/hooks/use-prioritization";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, FilterPills, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import type { PrioritizedTest } from "@/lib/api";

type Filter = "all" | "high" | "medium" | "low" | "known";

const FILTERS: { key: Filter; label: string; match: (t: PrioritizedTest) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "high", label: "High ≥60", match: (t) => t.priority >= 60 },
  { key: "medium", label: "Medium 30–59", match: (t) => t.priority >= 30 && t.priority < 60 },
  { key: "low", label: "Low <30", match: (t) => t.priority < 30 },
  { key: "known", label: "Known failures", match: (t) => t.known_failure },
];

const neverVerified = (t: PrioritizedTest) => t.status === "warning" && t.total_runs === 0;

function statusOf(t: PrioritizedTest): { label: string; tone: StatusTone } {
  if (t.status === "failed") return { label: "Failing", tone: "critical" };
  if (t.status === "stable") return { label: "Stable", tone: "success" };
  return neverVerified(t) ? { label: "Unverified", tone: "pending" } : { label: "At risk", tone: "warning" };
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const firstLine = (text: string) => text.split(/\r?\n/, 1)[0].trim();

const hasError = (t: PrioritizedTest) => t.status === "failed" && !!t.last_error;

const Prioritization = () => {
  const { data, isLoading, isError } = usePrioritizedTests();
  const refreshMutation = useRefreshPrioritization();
  const [filter, setFilter] = useState<Filter>("all");

  const rawTests = data ?? [];
  const rankOf = new Map(rawTests.map((t, i) => [t.id, i + 1]));
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const visible = rawTests.filter(active.match);

  const columns: DataTableColumn<PrioritizedTest>[] = [
    {
      id: "rank",
      header: "#",
      align: "right",
      width: "w-14",
      cell: (t) => <span className="text-xs text-ink-quaternary">{rankOf.get(t.id)}</span>,
      sortValue: (t) => rankOf.get(t.id),
    },
    { id: "id", header: "Id", mono: true, width: "w-24", cell: (t) => t.tc_id, sortValue: (t) => t.tc_id },
    {
      id: "name",
      header: "Test case",
      wrap: true,
      cell: (t) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink">{t.name}</span>
            {t.known_failure && <StatusBadge tone="neutral">Known failure</StatusBadge>}
          </div>
          <p className="mt-0.5 text-xs text-ink-tertiary">{t.reason}</p>
          {hasError(t) && (
            <p className="mt-1 max-w-[40rem] truncate font-mono text-xs text-destructive" title="Expand the row for the full error">
              {firstLine(t.last_error ?? "")}
            </p>
          )}
        </>
      ),
      sortValue: (t) => t.name,
    },
    {
      id: "severity",
      header: "Severity",
      width: "w-28",
      cell: (t) => <span className="text-xs">{t.severity}</span>,
      sortValue: (t) => SEVERITY_RANK[String(t.severity).toLowerCase()] ?? 0,
    },
    {
      id: "failed",
      header: "Failed / runs",
      align: "right",
      width: "w-32",
      cell: (t) => <span className="text-xs">{t.total_runs ? `${t.failure_count} / ${t.total_runs}` : "–"}</span>,
      sortValue: (t) => (t.total_runs ? t.failure_count : null),
    },
    {
      id: "score",
      header: "Score",
      align: "right",
      width: "w-24",
      cell: (t) => <span className="font-mono text-ink">{t.priority}</span>,
      sortValue: (t) => t.priority,
    },
    {
      id: "status",
      header: "Status",
      width: "w-32",
      cell: (t) => <StatusBadge tone={statusOf(t).tone}>{statusOf(t).label}</StatusBadge>,
      sortValue: (t) => statusOf(t).label,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Risk Ranking"
        description="Test cases ranked by how often they failed in recent browser runs, weighted by severity. The score is computed from run results; each row states how it was reached."
        actions={
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isLoading}
            variant="outline"
            className="gap-2"
          >
            {refreshMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        }
      />

      {refreshMutation.isError && <p className="text-sm text-destructive">The ranking could not be refreshed.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiStat mark="mark-kpi-cases-ranked" label="Cases ranked" value={rawTests.length} />
        <KpiStat mark="mark-kpi-failed" label="Failing now" value={rawTests.filter((t) => t.status === "failed").length} hint="failed in the latest run" />
        <KpiStat mark="mark-kpi-known-failure" label="Known failures" value={rawTests.filter((t) => t.known_failure).length} />
        <KpiStat mark="mark-kpi-skipped" label="Never verified" value={rawTests.filter(neverVerified).length} hint="no run could check them" />
      </div>

      <DataTable
        caption="Ranking"
        columns={columns}
        rows={visible}
        rowKey={(t) => t.id}
        loading={isLoading}
        renderExpanded={(t) => (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">{t.last_error}</pre>
        )}
        canExpand={hasError}
        searchText={(t) => `${t.tc_id} ${t.name} ${t.severity} ${t.reason}`}
        searchPlaceholder="Filter cases"
        pageSize={50}
        empty={
          isError ? (
            <span className="text-destructive">Could not load the ranking. Confirm the API is running and refresh.</span>
          ) : rawTests.length === 0 ? (
            "No ranking yet. Run a test suite from Test Execution first."
          ) : (
            "No cases in this view."
          )
        }
        toolbar={
          <FilterPills<Filter>
            label="Priority band"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f.key, label: f.label, count: rawTests.filter(f.match).length }))}
          />
        }
      />
    </PageShell>
  );
};

export default Prioritization;
