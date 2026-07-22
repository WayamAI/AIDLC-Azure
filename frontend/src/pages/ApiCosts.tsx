import { useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { DollarSign, Zap, BarChart2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { PageStat } from "@/components/PageHeader";

interface CostLog {
  task_name: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number; 
  created_at: string;
}

interface CostLogsResponse {
  logs: CostLog[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  grand_total_cost_usd: number;
}

const LIMIT = 10;

function fmt(n: number) {
  return `$${n.toFixed(4)}`;
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

  const { data, isLoading, isFetching, refetch } = useQuery<CostLogsResponse>({
    queryKey: ["cost-logs", page],
    queryFn: () =>
      apiClient.get(`/cost-logs?page=${page}&limit=${LIMIT}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const totalPages = data?.total_pages ?? 1;
  const grandTotal = data?.grand_total_cost_usd ?? 0;
  const totalCalls = data?.total ?? 0;
  const avgCost = totalCalls > 0 ? grandTotal / totalCalls : 0;

  return (
    <PageShell size="full" className="space-y-6">
      <PageHeader
        icon={DollarSign}
        title="API Cost Tracker"
        description={`Monitor LLM usage across ${BRAND_NAME} $2.50 / 1M input tokens · $10.00 / 1M output tokens`}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PageStat icon={DollarSign} label="Total cost" value={`$${grandTotal.toFixed(4)}`} accent="positive" />
        <PageStat icon={Zap} label="API calls" value={totalCalls.toLocaleString()} accent="primary" />
        <PageStat icon={BarChart2} label="Avg cost / call" value={`$${avgCost.toFixed(4)}`} accent="warning" />
      </div>

      <PageCard padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">#</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Timestamp</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Task</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Model</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">In Tokens</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Out Tokens</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total Tokens</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Input Cost</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Output Cost</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground pr-5">Total Cost</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              )}
              {!isLoading && (!data?.logs || data.logs.length === 0) && (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-muted-foreground">
                    No API calls logged yet. Make an AI request to see costs here.
                  </td>
                </tr>
              )}
              {!isLoading &&
                data?.logs.map((log, i) => {
                  const rowNum = (page - 1) * LIMIT + i + 1;
                  return (
                    <tr
                      key={i}
                      className="border-b border-border hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{rowNum}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap tabular-nums">
                        {fmtTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-primary/20">
                          {log.task_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-border">
                          {log.model}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {log.prompt_tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {log.completion_tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-foreground">
                        {log.total_tokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmt(log.input_cost_usd)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {fmt(log.output_cost_usd)}
                      </td>
                      <td className="px-4 py-3 pr-5 text-right tabular-nums font-semibold text-positive">
                        {fmt(log.total_cost_usd)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages} &nbsp;·&nbsp; {totalCalls} total records
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const pageNum = getPageNumber(i, page, totalPages);
                return pageNum === -1 ? (
                  <span key={i} className="px-1 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`min-w-[32px] rounded-md px-2 py-1 text-xs transition-colors ${
                      pageNum === page
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </PageCard>
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
