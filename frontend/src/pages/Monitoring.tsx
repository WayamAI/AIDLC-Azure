import { useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Play, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { ChartTooltipBox } from "@/components/dashboard/DashboardUi";
import { Panel } from "@/components/imcc/Panel";
import { StatusBadge } from "@/components/imcc/StatusBadge";
import { cn, plainFromChatMarkup } from "@/lib/utils";

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

interface BreachProjection {
  dimension: string;
  threshold: number;
  window_points: number;
  current_value: number;
  slope_per_day: number;
  predicted_breach_in_hours: number;
  already_breached: boolean;
}

// Result of the last /monitoring/analyze call for the series on screen.
interface AnalysisResult {
  projection: BreachProjection | null;
  breachThreshold: number;
  alertError: string | null;
}

function errorDetail(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : "The analysis request failed.";
}

function formatHours(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}


// Analyses a daily series of four data-quality percentages:
//   completeness  % of fields that have values (no nulls/blanks)
//   uniqueness    % of records that are not duplicates
//   validity      % of values that match expected format/range rules
//   consistency   % of values that are logically consistent across fields
//
// Demo series: synthetic 30-day data with injected anomalies.
// Pasted data: daily scores supplied as CSV. Nothing here reads production telemetry.

// Series are told apart by ink weight and dash pattern; colour is reserved for status.
const DIM_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  overall: { stroke: "hsl(var(--ink))", width: 2 },
  completeness: { stroke: "hsl(var(--ink-secondary))", width: 1.5 },
  uniqueness: { stroke: "hsl(var(--ink-secondary))", dash: "6 3", width: 1.5 },
  validity: { stroke: "hsl(var(--ink-tertiary))", dash: "2 3", width: 1.5 },
  consistency: { stroke: "hsl(var(--ink-tertiary))", dash: "8 3 2 3", width: 1.5 },
};

const DIM_DESCRIPTIONS: Record<string, string> = {
  completeness: "% of non-null values",
  uniqueness: "% of non-duplicate records",
  validity: "% of values passing format/range rules",
  consistency: "% of logically consistent cross-field values",
};

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";
const pill = "rounded-full border px-3 py-1 text-xs font-medium transition-colors";
const pillOn = "border-transparent bg-primary text-primary-foreground";
const pillOff = "border-border text-ink-secondary hover:bg-raised";

function SeriesSwatch({ dim }: { dim: string }) {
  const style = DIM_STYLE[dim];
  return (
    <svg width="20" height="6" aria-hidden className="shrink-0">
      <line x1="0" y1="3" x2="20" y2="3" stroke={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} />
    </svg>
  );
}

