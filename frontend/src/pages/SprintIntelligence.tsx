import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BarChart3, Search, Loader2, TrendingUp, CheckCircle, AlertTriangle,
  Zap, Activity, GitBranch, Layers, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { api } from "@/lib/api";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ChartTooltipBox } from "@/components/dashboard/DashboardUi";
import { CHART_AXIS, CHART_CURSOR, CHART_GRID } from "@/lib/analytics-charts";

// ─── What this module does ───────────────────────────────────────────────────
// Sprint Intelligence aggregates data from two sources into one sprint health report:
//
//   GitHub (required):
//     • DORA metrics deployment frequency, change failure rate
//     • CI pass rate from GitHub Actions workflow runs (last 14 days)
//
//   Jira (optional):
//     • Sprint stories delivered
//     • Story priority breakdown
//     • Ambiguous story count
//
// The AI generates a sprint summary narrative for engineering managers.
// You can use GitHub only (no Jira needed) to get DORA metrics.

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "text-red-700",
  High: "text-[var(--color-warning)]",
  Medium: "text-amber-700",
  Low: "text-sky-700",
};

function DoraLevel({ rate }: { rate: number }) {
  if (rate <= 5) return <span className="text-positive text-xs">Elite</span>;
  if (rate <= 15) return <span className="text-amber-700 text-xs">High</span>;
  if (rate <= 30) return <span className="text-[var(--color-warning)] text-xs">Medium</span>;
  return <span className="text-red-700 text-xs">Low</span>;
}

