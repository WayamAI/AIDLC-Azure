import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import {
  Activity, Upload, AlertTriangle, Zap, CheckCircle, Loader2, Search,
  Info, FlaskConical, TableProperties, Radar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ChartTooltipBox } from "@/components/dashboard/DashboardUi";
import { CHART_AXIS, CHART_CURSOR, CHART_GRID } from "@/lib/analytics-charts";

// ─── What this module does ───────────────────────────────────────────────────
// Tracks data quality scores over time for a dataset and alerts you when
// something drops unexpectedly.
//
// Four quality dimensions:
//   completeness  % of fields that have values (no nulls/blanks)
//   uniqueness    % of records that are not duplicates
//   validity      % of values that match expected format/range rules
//   consistency   % of values that are logically consistent across fields
//
// DEMO mode: generates synthetic 30-day data (with injected anomalies for demo)
// REAL DATA mode: you paste in your actual daily quality scores as CSV

const DIM_COLORS: Record<string, string> = {
  completeness: "#B45309",
  uniqueness: "#AFAFAF",
  validity: "#6B7280",
  consistency: "#9CA3AF",
  overall: "#DC2626",
};

const DIM_DESCRIPTIONS: Record<string, string> = {
  completeness: "% of non-null values measures missing data",
  uniqueness: "% of non-duplicate records measures data duplication",
  validity: "% of values passing format/range rules measures data correctness",
  consistency: "% of logically consistent cross-field values measures data coherence",
};

// ─── Anomaly Card ────────────────────────────────────────────────────────────