function AnomalyRow({ anomaly, onInvestigate, isCreating }: {
  anomaly: any;
  onInvestigate: (a: any) => void;
  isCreating: boolean;
}) {
  const isCritical = anomaly.severity === "critical";
  return (
    <li className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0">
      <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-tertiary">{anomaly.date}</span>
      <span className="w-28 shrink-0 truncate text-sm capitalize text-ink">{anomaly.dimension}</span>
      <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-ink-secondary">
        {anomaly.value}% · {anomaly.drop > 0 ? `−${anomaly.drop}pp` : "spike"} · z = {anomaly.z_score}
      </span>
      <StatusBadge tone={isCritical ? "critical" : "warning"} className="capitalize">
        {anomaly.severity}
      </StatusBadge>
      <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={() => onInvestigate(anomaly)} disabled={isCreating}>
        {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create incident"}
      </Button>
    </li>
  );
}

function MonitoringResults({
  series,
  anomalies,
  anomaliesKnown,
  predictiveAlert,
  analysis,
  analysisError,
  onRunAI,
  isRunningAI,
  onInvestigate,
  isCreatingIncident,
  incidentCreated,
}: {
  series: any[];
  anomalies: any[];
  // False until anomaly detection has returned for this series.
  anomaliesKnown: boolean;
  predictiveAlert: any;
  analysis: AnalysisResult | null;
  analysisError: string | null;
  onRunAI: () => void;
  isRunningAI: boolean;
  onInvestigate: (a: any) => void;
  isCreatingIncident: boolean;
  incidentCreated: any;
}) {
  const criticalCount = anomalies.filter((a) => a.severity === "critical").length;
  return (
    <>
      <PageCard
        title={`Quality scores · ${series.length} days`}
        actions={
          <Button variant="outline" size="sm" className="gap-2" onClick={onRunAI} disabled={isRunningAI}>
            {isRunningAI ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {isRunningAI ? "Analysing" : "Run analysis"}
          </Button>
        }
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series}>
            <CartesianGrid stroke="var(--color-stroke-muted)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              stroke="var(--color-stroke-muted)"
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(series.length / 8)}
            />
            <YAxis domain={[50, 100]} ticks={[50, 60, 70, 80, 90, 100]} tick={AXIS_TICK} stroke="var(--color-stroke-muted)" />
            <Tooltip
              cursor={{ stroke: "var(--color-stroke)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltipBox
                    label={label}
                    rows={payload.map((p) => ({
                      name: String(p.name),
                      value: `${p.value}%`,
                      color: DIM_STYLE[p.dataKey as string]?.stroke ?? "hsl(var(--ink-tertiary))",
                    }))}
                  />
                );
              }}
            />
            {Object.entries(DIM_STYLE).map(([dim, style]) => (
              <Line
                key={dim}
                type="monotone"
                dataKey={dim}
                stroke={style.stroke}
                strokeDasharray={style.dash}
                strokeWidth={style.width}
                dot={false}
                name={dim}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {Object.keys(DIM_STYLE).map((dim) => (
            <li key={dim} className="flex items-center gap-2 text-xs text-ink-secondary" title={DIM_DESCRIPTIONS[dim]}>
              <SeriesSwatch dim={dim} />
              <span className="capitalize">{dim}</span>
            </li>
          ))}
        </ul>
        {anomalies.length > 0 && (
          <p className="mt-3 text-xs tabular-nums text-ink-tertiary">
            {anomalies.length} anomalies detected · {criticalCount} critical
          </p>
        )}
      </PageCard>

      {isRunningAI && (
        <Panel>
          <div className="flex items-center gap-3">
            <StatusBadge tone="pending">Pending</StatusBadge>
            <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
            <p className="text-sm text-ink-secondary">
              {anomaliesKnown ? "Running the analysis." : "Checking this series for anomalies. No result yet."}
            </p>
          </div>
        </Panel>
      )}

      {!isRunningAI && analysisError && (
        <Panel>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone="critical">Analysis failed</StatusBadge>
            <p className="min-w-0 flex-1 text-sm text-destructive">{analysisError}</p>
            <Button variant="outline" size="sm" onClick={onRunAI}>Try again</Button>
          </div>
          {!anomaliesKnown && (
            <p className="mt-2 text-xs text-ink-tertiary">
              This series has not been checked, so nothing is known about its anomalies.
            </p>
          )}
        </Panel>
      )}

      {/* Breach projection (computed, not AI) */}
      {!isRunningAI && analysis && (
        <Panel>
          <h2 className={eyebrow}>Breach projection · linear trend, not a forecast model</h2>
          {analysis.projection ? (
            <>
              <p className="mt-1.5 text-sm text-ink">
                {analysis.projection.already_breached ? (
                  <>
                    <span className="capitalize">{analysis.projection.dimension}</span> is already at{" "}
                    {analysis.projection.current_value}%, at or below the {analysis.projection.threshold}% threshold.
                  </>
                ) : (
                  <>
                    <span className="capitalize">{analysis.projection.dimension}</span> reaches the{" "}
                    {analysis.projection.threshold}% threshold in about{" "}
                    <strong>{formatHours(analysis.projection.predicted_breach_in_hours)}</strong> if its recent trend continues.
                  </>
                )}
              </p>
              <p className="mt-1.5 text-xs text-ink-tertiary">
                Straight-line fit to the last {analysis.projection.window_points} points: currently{" "}
                {analysis.projection.current_value}%, changing by {analysis.projection.slope_per_day} points per day.
                It extends that line and does not account for seasonality or one-off events.
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-ink-secondary">
              No breach projected. No dimension's recent linear trend reaches the {analysis.breachThreshold}% threshold within 30 days.
            </p>
          )}
        </Panel>
      )}

      {/* Alert text (AI-written from the computed anomalies) */}
      {predictiveAlert && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={eyebrow}>Anomaly alert</h2>
            {predictiveAlert.at_risk_dimension && (
              <StatusBadge
                tone={predictiveAlert.severity === "critical" ? "critical" : predictiveAlert.severity === "warning" ? "warning" : "info"}
                className="capitalize"
              >
                {predictiveAlert.at_risk_dimension} at risk
              </StatusBadge>
            )}
          </div>
          {predictiveAlert.alert_message ? (
            <>
              <p className="mt-2 text-xs text-ink-tertiary">AI-written summary of the anomalies below</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{plainFromChatMarkup(predictiveAlert.alert_message)}</p>
              {predictiveAlert.recommended_action && (
                <p className="mt-2 text-xs text-ink-secondary">
                  <span className="font-medium text-ink">Suggested action:</span> {plainFromChatMarkup(predictiveAlert.recommended_action)}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-secondary">
              The alert text could not be written{analysis?.alertError ? `: ${analysis.alertError}` : "."} The anomalies and projection are computed and unaffected.
            </p>
          )}
        </Panel>
      )}

      {anomalies.length > 0 && (
        <PageCard
          title={`Detected anomalies (${anomalies.length})`}
          description="Create incident records the anomaly on the Incidents page and asks the model for a root-cause hypothesis."
          padding={false}
        >
          <ul>
            {anomalies.map((a, i) => (
              <AnomalyRow key={i} anomaly={a} onInvestigate={onInvestigate} isCreating={isCreatingIncident} />
            ))}
          </ul>
        </PageCard>
      )}

      {anomaliesKnown && !isRunningAI && anomalies.length === 0 && (
        <Panel>
          <EmptyState kind="noResults" mark="mark-kpi-passed" compact>
            No anomalies detected. All four dimensions are within their normal range.
          </EmptyState>
        </Panel>
      )}

      {incidentCreated && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success">Incident created</StatusBadge>
            <span className="font-mono text-xs text-ink-secondary">{incidentCreated.id}</span>
            <Link to="/incidents" className="ml-auto text-xs text-ink underline underline-offset-2">
              Open Incidents
            </Link>
          </div>
          {incidentCreated.root_cause && (
            <p className="mt-2 text-xs text-ink-secondary">
              <span className="text-ink-quaternary">AI hypothesis (unverified): </span>
              {incidentCreated.root_cause}
            </p>
          )}
        </Panel>
      )}
    </>
  );
}

type Tab = "demo" | "real";

const CSV_PLACEHOLDER = `date,completeness,uniqueness,validity,consistency
2026-03-01,92,97,89,85
2026-03-02,91,96,90,86
2026-03-03,93,97,88,84
2026-03-04,90,95,91,87
2026-03-05,88,94,89,83
2026-03-06,71,93,88,82
2026-03-07,65,92,87,80`;

function parseCSV(raw: string): { series: any[]; error: string | null } {
  const lines = raw.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { series: [], error: "Need at least a header row + 1 data row." };

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const required = ["date", "completeness", "uniqueness", "validity", "consistency"];
  const missing = required.filter((r) => !headers.includes(r));
  if (missing.length > 0) return { series: [], error: `Missing columns: ${missing.join(", ")}` };

  const rows: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(",").map((v) => v.trim());
    const row: any = {};
    headers.forEach((h, j) => { row[h] = vals[j]; });
    const comp = parseFloat(row.completeness);
    const uniq = parseFloat(row.uniqueness);
    const valid = parseFloat(row.validity);
    const cons = parseFloat(row.consistency);
    if ([comp, uniq, valid, cons].some(isNaN)) continue;
    rows.push({
      date: row.date,
      completeness: comp,
      uniqueness: uniq,
      validity: valid,
      consistency: cons,
      overall: parseFloat(((comp + uniq + valid + cons) / 4).toFixed(2)),
    });
  }
  if (rows.length === 0) return { series: [], error: "No valid data rows found. Check your number formatting." };
  return { series: rows, error: null };
}

export default function Monitoring() {
  const [tab, setTab] = useState<Tab>("demo");

  // Demo mode
  const [baseline, setBaseline] = useState({ completeness: 88, uniqueness: 94, validity: 91, consistency: 87 });

  // Real data mode
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);

  // Shared result state
  const [series, setSeries] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [predictiveAlert, setPredictiveAlert] = useState<any>(null);
  const [incidentCreated, setIncidentCreated] = useState<any>(null);
  // Which tab produced the series on screen; results are only shown on that tab.
  const [seriesSource, setSeriesSource] = useState<Tab | null>(null);
  const [anomaliesKnown, setAnomaliesKnown] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);

  // The series the newest analysis request was made for; older responses are ignored.
  const latestTarget = useRef<any[] | null>(null);
  const seriesSourceRef = useRef<Tab | null>(null);

  const analyzeMutation = useMutation({
    // The demo flag is read when the request is made: it describes the series being sent.
    mutationFn: (target: any[]) => api.analyzeTimeSeries(target, seriesSourceRef.current === "demo"),
    onSuccess: (data: any, target) => {
      if (target !== latestTarget.current) return;
      setAnomalies(data.anomalies || []);
      setAnomaliesKnown(true);
      setPredictiveAlert(data.predictive_alert || null);
      setAnalysis({
        projection: data.projection ?? null,
        breachThreshold: data.breach_threshold ?? 80,
        alertError: data.alert_error ?? null,
      });
    },
  });

  const runAnalysis = (target: any[], source: Tab) => {
    latestTarget.current = target;
    seriesSourceRef.current = source;
    analyzeMutation.mutate(target);
  };

  const simulateMutation = useMutation({
    mutationFn: () => api.simulateTimeSeries(baseline, 30),
    onSuccess: (data: any) => {
      latestTarget.current = null;
      analyzeMutation.reset();
      setSeries(data.series || []);
      setSeriesSource("demo");
      setAnomalies(data.anomalies || []);
      setAnomaliesKnown(true);
      setPredictiveAlert(null);
      setAnalysis(null);
      setIncidentCreated(null);
    },
  });

  const createIncidentMutation = useMutation({
    mutationFn: (anomaly: any) => {
      // `source` marks incidents raised from the synthetic demo series.
      const payload = {
        anomaly,
        title: `Quality Anomaly ${anomaly.dimension} drop detected`,
        source: seriesSource === "demo" ? "demo" : "manual",
      };
      return api.createIncident(payload);
    },
    onSuccess: (data: any) => setIncidentCreated(data),
  });

  const handleRealDataRun = () => {
    const { series: parsed, error } = parseCSV(csvText);
    if (error) { setCsvError(error); return; }
    setCsvError(null);
    setSeries(parsed);
    setSeriesSource("real");
    setAnomalies([]);
    setAnomaliesKnown(false);
    setPredictiveAlert(null);
    setAnalysis(null);
    setIncidentCreated(null);
    // Auto-run anomaly detection on the parsed data
    runAnalysis(parsed, "real");
  };

  const hasResults = series.length > 0 && seriesSource === tab;
  const analysisError = analyzeMutation.isError ? errorDetail(analyzeMutation.error) : null;

  const results = hasResults && (
    <MonitoringResults
      series={series}
      anomalies={anomalies}
      anomaliesKnown={anomaliesKnown}
      predictiveAlert={predictiveAlert}
      analysis={analysis}
      analysisError={analysisError}
      onRunAI={() => runAnalysis(series, seriesSource ?? "real")}
      isRunningAI={analyzeMutation.isPending}
      onInvestigate={(a) => createIncidentMutation.mutate(a)}
      isCreatingIncident={createIncidentMutation.isPending}
      incidentCreated={incidentCreated}
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Metric Anomalies"
        description="Analyses a built-in demo series or daily quality scores you paste. It is not connected to production telemetry."
        actions={
          <>
            <button type="button" onClick={() => setTab("demo")} aria-pressed={tab === "demo"} className={cn(pill, tab === "demo" ? pillOn : pillOff)}>
              Demo series
            </button>
            <button type="button" onClick={() => setTab("real")} aria-pressed={tab === "real"} className={cn(pill, tab === "real" ? pillOn : pillOff)}>
              Pasted data
            </button>
          </>
        }
      />

      {tab === "demo" && (
        <>
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={eyebrow}>Demo series</h2>
              <StatusBadge tone="neutral">Synthetic data</StatusBadge>
            </div>
            <p className="mt-1.5 max-w-[80ch] text-xs text-ink-tertiary">
              Generates 30 days of synthetic scores around the baselines below. Anomalies are injected on days 22–26 so
              there is something to detect.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              {Object.entries(baseline).map(([key, val]) => (
                <div key={key}>
                  <label htmlFor={`baseline-${key}`} className={cn(fieldLabel, "flex items-center justify-between")}>
                    <span className="capitalize">{key} baseline</span>
                    <span className="tabular-nums text-ink">{val}%</span>
                  </label>
                  <input
                    id={`baseline-${key}`}
                    type="range" min={50} max={100} value={val}
                    onChange={(e) => setBaseline((b) => ({ ...b, [key]: +e.target.value }))}
                    className="w-full accent-current"
                  />
                  <p className="mt-0.5 text-xs text-ink-quaternary">{DIM_DESCRIPTIONS[key]}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={() => simulateMutation.mutate()} disabled={simulateMutation.isPending} className="gap-2">
                {simulateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {simulateMutation.isPending ? "Generating" : "Generate demo series"}
              </Button>
            </div>
            {simulateMutation.isError && (
              <p className="mt-3 text-sm text-destructive">The demo series could not be generated.</p>
            )}
          </Panel>

          {results}
        </>
      )}

      {tab === "real" && (
        <>
          <Panel>
            <label htmlFor="monitoring-csv" className={fieldLabel}>
              Daily quality scores (CSV)
            </label>
            <p className="mb-2 max-w-[80ch] text-xs text-ink-tertiary">
              One row per day with columns <span className="font-mono">date, completeness, uniqueness, validity, consistency</span>.
              Values are percentages (0–100), for example the daily pass rate of your own data-quality checks.
            </p>
            <Textarea
              id="monitoring-csv"
              value={csvText}
              onChange={(e) => { setCsvText(e.target.value); setCsvError(null); }}
              placeholder={CSV_PLACEHOLDER}
              rows={10}
              className="resize-none font-mono text-xs"
            />

            {csvError && <p className="mt-2 text-sm text-destructive">{csvError}</p>}

            <div className="mt-4 flex justify-end">
              <Button onClick={handleRealDataRun} disabled={!csvText.trim()} className="gap-2">
                <Search className="h-4 w-4" />
                Detect anomalies
              </Button>
            </div>
          </Panel>

          {results}

          {!hasResults && (
            <Panel>
              <EmptyState kind="noResults" mark="mark-anomaly-sandbox">
                Paste CSV data above and run detection. Points with a z-score above 2.5 or a single-day drop of more
                than 10 points are flagged.
              </EmptyState>
            </Panel>
          )}
        </>
      )}
    </PageShell>
  );
}
