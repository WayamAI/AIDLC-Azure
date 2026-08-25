import { motion } from "framer-motion";
import type { TooltipProps } from "recharts";
import {
  TestTubes,
  CheckCircle2,
  XCircle,
  TrendingUp,
  AlertTriangle,
  Clock,
  Zap,
  BarChart3,
  Activity,
  Target,
  Layers,
  FileText,
  Play,
  ArrowUpDown,
  ArrowRight,
  LayoutDashboard,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardStats } from "@/hooks/use-dashboard";
import { BRAND_COLORS, CHART_PALETTE_HSL } from "@/lib/brand";
import { DS_CHART } from "@/lib/design-system";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ChartTooltipBox, DashboardKpi, DashboardPanel } from "@/components/dashboard/DashboardUi";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  functional: CHART_PALETTE_HSL[0],
  edge: CHART_PALETTE_HSL[1],
  api: CHART_PALETTE_HSL[2],
  failure: "hsl(0, 72%, 55%)",
  regression: CHART_PALETTE_HSL[4],
};

const SEVERITY_GRADIENT: Record<string, string> = {
  Critical: "linear-gradient(90deg, #DC2626, #DC2626)",
  High: "linear-gradient(90deg, #B45309, #B45309)",
  Medium: "linear-gradient(90deg, #AFAFAF, #AFAFAF)",
  Low: "linear-gradient(90deg, #6B7280, #6B7280)",
};

function WeeklyTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltipBox
      label={label}
      rows={payload.map((p) => ({
        name: p.name === "passed" ? "Passed" : "Failed",
        value: p.value ?? 0,
        color: p.name === "passed" ? DS_CHART.pass : DS_CHART.fail,
      }))}
    />
  );
}

function CategoryTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <ChartTooltipBox
      rows={[{ name: String(p.name), value: p.value ?? 0, color: String(p.payload?.fill ?? BRAND_COLORS.from) }]}
    />
  );
}

const EMPTY_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({
  day,
  passed: 0,
  failed: 0,
}));

