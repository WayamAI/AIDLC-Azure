import { RepoInput } from "@/components/RepoInput";
import { EmptyState } from "@/components/EmptyState";
import { ErrorText } from "@/components/ErrorText";
import { GITHUB_STALE_MS } from "@/lib/query-times";
import { useState } from "react";
import { FileIcon } from "@/components/FileIcon";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "@/lib/api";
import { useActiveRepo } from "@/context/RepoContext";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { ChartTooltipBox } from "@/components/dashboard/DashboardUi";

const LEVEL: Record<string, { label: string; tone: StatusTone }> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "info" },
  low: { label: "Low", tone: "neutral" },
};

const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

/** Score bands match the backend's risk_level thresholds (75 / 50 / 25). */
function scoreColor(score: number): string {
  if (score >= 75) return "var(--color-status-critical)";
  if (score >= 50) return "var(--color-status-warning)";
  if (score >= 25) return "var(--color-status-info)";
  return "var(--color-status-neutral)";
}

function CustomTreemapContent({ x, y, width, height, name, risk_score }: any) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={scoreColor(risk_score)} stroke="var(--color-container)" strokeWidth={2} rx={4} />
      {width > 50 && height > 25 && (
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fill="var(--color-status-content)" fontSize={10} fontWeight={500} dominantBaseline="middle">
          {name?.split("/").pop()?.slice(0, 20)}
        </text>
      )}
    </g>
  );
}

interface HotspotFile {
  filename: string;
  change_count: number;
  bug_fix_count: number;
  bug_fix_ratio: number;
  author_count: number;
  churn: number;
  risk_score: number;
  risk_level: string;
}

