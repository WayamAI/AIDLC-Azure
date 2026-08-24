import { useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Bug, Search, AlertTriangle, TrendingUp, FileCode, Users, GitCommit, Loader2, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Treemap, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "@/lib/api";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ChartTooltipBox } from "@/components/dashboard/DashboardUi";

const RISK_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  high: { color: "text-[var(--color-warning)]", bg: "bg-[var(--color-warning-bg)]", border: "border-[var(--color-status-warning)]/30" },
  medium: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  low: { color: "text-positive", bg: "bg-positive/10", border: "border-positive/25" },
};

function RiskBadge({ level }: { level: string }) {
  const cfg = RISK_CONFIG[level] || RISK_CONFIG.low;
  return (
    <Badge className={`text-[10px] border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {level.toUpperCase()}
    </Badge>
  );
}

function CustomTreemapContent({ x, y, width, height, name, risk_score }: any) {
  const color = risk_score >= 75 ? "#DC2626" : risk_score >= 50 ? "#B45309" : risk_score >= 25 ? "#AFAFAF" : "#6B7280";
  const textFill = risk_score >= 50 ? "#ffffff" : "#1c1917";
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color} fillOpacity={risk_score >= 50 ? 0.85 : 0.55} stroke="#fff" strokeWidth={1} rx={4} />
      {width > 50 && height > 25 && (
        <text x={x + width / 2} y={y + height / 2} textAnchor="middle" fill={textFill} fontSize={10} fontWeight={600} dominantBaseline="middle">
          {name?.split("/").pop()?.slice(0, 20)}
        </text>
      )}
    </g>
  );
}

const DEFAULT_REPO_URL = "";

function RepoInput({ onSearch }: { onSearch: (owner: string, repo: string) => void }) {
  const [input, setInput] = useState(DEFAULT_REPO_URL);
  const handle = () => {
    const parts = input.trim().replace("https://github.com/", "").split("/");
    if (parts.length >= 2) onSearch(parts[0], parts[1]);
  };
  return (
    <div className="floating-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Bug className="h-4 w-4 text-primary" />
        <span className="font-display font-medium text-sm">Connect GitHub Repository</span>
      </div>
      <div className="flex gap-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={DEFAULT_REPO_URL}
          className="flex-1 bg-muted/30 border-border/50"
          onKeyDown={(e) => e.key === "Enter" && handle()}
        />
        <Button onClick={handle} disabled={!input.trim()} className="bg-primary text-primary-foreground">
          <Search className="h-4 w-4 mr-2" />
          Analyse
        </Button>
      </div>
    </div>
  );
}

export default function DefectPrediction() {
  const [repoCoords, setRepoCoords] = useState<{ owner: string; repo: string } | null>(null);

  const riskQuery = useQuery({
    queryKey: ["defect-risk", repoCoords?.owner, repoCoords?.repo],
    queryFn: () => api.getDefectRiskScores(repoCoords!.owner, repoCoords!.repo),
    enabled: !!(repoCoords?.owner && repoCoords?.repo),
  });

  const data = riskQuery.data as any;
  const files = data?.files || [];
  const treemapData = files.map((f: any) => ({
    name: f.filename,
    size: Math.max(f.churn, 10),
    risk_score: f.risk_score,
  }));

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <PageHeader
          icon={ShieldAlert}
          title="Defect Prediction"
          description="Analyse commit history to score each file on defect likelihood based on change frequency, bug-fix association, and code churn."
        />

        <RepoInput onSearch={(owner, repo) => setRepoCoords({ owner, repo })} />

        {riskQuery.isLoading && (
          <div className="mt-8 flex items-center justify-center gap-3 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Analysing commit history (up to 50 commits)…</span>
          </div>
        )}

        {riskQuery.isError && (
          <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            Failed to analyse repository. Check the repo name and GitHub token.
          </div>
        )}

        {data && files.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <PageStat icon={FileCode} label="Files Analysed" value={data.total_files_analysed} accent="primary" />
              <PageStat icon={GitCommit} label="Commits Analysed" value={data.total_commits_analysed} accent="primary" />
              <PageStat icon={AlertTriangle} label="High Risk Files" value={data.high_risk_count} accent="warning" />
              <PageStat icon={Bug} label="Critical Files" value={files.filter((f: any) => f.risk_level === "critical").length} accent="destructive" />
            </div>

            {/* AI Narrative */}
            {data.narrative && (
              <div className="floating-card p-6">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-[13px] font-semibold tracking-tight">AI Risk Narrative</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{data.narrative}</p>
              </div>
            )}

            {/* Treemap */}
            {treemapData.length > 0 && (
              <div className="floating-card p-6">
                <p className="text-[13px] font-semibold tracking-tight mb-1">Risk Heatmap</p>
                <p className="text-xs text-muted-foreground mb-4">Node size = code churn · Color: green (low risk) → red (critical)</p>
                <ResponsiveContainer width="100%" height={300}>
                  <Treemap
                    data={treemapData}
                    dataKey="size"
                    content={<CustomTreemapContent />}
                  >
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        const color = d.risk_score >= 75 ? "#DC2626" : d.risk_score >= 50 ? "#B45309" : d.risk_score >= 25 ? "#AFAFAF" : "#6B7280";
                        return (
                          <ChartTooltipBox
                            label={d.name}
                            rows={[{ name: "Risk Score", value: d.risk_score, color }]}
                          />
                        );
                      }}
                    />
                  </Treemap>
                </ResponsiveContainer>
              </div>
            )}

            {/* File table */}
            <div className="floating-card p-6">
              <p className="text-[13px] font-semibold tracking-tight mb-4">Top Risk Files</p>
              <div className="space-y-2">
                {files.map((f: any, i: number) => (
                  <div key={f.filename} className="flex items-center gap-3 p-3 rounded-lg border border-border/30 hover:bg-muted/20 transition-colors">
                    <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono truncate">{f.filename}</p>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span>{f.change_count} changes</span>
                        <span className="text-red-700">{f.bug_fix_count} bug fixes ({f.bug_fix_ratio}%)</span>
                        <span><Users className="h-3 w-3 inline mr-0.5" />{f.author_count} authors</span>
                        <span>churn: {f.churn}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold">{f.risk_score}</p>
                        <p className="text-[10px] text-muted-foreground">/ 100</p>
                      </div>
                      <RiskBadge level={f.risk_level} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {data && files.length === 0 && (
          <div className="mt-6 text-center py-12 text-muted-foreground text-sm">
            No file-level data found. The repository may have no commits in the last 90 days.
          </div>
        )}
      </motion.div>
    </PageShell>
  );
}