export default function SprintIntelligence() {
  const [form, setForm] = useState({ owner: "", repo: "", jira_project: "", sprint_name: "" });

  const reportMutation = useMutation({
    mutationFn: () =>
      api.generateSprintReport({
        owner: form.owner,
        repo: form.repo,
        jira_project: form.jira_project || undefined,
        sprint_name: form.sprint_name || "Current Sprint",
      }),
  });

  // GitHub-only DORA quick view (no Jira needed)
  const doraQuery = useQuery({
    queryKey: ["dora-quick", form.owner, form.repo],
    queryFn: () => api.getDORAMetrics(form.owner, form.repo),
    enabled: false,
  });

  const data = reportMutation.data as any;
  const dora = data?.dora || {};
  const stories = data?.stories || [];

  const hasGitHub = !!form.owner.trim() && !!form.repo.trim();
  const hasJira = !!form.jira_project.trim();

  const doraRadarData = [
    { metric: "Deploys/Week", value: Math.min((dora.deployment_frequency_per_week || 0) * 10, 100) },
    { metric: "Pass Rate", value: data?.test_pass_rate || 0 },
    { metric: "Low CFR", value: Math.max(0, 100 - (dora.change_failure_rate_30d || 0)) },
    { metric: "Delivery", value: Math.min((data?.stories_delivered || 0) * 5, 100) },
    { metric: "Quality", value: 100 - (data?.ambiguous_stories_detected || 0) * 10 },
  ];

  const storiesByPriority = Object.entries(
    stories.reduce((acc: any, s: any) => {
      const p = s.priority || "Medium";
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {})
  ).map(([priority, count]) => ({ priority, count }));

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>

        <PageHeader
          icon={Layers}
          title="Sprint Intelligence"
          description="DORA metrics, CI health, and AI-generated sprint retrospective. Combine GitHub + Jira or use either alone."
        />

        {/* What each source gives you */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="page-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">GitHub <span className="text-red-700 text-xs">required</span></span>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Deployment frequency (deploys/week)</li>
              <li>• Change failure rate (30 days)</li>
              <li>• CI test pass rate (last 14 days)</li>
              <li>• Total CI runs + successful runs</li>
            </ul>
            <p className="text-[10px] text-muted-foreground mt-2">
              Enter: <code className="bg-muted px-1 rounded">owner/repo</code> e.g. <code className="bg-muted px-1 rounded">expressjs/express</code>
            </p>
          </div>
          <div className="page-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Jira <span className="text-muted-foreground text-xs">optional</span></span>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Stories delivered this sprint</li>
              <li>• High priority story count</li>
              <li>• Ambiguous story detection</li>
              <li>• Story breakdown by priority</li>
            </ul>
            <p className="text-[10px] text-muted-foreground mt-2">
              Enter your Jira project key e.g. <code className="bg-muted px-1 rounded">PROJ</code>. Requires Jira credentials in backend .env.
            </p>
          </div>
        </div>

        {/* Input form */}
        <div className="floating-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <span className="font-display font-medium text-sm">Sprint Configuration</span>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* GitHub section */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                GitHub Owner <span className="text-red-700">*</span>
              </label>
              <Input
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                placeholder="e.g. expressjs"
                className="bg-muted/30 border-border/50"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Repository <span className="text-red-700">*</span>
              </label>
              <Input
                value={form.repo}
                onChange={(e) => setForm({ ...form, repo: e.target.value })}
                placeholder="e.g. express"
                className="bg-muted/30 border-border/50"
              />
            </div>
            {/* Jira section */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Jira Project Key <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                value={form.jira_project}
                onChange={(e) => setForm({ ...form, jira_project: e.target.value.toUpperCase() })}
                placeholder="e.g. PROJ  (leave blank for GitHub-only)"
                className="bg-muted/30 border-border/50 uppercase"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Sprint Label <span className="text-muted-foreground">(optional, for display)</span>
              </label>
              <Input
                value={form.sprint_name}
                onChange={(e) => setForm({ ...form, sprint_name: e.target.value })}
                placeholder="e.g. Sprint 24"
                className="bg-muted/30 border-border/50"
              />
            </div>
          </div>

          {/* Active data sources indicator */}
          {(hasGitHub || hasJira) && (
            <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
              <span>Will fetch from:</span>
              {hasGitHub && <Badge variant="outline" className="text-[10px] text-primary border-primary/30">GitHub Actions</Badge>}
              {hasJira && <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Jira Sprint</Badge>}
              {!hasJira && hasGitHub && <span className="text-muted-foreground">(GitHub only DORA + CI metrics)</span>}
            </div>
          )}

          <Button
            onClick={() => reportMutation.mutate()}
            disabled={!hasGitHub || reportMutation.isPending}
            className="bg-primary text-primary-foreground w-full"
          >
            {reportMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating Report…</>
            ) : (
              <><Search className="h-4 w-4 mr-2" />
                {hasJira ? "Generate Full Sprint Report" : "Generate DORA Report"}
              </>
            )}
          </Button>
        </div>

        {reportMutation.isError && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive space-y-1">
            <p className="font-medium">Report generation failed</p>
            <p>Check: (1) GitHub owner/repo are correct and GITHUB_TOKEN is set in backend .env, (2) If you added a Jira project key, check Jira credentials too.</p>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────────────── */}
        {data && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">

            {/* Data source badges */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Report for:</span>
              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                {form.owner}/{form.repo}
              </Badge>
              {form.jira_project && (
                <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                  Jira: {form.jira_project}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{data.sprint_name}</span>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <PageStat icon={CheckCircle} label="Stories Delivered" value={data.stories_delivered ?? "—"} accent="success" />
              <PageStat icon={AlertTriangle} label="Ambiguous Stories" value={data.ambiguous_stories_detected ?? "—"} accent="warning" />
              <PageStat icon={Activity} label="CI Pass Rate" value={data.test_pass_rate != null ? `${data.test_pass_rate}%` : "—"} accent="primary" />
              <PageStat icon={Zap} label="Deploys/Week" value={dora.deployment_frequency_per_week ?? "—"} accent="primary" />
            </div>

            {/* Charts row */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* DORA Radar */}
              <div className="floating-card p-6">
                <p className="text-[13px] font-semibold tracking-tight mb-1">DORA Health Radar</p>
                <p className="text-xs text-muted-foreground mb-4">Higher = better on all axes</p>
                <ResponsiveContainer width="100%" height={220}>
                  <RadarChart data={doraRadarData} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="hsl(var(--border)/30)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
                    <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/20)" strokeWidth={2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Stories by priority or DORA detail */}
              {storiesByPriority.length > 0 ? (
                <div className="floating-card p-6">
                  <p className="text-[13px] font-semibold tracking-tight mb-4">Stories by Priority</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={storiesByPriority} layout="vertical">
                      <CartesianGrid {...CHART_GRID} horizontal={false} />
                      <XAxis type="number" tick={CHART_AXIS.tick} />
                      <YAxis dataKey="priority" type="category" tick={CHART_AXIS.tick} width={60} />
                      <Tooltip
                        cursor={CHART_CURSOR}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0];
                          return (
                            <ChartTooltipBox
                              rows={[{ name: String(p.payload?.priority ?? "Count"), value: typeof p.value === "number" || typeof p.value === "string" ? p.value : Number(p.value) || 0, color: "hsl(var(--primary))" }]}
                            />
                          );
                        }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="floating-card p-6">
                  <p className="text-[13px] font-semibold tracking-tight mb-4">CI Run Breakdown (14 days)</p>
                  <div className="space-y-3 mt-4">
                    {[
                      { label: "Total runs", value: dora.total_ci_runs_14d || 0, color: "text-primary" },
                      { label: "Successful", value: dora.successful_runs_14d || 0, color: "text-positive" },
                      { label: "Failed", value: (dora.total_ci_runs_14d || 0) - (dora.successful_runs_14d || 0), color: "text-red-700" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex items-center justify-between p-3 rounded-lg border border-border/30">
                        <span className="text-sm text-muted-foreground">{label}</span>
                        <span className={`text-xl font-display font-bold ${color}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* DORA metrics detail */}
            <div className="floating-card p-6">
              <p className="text-[13px] font-semibold tracking-tight mb-4">DORA Metrics</p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg border border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">Deployment Frequency</p>
                  <p className="text-xl font-display font-bold text-primary">{dora.deployment_frequency_per_week || 0}</p>
                  <p className="text-xs text-muted-foreground">successful deploys / week</p>
                </div>
                <div className="p-3 rounded-lg border border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">Change Failure Rate (30d)</p>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-xl font-display font-bold ${(dora.change_failure_rate_30d || 0) > 15 ? "text-red-700" : "text-positive"}`}>
                      {dora.change_failure_rate_30d || 0}%
                    </p>
                    <DoraLevel rate={dora.change_failure_rate_30d || 0} />
                  </div>
                  <p className="text-xs text-muted-foreground">of deploys caused failures</p>
                </div>
                <div className="p-3 rounded-lg border border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">CI Runs (14 days)</p>
                  <p className="text-xl font-display font-bold text-primary">{dora.total_ci_runs_14d || 0}</p>
                  <p className="text-xs text-muted-foreground">{dora.successful_runs_14d || 0} successful</p>
                </div>
                <div className="p-3 rounded-lg border border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">Test Pass Rate</p>
                  <p className={`text-xl font-display font-bold ${(data.test_pass_rate || 0) >= 80 ? "text-positive" : "text-[var(--color-warning)]"}`}>
                    {data.test_pass_rate || 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">{(data.test_pass_rate || 0) >= 80 ? "Above 80% target" : "Below 80% target"}</p>
                </div>
              </div>
            </div>

            {/* AI Summary */}
            {data.ai_summary && (
              <div className="floating-card p-6">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <span className="text-[13px] font-semibold tracking-tight">AI Sprint Summary</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{data.ai_summary}</p>
              </div>
            )}

            {/* Jira stories */}
            {stories.length > 0 && (
              <div className="floating-card p-6">
                <p className="text-[13px] font-semibold tracking-tight mb-4">Sprint Stories ({stories.length})</p>
                <div className="space-y-2">
                  {stories.map((s: any) => (
                    <div key={s.key} className="flex items-center gap-3 p-3 rounded-lg border border-border/30">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground shrink-0">{s.key}</span>
                          <span className="text-sm truncate">{s.summary}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.status} · {s.assignee}</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${PRIORITY_COLORS[s.priority] || ""}`}>
                        {s.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {data.errors?.length > 0 && (
              <div className="p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                <p className="text-xs font-medium text-amber-700 mb-2">Partial data some sources unavailable:</p>
                {data.errors.map((e: string, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground">• {e}</p>
                ))}
              </div>
            )}

          </motion.div>
        )}

      </motion.div>
    </PageShell>
  );
}