export default function DefectPrediction() {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [repoCoords, setRepoCoords] = useState<{ owner: string; repo: string } | null>(
    activeRepo ? { owner: activeRepo.owner, repo: activeRepo.repo } : null,
  );

  const riskQuery = useQuery({
    queryKey: ["defect-risk", repoCoords?.owner, repoCoords?.repo],
    queryFn: () => api.getDefectRiskScores(repoCoords!.owner, repoCoords!.repo),
    enabled: !!(repoCoords?.owner && repoCoords?.repo),
    staleTime: GITHUB_STALE_MS,
  });

  const data = riskQuery.data as any;
  const files: HotspotFile[] = data?.files || [];
  const rankOf = new Map(files.map((f, i) => [f.filename, i + 1]));

  const columns: DataTableColumn<HotspotFile>[] = [
    {
      id: "rank",
      header: "#",
      align: "right",
      width: "w-14",
      cell: (f) => <span className="text-xs text-ink-quaternary">{rankOf.get(f.filename)}</span>,
      sortValue: (f) => rankOf.get(f.filename),
    },
    { id: "file", header: "File", grow: true, mono: true, cell: (f) => (
        <span className="flex min-w-0 items-center gap-2 text-ink">
          <FileIcon name={f.filename} size={14} />
          <span className="truncate">{f.filename}</span>
        </span>
      ), title: (f) => f.filename, sortValue: (f) => f.filename },
    { id: "changes", header: "Changes", align: "right", hideBelow: "sm", cell: (f) => f.change_count, sortValue: (f) => f.change_count },
    {
      id: "bugfix",
      header: "Bug-fix commits",
      align: "right",
      hideBelow: "md",
      cell: (f) => (
        <>
          {f.bug_fix_count} <span className="text-xs text-ink-tertiary">({f.bug_fix_ratio}%)</span>
        </>
      ),
      sortValue: (f) => f.bug_fix_count,
    },
    { id: "authors", header: "Authors", align: "right", hideBelow: "md", cell: (f) => f.author_count, sortValue: (f) => f.author_count },
    { id: "churn", header: "Lines churned", align: "right", hideBelow: "lg", cell: (f) => f.churn, sortValue: (f) => f.churn },
    {
      id: "score",
      header: "Score",
      align: "right",
      width: "w-24",
      cell: (f) => (
        <span className="font-medium text-ink">
          {f.risk_score}
          <span className="ml-0.5 text-xs font-normal text-ink-quaternary">/100</span>
        </span>
      ),
      sortValue: (f) => f.risk_score,
    },
    {
      id: "level",
      header: "Band",
      width: "w-28",
      cell: (f) => {
        const level = LEVEL[f.risk_level] || LEVEL.low;
        return (
          <StatusBadge tone={level.tone} className="w-[64px] justify-center">
            {level.label}
          </StatusBadge>
        );
      },
      sortValue: (f) => f.risk_score,
    },
  ];
  const commitsAnalysed = data?.total_commits_analysed ?? data?.total_commits;
  const treemapData = files.map((f) => ({
    name: f.filename,
    size: Math.max(f.churn, 10),
    risk_score: f.risk_score,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Change Hotspots"
        description="Ranks files by how often and how heavily they changed in recent commits. This is a churn-based hotspot ranking computed from git history, not a trained prediction model."
      />

      <RepoInput
        id="hotspot-repo"
        action="Analyse"
        busy={riskQuery.isFetching}
        defaultUrl={activeRepo?.repoUrl ?? ""}
        onSearch={(owner, repo) => {
          setRepoCoords({ owner, repo });
          setActiveRepo({ owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, branch: activeRepo?.branch || "main" });
        }}
      />

      {riskQuery.isLoading && (
        <Panel>
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading commit history (up to 50 commits)…
          </p>
        </Panel>
      )}

      {riskQuery.isError && (
        <Panel>
          <EmptyState kind="error" compact>
            <ErrorText error={riskQuery.error} fallback="The repository could not be analysed. Check the owner and repository name." />
          </EmptyState>
        </Panel>
      )}

      {data && files.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiStat mark="mark-kpi-commits-analysed" label="Commits analysed" value={commitsAnalysed ?? "–"} hint="the whole ranking is based on these" />
            <KpiStat mark="mark-change-hotspots" label="Files changed" value={data.total_files_analysed} hint="in those commits" />
            <KpiStat mark="mark-kpi-high-priority" label="Score 50 or higher" value={data.high_risk_count} hint="across all files" />
            <KpiStat mark="mark-incidents"
              label="Score 75 or higher"
              value={files.filter((f) => f.risk_level === "critical").length}
              hint="among the listed files"
            />
          </div>

          {data.narrative ? (
            <PageCard title="AI summary of the ranking" description="Written by the model from the top 10 files below">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">{data.narrative}</p>
            </PageCard>
          ) : (
            <PageCard title="AI summary of the ranking">
              <p className="text-sm text-ink-tertiary">
                Not available: the model did not return a summary. The ranking below is computed from the commit
                history and does not depend on it.
              </p>
              {data.narrative_error && (
                <p className="mt-1 text-xs text-destructive">
                  <ErrorText error={String(data.narrative_error)} />
                </p>
              )}
            </PageCard>
          )}

          {treemapData.length > 0 && (
            <PageCard title="Hotspot map" description="Area = lines added + deleted · colour = score band">
              <ResponsiveContainer width="100%" height={300}>
                <Treemap data={treemapData} dataKey="size" content={<CustomTreemapContent />} isAnimationActive={false}>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <ChartTooltipBox
                          label={d.name}
                          rows={[{ name: "Hotspot score", value: d.risk_score, color: scoreColor(d.risk_score) }]}
                        />
                      );
                    }}
                  />
                </Treemap>
              </ResponsiveContainer>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
                {[
                  { label: "75–100", score: 75 },
                  { label: "50–74", score: 50 },
                  { label: "25–49", score: 25 },
                  { label: "0–24", score: 0 },
                ].map((band) => (
                  <li key={band.label} className="flex items-center gap-1.5 tabular-nums">
                    <span className="h-2 w-2 rounded-full" style={{ background: scoreColor(band.score) }} />
                    {band.label}
                  </li>
                ))}
              </ul>
            </PageCard>
          )}

          <PageCard
            title="Change hotspots"
            description="Score 0–100 = 30% change count + 35% share of changes that were bug-fix commits + 20% churn + 15% author count, each relative to the other files. Not a probability."
            actions={
              <span className="text-xs tabular-nums text-ink-secondary">
                Top {files.length} files · {commitsAnalysed ?? "–"} commits analysed
              </span>
            }
            padding={false}
          >
            <DataTable
              bare
              columns={columns}
              rows={files}
              rowKey={(f) => f.filename}
              searchText={(f) => f.filename}
              searchPlaceholder="Filter files"
              pageSize={25}
            />
          </PageCard>
        </>
      )}

      {data && files.length === 0 && (
        <Panel>
          <p className="py-8 text-center text-sm text-ink-tertiary">
            {data.narrative || "No changed files were found in the recent commits of this repository."}
            {commitsAnalysed != null && <span className="tabular-nums"> {commitsAnalysed} commits analysed.</span>}
          </p>
        </Panel>
      )}
    </PageShell>
  );
}
