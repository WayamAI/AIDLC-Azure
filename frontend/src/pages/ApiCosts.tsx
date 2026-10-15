import { useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { cn } from "@/lib/utils";

interface UsageLog {
  task_name: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

interface UsageLogsResponse {
  logs: UsageLog[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

interface UsageRow {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls_without_usage: number;
}

interface UsageSummary {
  days: number;
  since: string;
  totals: UsageRow;
  by_task: (UsageRow & { task_name: string })[];
  by_day: (UsageRow & { date: string })[];
}

const LIMIT = 10;
const PERIODS = [7, 30, 90] as const;

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
/** The four count columns shared by the per-task and per-day breakdowns. */
function usageColumns<T extends UsageRow>(): DataTableColumn<T>[] {
  return [
    { id: "calls", header: "Calls", align: "right", cell: (r) => num(r.calls), sortValue: (r) => r.calls },
    { id: "input", header: "Input", align: "right", cell: (r) => num(r.prompt_tokens), sortValue: (r) => r.prompt_tokens },
    { id: "output", header: "Output", align: "right", cell: (r) => num(r.completion_tokens), sortValue: (r) => r.completion_tokens },
    {
      id: "total",
      header: "Total tokens",
      align: "right",
      cell: (r) => <span className="text-ink">{num(r.total_tokens)}</span>,
      sortValue: (r) => r.total_tokens,
    },
  ];
}

type TaskRow = UsageSummary["by_task"][number];
type DayRow = UsageSummary["by_day"][number];

const TASK_COLUMNS: DataTableColumn<TaskRow>[] = [
  { id: "task", header: "Task", grow: true, cell: (r) => <span className="text-ink">{r.task_name}</span>, title: (r) => r.task_name, sortValue: (r) => r.task_name },
  ...usageColumns<TaskRow>(),
];

const DAY_COLUMNS: DataTableColumn<DayRow>[] = [
  { id: "date", header: "Date", cell: (r) => <span className="tabular-nums text-ink">{r.date}</span>, sortValue: (r) => r.date },
  ...usageColumns<DayRow>(),
];

// Server-paged, so these columns are not sortable: sorting one page of ten would mislead.
const LOG_COLUMNS: DataTableColumn<UsageLog>[] = [
  { id: "time", header: "Timestamp", cell: (r) => <span className="tabular-nums">{fmtTime(r.created_at)}</span> },
  { id: "task", header: "Task", grow: true, cell: (r) => <span className="text-ink">{r.task_name}</span>, title: (r) => r.task_name },
  { id: "model", header: "Model", mono: true, cell: (r) => r.model ?? "–" },
  { id: "input", header: "Input", align: "right", cell: (r) => num(r.prompt_tokens) },
  { id: "output", header: "Output", align: "right", cell: (r) => num(r.completion_tokens) },
  {
    id: "total",
    header: "Total tokens",
    align: "right",
    cell: (r) =>
      r.total_tokens ? <span className="text-ink">{num(r.total_tokens)}</span> : <span className="text-ink-tertiary">not reported</span>,
  },
];

function num(n: number | undefined) {
  return (n ?? 0).toLocaleString();
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function ApiCosts() {
  const [page, setPage] = useState(1);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);

  const logsQuery = useQuery<UsageLogsResponse>({
    queryKey: ["cost-logs", page],
    queryFn: () =>
      apiClient.get(`/cost-logs?page=${page}&limit=${LIMIT}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const summaryQuery = useQuery<UsageSummary>({
    queryKey: ["cost-logs", "summary", days],
    queryFn: () => apiClient.get(`/cost-logs/summary?days=${days}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const data = logsQuery.data;
  const summary = summaryQuery.data;
  const totals = summary?.totals;
  const totalPages = data?.total_pages ?? 1;
  const totalCalls = data?.total ?? 0;
  const activeDays = (summary?.by_day ?? []).filter((d) => d.calls > 0).reverse();
  const isFetching = logsQuery.isFetching || summaryQuery.isFetching;
  const stat = (n: number | undefined) => (totals ? num(n) : "–");

  return (
    <PageShell>
      <PageHeader
        title="Usage & Cost"
        description={`Calls and tokens used by ${BRAND_NAME}'s AI features, as reported by the model provider. The configured provider is not billed per token, so no cost is shown.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => { logsQuery.refetch(); summaryQuery.refetch(); }}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className={cn(eyebrow, "mr-2")}>Period</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDays(p)}
            aria-pressed={days === p}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              days === p
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-ink-secondary hover:bg-raised",
            )}
          >
            Last {p} days
          </button>
        ))}
        <span className="text-xs text-ink-tertiary">Days are counted in UTC.</span>
      </div>

      {summaryQuery.isError && (
        <Panel>
          <p className="text-sm text-destructive">Usage summary could not be loaded.</p>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiStat mark="mark-kpi-ai-calls"
          label="AI calls"
          value={stat(totals?.calls)}
          hint={
            totals && totals.calls_without_usage > 0
              ? `${num(totals.calls_without_usage)} reported no token usage`
              : `last ${days} days`
          }
        />
        <KpiStat mark="mark-kpi-tokens" label="Total tokens" value={stat(totals?.total_tokens)} hint="input + output" />
        <KpiStat mark="mark-kpi-tokens" label="Input tokens" value={stat(totals?.prompt_tokens)} />
        <KpiStat mark="mark-kpi-tokens" label="Output tokens" value={stat(totals?.completion_tokens)} />
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <DataTable
          caption={`By task · last ${days} days`}
          columns={TASK_COLUMNS}
          rows={summary?.by_task ?? []}
          rowKey={(r) => r.task_name}
          loading={summaryQuery.isLoading}
          empty="No AI calls in this period."
        />

        <DataTable
          caption={`By day · last ${days} days`}
          columns={DAY_COLUMNS}
          rows={activeDays}
          rowKey={(r) => r.date}
          loading={summaryQuery.isLoading}
          empty="No AI calls in this period."
          stickyHeader
          maxHeightClassName="max-h-[420px]"
          footer={activeDays.length > 0 ? "Days with no calls are not listed." : undefined}
        />
      </div>

      <DataTable
        caption="Recent calls · all time"
        columns={LOG_COLUMNS}
        rows={data?.logs ?? []}
        rowKey={(log) => `${log.created_at}-${data?.logs.indexOf(log)}`}
        loading={logsQuery.isLoading}
        empty={
          logsQuery.isError ? (
            <span className="text-destructive">Recent calls could not be loaded.</span>
          ) : (
            "No AI calls logged yet. Use any AI feature and it will appear here."
          )
        }
        footer={
          totalPages > 1 ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-tertiary">
              Page {page} of {totalPages} · {num(totalCalls)} calls
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-md p-1.5 text-ink-tertiary transition-colors hover:bg-raised disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const pageNum = getPageNumber(i, page, totalPages);
                return pageNum === -1 ? (
                  <span key={`gap-${i}`} className="px-1 text-ink-tertiary">
                    …
                  </span>
                ) : (
                  <button
                    key={`page-${pageNum}`}
                    type="button"
                    onClick={() => setPage(pageNum)}
                    aria-current={pageNum === page ? "page" : undefined}
                    className={cn(
                      "min-w-[32px] rounded-full border px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                      pageNum === page
                        ? "border-transparent bg-primary text-primary-foreground"
                        : "border-transparent text-ink-secondary hover:bg-raised",
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                type="button"
                aria-label="Next page"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-md p-1.5 text-ink-tertiary transition-colors hover:bg-raised disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          ) : undefined
        }
      />
    </PageShell>
  );
}

function getPageNumber(index: number, current: number, total: number): number {
  if (total <= 7) return index + 1;
  const pages = [];
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, -1, total);
  } else if (current >= total - 3) {
    pages.push(1, -1, total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, -1, current - 1, current, current + 1, -1, total);
  }
  return pages[index] ?? -1;
}