function AnomalyCard({ anomaly, onInvestigate, isCreating }: {
  anomaly: any;
  onInvestigate: (a: any) => void;
  isCreating: boolean;
}) {
  const isCritical = anomaly.severity === "critical";
  return (
    <div className={`p-3 rounded-lg border ${isCritical ? "border-red-200 bg-red-500/5" : "border-amber-200 bg-yellow-500/5"}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className={`h-3.5 w-3.5 ${isCritical ? "text-red-700" : "text-amber-700"}`} />
            <span className="text-xs font-medium capitalize">{anomaly.dimension}</span>
            <Badge variant="outline" className={`text-[10px] ${isCritical ? "text-red-700 border-red-200" : "text-amber-700 border-amber-200"}`}>
              {anomaly.severity}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {anomaly.date} · Value: <strong>{anomaly.value}%</strong> · Drop: {anomaly.drop > 0 ? `−${anomaly.drop}pp` : "spike"} · Z={anomaly.z_score}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-7 shrink-0"
          onClick={() => onInvestigate(anomaly)}
          disabled={isCreating}
        >
          {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create Incident"}
        </Button>
      </div>
    </div>
  );
}

// ─── Chart + Anomaly Results ─────────────────────────────────────────────────

function MonitoringResults({
  series,
  anomalies,
  predictiveAlert,
  onRunAI,
  isRunningAI,
  onInvestigate,
  isCreatingIncident,
  incidentCreated,
}: {
  series: any[];
  anomalies: any[];
  predictiveAlert: any;
  onRunAI: () => void;
  isRunningAI: boolean;
  onInvestigate: (a: any) => void;
  isCreatingIncident: boolean;
  incidentCreated: any;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Chart */}
      <div className="floating-card p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13px] font-semibold tracking-tight">Quality Score Time Series ({series.length} Days)</p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRunAI}
            disabled={isRunningAI}
          >
            {isRunningAI
              ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Analysing…</>
              : <><Search className="h-3.5 w-3.5 mr-1" />Run AI Analysis</>}
          </Button>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={series}>
            <CartesianGrid {...CHART_GRID} />
            <XAxis dataKey="date" tick={CHART_AXIS.tick} tickFormatter={(v) => v.slice(5)} interval={Math.floor(series.length / 8)} />
            <YAxis domain={[50, 100]} tick={CHART_AXIS.tick} />
            <Tooltip
              cursor={CHART_CURSOR}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltipBox
                    label={label}
                    rows={payload.map((p) => ({
                      name: String(p.name),
                      value: `${p.value}%`,
                      color: DIM_COLORS[p.dataKey as string] ?? "#888",
                    }))}
                  />
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {Object.entries(DIM_COLORS).map(([dim, color]) => (
              <Line key={dim} type="monotone" dataKey={dim} stroke={color} dot={false} strokeWidth={1.5} name={dim} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        {anomalies.length > 0 && (
          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
            <span>{anomalies.length} anomalies detected</span>
            <span>·</span>
            <span className="text-red-700">{anomalies.filter((a) => a.severity === "critical").length} critical</span>
          </div>
        )}
      </div>

      {/* AI Predictive Alert */}
      {predictiveAlert && (
        <div className={`floating-card p-6 border ${
          predictiveAlert.severity === "critical" ? "border-red-200" :
          predictiveAlert.severity === "warning" ? "border-amber-200" : "border-sky-200"
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <Zap className={`h-4 w-4 ${
              predictiveAlert.severity === "critical" ? "text-red-700" :
              predictiveAlert.severity === "warning" ? "text-amber-700" : "text-sky-700"
            }`} />
            <span className="text-[13px] font-semibold tracking-tight">AI Predictive Alert</span>
            <Badge variant="outline" className={`text-[10px] ${
              predictiveAlert.severity === "critical" ? "text-red-700 border-red-200" : "text-amber-700 border-amber-200"
            }`}>
              {predictiveAlert.at_risk_dimension?.toUpperCase()} AT RISK
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{predictiveAlert.alert_message}</p>
          <div className="flex items-center gap-4 text-xs">
            <span>Predicted breach: <strong className="text-foreground">{predictiveAlert.predicted_breach_in_hours}h</strong></span>
            <span className="text-muted-foreground">|</span>
            <span>Action: <span className="text-primary">{predictiveAlert.recommended_action}</span></span>
          </div>
        </div>
      )}

      {/* Anomaly list */}
      {anomalies.length > 0 && (
        <div className="floating-card p-6">
          <p className="text-[13px] font-semibold tracking-tight mb-4">Detected Anomalies ({anomalies.length})</p>
          <div className="space-y-2">
            {anomalies.map((a, i) => (
              <AnomalyCard
                key={i}
                anomaly={a}
                onInvestigate={onInvestigate}
                isCreating={isCreatingIncident}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Click "Create Incident" on any anomaly to run AI root cause analysis. The incident will appear in the Incidents page.
          </p>
        </div>
      )}

      {anomalies.length === 0 && (
        <div className="floating-card p-6 text-center">
          <CheckCircle className="h-8 w-8 text-positive mx-auto mb-2" />
          <p className="text-sm font-medium text-positive">No anomalies detected</p>
          <p className="text-xs text-muted-foreground mt-1">All quality dimensions are within normal range.</p>
        </div>
      )}

      {/* Incident created feedback */}
      {incidentCreated && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="floating-card p-4 border border-primary/30/20"
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-positive" />
            <span className="text-sm font-medium text-positive">Incident Created</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            <strong>{incidentCreated.id}</strong> {incidentCreated.root_cause}
          </p>
          <p className="text-xs text-primary mt-1">Go to the <strong>Incidents</strong> page (sidebar) to view the full RCA, resolve, and generate a post-mortem.</p>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

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

  const simulateMutation = useMutation({
    mutationFn: () => api.simulateTimeSeries(baseline, 30),
    onSuccess: (data: any) => {
      setSeries(data.series || []);
      setAnomalies(data.anomalies || []);
      setPredictiveAlert(null);
      setIncidentCreated(null);
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: () => api.analyzeTimeSeries(series),
    onSuccess: (data: any) => {
      setAnomalies(data.anomalies || []);
      setPredictiveAlert(data.predictive_alert || null);
    },
  });

  const createIncidentMutation = useMutation({
    mutationFn: (anomaly: any) =>
      api.createIncident({ anomaly, title: `Quality Anomaly ${anomaly.dimension} drop detected` }),
    onSuccess: (data: any) => setIncidentCreated(data),
  });

  const handleRealDataRun = () => {
    const { series: parsed, error } = parseCSV(csvText);
    if (error) { setCsvError(error); return; }
    setCsvError(null);
    setSeries(parsed);
    setAnomalies([]);
    setPredictiveAlert(null);
    setIncidentCreated(null);
    // Auto-run anomaly detection on the parsed data
    api.analyzeTimeSeries(parsed).then((data: any) => {
      setAnomalies(data.anomalies || []);
      setPredictiveAlert(data.predictive_alert || null);
    });
  };

  const hasResults = series.length > 0;

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>

        <PageHeader
          icon={Radar}
          title="Production Monitoring"
          description="Track data quality metrics over time, detect anomalies using Z-score analysis, and get AI predictive alerts before a breach occurs."
        />

        {/* What this monitors */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {Object.entries(DIM_DESCRIPTIONS).map(([dim, desc]) => (
            <div key={dim} className="p-3 rounded-lg border border-border/30 bg-muted/10">
              <div className="flex items-center gap-2 mb-1">
                <div className="h-2 w-2 rounded-full" style={{ background: DIM_COLORS[dim] }} />
                <span className="text-xs font-medium capitalize">{dim}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted/30 rounded-lg w-fit mb-6">
          <button
            onClick={() => setTab("demo")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "demo" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FlaskConical className="h-4 w-4" />
            Demo Mode
          </button>
          <button
            onClick={() => setTab("real")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "real" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <TableProperties className="h-4 w-4" />
            My Data
          </button>
        </div>

        {/* ── Demo Mode ───────────────────────────────────────────────────────── */}
        {tab === "demo" && (
          <div className="space-y-6">
            <div className="floating-card p-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  <span className="font-display font-medium text-sm">Synthetic Demo Data</span>
                </div>
                <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200">
                  DEMO synthetic data only
                </Badge>
              </div>

              <div className="p-3 rounded-lg bg-muted/20 border border-border/30 mb-4 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 inline mr-1 text-primary" />
                This generates 30 days of fake quality scores based on the baseline you set. Anomalies are <strong>artificially injected</strong> at days 22–26 to demonstrate detection. Use the <strong>"My Data" tab</strong> to analyse real scores.
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                {Object.entries(baseline).map(([key, val]) => (
                  <div key={key}>
                    <label className="text-xs text-muted-foreground mb-1 block capitalize">{key} baseline %</label>
                    <input
                      type="range" min={50} max={100} value={val}
                      onChange={(e) => setBaseline((b) => ({ ...b, [key]: +e.target.value }))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>50</span>
                      <span className="font-medium text-foreground">{val}%</span>
                      <span>100</span>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => simulateMutation.mutate()}
                disabled={simulateMutation.isPending}
                className="bg-primary text-primary-foreground w-full"
              >
                {simulateMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating demo data…</>
                  : <><Zap className="h-4 w-4 mr-2" />Run Demo Simulation</>}
              </Button>
            </div>

            {hasResults && (
              <MonitoringResults
                series={series}
                anomalies={anomalies}
                predictiveAlert={predictiveAlert}
                onRunAI={() => analyzeMutation.mutate()}
                isRunningAI={analyzeMutation.isPending}
                onInvestigate={(a) => createIncidentMutation.mutate(a)}
                isCreatingIncident={createIncidentMutation.isPending}
                incidentCreated={incidentCreated}
              />
            )}
          </div>
        )}

        {/* ── Real Data Mode ───────────────────────────────────────────────────── */}
        {tab === "real" && (
          <div className="space-y-6">
            <div className="floating-card p-6">
              <div className="flex items-center gap-2 mb-3">
                <TableProperties className="h-4 w-4 text-primary" />
                <span className="font-display font-medium text-sm">Paste Your Quality Scores</span>
              </div>

              <div className="p-3 rounded-lg bg-muted/20 border border-border/30 mb-4 text-xs text-muted-foreground space-y-2">
                <p>
                  <span className="text-foreground font-medium">How to get these scores:</span> Run a data quality check on your dataset (using Great Expectations, dbt tests, custom SQL, etc.) and record the daily pass rate (0–100%) for each dimension.
                </p>
                <p>
                  Paste a CSV below with columns: <code className="bg-muted px-1 rounded">date, completeness, uniqueness, validity, consistency</code>. Each row is one day. Values are percentages (0–100).
                </p>
              </div>

              <Textarea
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setCsvError(null); }}
                placeholder={CSV_PLACEHOLDER}
                rows={10}
                className="bg-muted/30 border-border/50 resize-none font-mono text-xs mb-3"
              />

              {csvError && (
                <p className="text-xs text-red-700 mb-3">{csvError}</p>
              )}

              <Button
                onClick={handleRealDataRun}
                disabled={!csvText.trim()}
                className="bg-primary text-primary-foreground w-full"
              >
                <Activity className="h-4 w-4 mr-2" />
                Detect Anomalies
              </Button>
            </div>

            {hasResults && (
              <MonitoringResults
                series={series}
                anomalies={anomalies}
                predictiveAlert={predictiveAlert}
                onRunAI={() => analyzeMutation.mutate()}
                isRunningAI={analyzeMutation.isPending}
                onInvestigate={(a) => createIncidentMutation.mutate(a)}
                isCreatingIncident={createIncidentMutation.isPending}
                incidentCreated={incidentCreated}
              />
            )}

            {!hasResults && (
              <div className="floating-card p-6 text-center text-muted-foreground">
                <TableProperties className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Paste your CSV data above and click "Detect Anomalies"</p>
                <p className="text-xs mt-1">The system will chart your data and highlight any statistical anomalies (Z-score &gt; 2.5 or single-day drops &gt; 10pp).</p>
              </div>
            )}
          </div>
        )}

      </motion.div>
    </PageShell>
  );
}