const Dashboard = () => {
  const navigate = useNavigate();
  const { data: stats, isError, isLoading } = useDashboardStats();

  const totalTests = stats?.total_tests ?? 0;
  const passed = stats?.latest_run?.passed ?? 0;
  const failed = stats?.latest_run?.failed ?? 0;
  const successRate = stats?.latest_run?.success_rate ?? 0;
  const avgDuration = (stats?.latest_run?.avg_duration ?? 0).toFixed(1);
  const knownFailures = stats?.known_failures ?? 0;
  const highPriority = stats?.high_priority ?? 0;
  const syntheticCount = Object.values(stats?.test_case_counts ?? {}).reduce((a, b) => a + b, 0);

  const kpis = [
    { label: "Total Test Cases", value: totalTests, icon: TestTubes, accent: "primary" as const },
    { label: "Pass Rate", value: `${successRate}%`, icon: TrendingUp, accent: "success" as const },
    { label: "Failed Executions", value: failed, icon: XCircle, accent: "destructive" as const },
    { label: "Avg. Execution Time", value: `${avgDuration}s`, icon: Clock, accent: "warning" as const },
    { label: "Known Failures", value: knownFailures, icon: AlertTriangle, accent: "destructive" as const },
    { label: "High Priority Items", value: highPriority, icon: Target, accent: "warning" as const },
  ];

  const weeklyTrend = stats?.weekly_trend?.length ? stats.weekly_trend : EMPTY_WEEK;

  const counts = stats?.test_case_counts ?? {};
  const categoryData = Object.entries(counts).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    fill: CATEGORY_COLORS[name] ?? CHART_PALETTE_HSL[3],
  }));
  const categoryTotal = categoryData.reduce((s, c) => s + c.value, 0);

  const coverageData = categoryData.map((c) => ({
    name: c.name,
    value: categoryTotal ? Math.round((c.value / categoryTotal) * 100) : 0,
    fill: c.fill,
  }));

  const severityBreakdown = stats?.severity_breakdown?.length
    ? stats.severity_breakdown
    : [
        { severity: "Critical", count: 0 },
        { severity: "High", count: 0 },
        { severity: "Medium", count: 0 },
        { severity: "Low", count: 0 },
      ];
  const totalSeverity = severityBreakdown.reduce((s, b) => s + b.count, 0);

  const recentActivity = stats?.recent_activity ?? [];

  const platformMetrics = [
    { icon: Zap, label: "Test Cases Generated", value: totalTests },
    { icon: Activity, label: "Active Monitored Assets", value: stats?.active_vehicles ?? 0 },
    { icon: BarChart3, label: "Synthetic Data Records", value: syntheticCount },
    { icon: Target, label: "High-Priority Alerts", value: highPriority },
  ];

  if (isLoading) {
    return (
      <PageShell size="full" className="flex min-h-[50vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading dashboard…</p>
      </PageShell>
    );
  }

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="space-y-6"
      >
        <PageHeader
          icon={LayoutDashboard}
          title="Intelligence Dashboard"
          description={
            isError
              ? "Could not load dashboard stats. Start the backend and refresh."
              : totalTests === 0
                ? "No test data yet. Start with a requirement to generate a suite."
                : "Live overview of generated tests, executions, and risk signals"
          }
        />

        {/* Guided workflow */}
        <DashboardPanel
          title="Guided Workflow"
          subtitle="Four steps to full test coverage"
          icon={Zap}
          badge={
            <Badge className="border-primary/20 bg-primary/10 text-primary hover:bg-primary/10">
              Begin here
            </Badge>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { step: 1, icon: FileText, title: "Submit Requirement", desc: "Describe your feature in plain language.", url: "/requirements", cta: "Step 1" },
              { step: 2, icon: TestTubes, title: "Review Test Suite", desc: "Inspect AI-generated cases by category.", url: "/generated-tests", cta: "Step 2" },
              { step: 3, icon: Play, title: "Execute Tests", desc: "Run the full suite in one action.", url: "/test-execution", cta: "Step 3" },
              { step: 4, icon: ArrowUpDown, title: "Risk Ranking", desc: "Prioritize by failure history and impact.", url: "/prioritization", cta: "Step 4" },
            ].map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.06 }}
                className="dash-workflow-step"
                onClick={() => navigate(s.url)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/15">
                    <s.icon className="h-4 w-4" />
                  </div>
                  <span className="font-mono text-[10px] font-bold text-primary/70">0{s.step}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                </div>
                <span className="mt-auto flex items-center gap-1 text-[11px] font-medium text-primary">
                  {s.cta} <ArrowRight className="h-3 w-3" />
                </span>
              </motion.div>
            ))}
          </div>
        </DashboardPanel>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + i * 0.05 }}
            >
              <DashboardKpi {...kpi} />
            </motion.div>
          ))}
        </div>

        {/* Charts row 1 */}
        <div className="grid gap-4 lg:grid-cols-5">
          <DashboardPanel
            className="lg:col-span-3"
            title="Weekly Execution Trend"
            subtitle="Passed vs failed runs over the last 7 days"
            icon={BarChart3}
            badge={<span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[10px] font-medium text-muted-foreground">7D</span>}
          >
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyTrend} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="passedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DS_CHART.pass} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={DS_CHART.pass} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DS_CHART.fail} stopOpacity={0.32} />
                      <stop offset="100%" stopColor={DS_CHART.fail} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-stroke-muted, rgba(128,128,128,0.2))" vertical={false} strokeDasharray="3 6" />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--color-tertiary)", fontSize: 12, fontWeight: 500 }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--color-tertiary)", fontSize: 11 }}
                    width={36}
                    allowDecimals={false}
                  />
                  <Tooltip content={<WeeklyTooltip />} cursor={{ stroke: DS_CHART.info, strokeWidth: 1, strokeDasharray: "4 4" }} />
                  <Area
                    type="monotone"
                    dataKey="passed"
                    name="passed"
                    stroke={DS_CHART.pass}
                    strokeWidth={2.75}
                    fill="url(#passedGrad)"
                    dot={{ r: 3, fill: DS_CHART.pass, strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: DS_CHART.pass, stroke: "var(--color-raised)", strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="failed"
                    stroke={DS_CHART.fail}
                    strokeWidth={2.75}
                    fill="url(#failedGrad)"
                    dot={{ r: 3, fill: DS_CHART.fail, strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: DS_CHART.fail, stroke: "var(--color-raised)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex gap-6 border-t border-border pt-4 text-xs">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <span className="dash-legend-dot" style={{ background: DS_CHART.pass }} /> Passed
              </span>
              <span className="flex items-center gap-2 font-medium text-foreground">
                <span className="dash-legend-dot" style={{ background: DS_CHART.fail }} /> Failed
              </span>
            </div>
          </DashboardPanel>

          <DashboardPanel
            className="lg:col-span-2"
            title="Category Mix"
            subtitle="Distribution across test types"
            icon={Layers}
          >
            <div className="relative h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={82}
                    paddingAngle={4}
                    cornerRadius={6}
                    dataKey="value"
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth={3}
                  >
                    {categoryData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<CategoryTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="dash-donut-center">
                <span className="text-2xl font-semibold tabular-nums text-foreground">{categoryTotal}</span>
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Total</span>
              </div>
            </div>
            <div className="mt-2 space-y-2">
              {categoryData.map((c) => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="dash-legend-dot" style={{ background: c.fill }} />
                  <span className="flex-1 text-muted-foreground">{c.name}</span>
                  <span className="font-mono font-semibold tabular-nums">{c.value}</span>
                  <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">
                    {categoryTotal ? Math.round((c.value / categoryTotal) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </DashboardPanel>
        </div>

        {/* Charts row 2 */}
        <div className="grid gap-4 lg:grid-cols-3">
          <DashboardPanel title="Severity Distribution" subtitle="Defects by impact level" icon={AlertTriangle} iconClassName="text-amber-600">
            <div className="space-y-4">
              {severityBreakdown.map((s, i) => (
                <div key={s.severity}>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{s.severity}</span>
                    <span className="font-mono font-semibold tabular-nums">{s.count}</span>
                  </div>
                  <div className="dash-severity-track">
                    <motion.div
                      className="dash-severity-fill"
                      style={{ background: SEVERITY_GRADIENT[s.severity] }}
                      initial={{ width: 0 }}
                      animate={{ width: `${totalSeverity ? (s.count / totalSeverity) * 100 : 0}%` }}
                      transition={{ duration: 0.9, delay: 0.15 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-black/[0.03] px-4 py-3 text-xs">
              <span className="text-muted-foreground">Total flagged</span>
              <span className="font-semibold tabular-nums">{totalSeverity} tests</span>
            </div>
          </DashboardPanel>

          <DashboardPanel title="Coverage Depth" subtitle="Suite coverage by category" icon={Target}>
            <div className="space-y-4">
              {coverageData.map((c, i) => (
                <div key={c.name}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{c.name}</span>
                    <span className="font-mono font-semibold tabular-nums">{c.value}%</span>
                  </div>
                  <div className="dash-severity-track h-3">
                    <motion.div
                      className="dash-severity-fill h-3 rounded-full"
                      style={{ background: `linear-gradient(90deg, ${c.fill}, ${BRAND_COLORS.to})` }}
                      initial={{ width: 0 }}
                      animate={{ width: `${c.value}%` }}
                      transition={{ duration: 0.85, delay: 0.2 + i * 0.07 }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {coverageData.map((c) => (
                <div key={c.name} className="rounded-xl border border-border bg-raised px-3 py-2 text-center">
                  <p className="font-mono text-lg font-semibold tabular-nums" style={{ color: c.fill.replace("hsl", "hsl") }}>
                    {c.value}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">{c.name}</p>
                </div>
              ))}
            </div>
          </DashboardPanel>

          <DashboardPanel title="Live Activity" subtitle="Latest test executions" icon={Zap}>
            {recentActivity.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No executions yet. Run a suite from Test Execution to see activity here.
              </p>
            )}
            <ol className="activity-timeline">
              {recentActivity.map((t, i) => (
                <motion.li
                  key={t.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.06 }}
                  className="activity-timeline-item cursor-pointer"
                  onClick={() => navigate("/test-execution")}
                >
                  <span
                    className={cn(
                      "activity-timeline-node",
                      t.status === "PASS" ? "activity-timeline-node--pass" : "activity-timeline-node--fail",
                    )}
                    aria-hidden
                  >
                    {t.status === "PASS" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 py-0.5">
                    <p className="truncate text-xs font-semibold text-[var(--color-primary)]">{t.name}</p>
                    <p className="text-[10px] text-[var(--color-tertiary)]">
                      {t.id}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--color-action)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-tertiary)]">
                    {t.time_ago}
                  </span>
                </motion.li>
              ))}
            </ol>
          </DashboardPanel>
        </div>

        {/* Platform metrics */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {platformMetrics.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.07 }}
              className="dash-metric-hero"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-transparent text-primary ring-1 ring-primary/10">
                <m.icon className="h-5 w-5" />
              </div>
              <span className="dash-metric-hero-value">{m.value}</span>
              <span className="mt-1 block text-xs font-medium text-muted-foreground">{m.label}</span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </PageShell>
  );
};

export default Dashboard;
