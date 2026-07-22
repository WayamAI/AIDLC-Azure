import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, CheckCircle2, XCircle, Clock, TrendingUp, Loader2, RefreshCw,
  ArrowRight, ArrowUpDown, Upload, Columns, FileSpreadsheet,
  ChevronRight, X, Info, Table2, PenLine, Plus, Trash2, FlaskConical,
} from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRunTests } from "@/hooks/use-test-execution";
import { api, type PreviewDataset, type TestResult, type RunStarted } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { AiIcon } from "@/lib/icons";

const COLORS = ["hsl(32, 100%, 58%)", "hsl(0, 72%, 55%)"];

type DataSource = "auto" | "file" | "columns";
type Phase = "select" | "preview" | "running" | "results";

const DATA_SOURCE_OPTIONS: {
  id: DataSource;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  desc: string;
  color: string;
  badge?: string;
}[] = [
  {
    id: "file",
    icon: FileSpreadsheet,
    title: "Upload Existing Dataset",
    subtitle: "CSV or Excel (.xlsx)",
    desc: "Upload a real-world test data file. Column headers and row values are used as the execution context ideal when validated, production-quality data is available.",
    color: "border-primary/40 hover:border-primary text-primary",
    badge: "Use existing data",
  },
  {
    id: "columns",
    icon: Columns,
    title: "Define Column Schema",
    subtitle: "AI synthesizes the records",
    desc: "Specify the required column names (e.g. vehicle_id, speed, fuel_level). The AI engine synthesizes realistic, schema-compliant data rows automatically.",
    color: "border-secondary/40 hover:border-secondary text-secondary",
    badge: "AI-synthesized data",
  },
  {
    id: "auto",
    icon: AiIcon,
    title: "Fully Automated Mode",
    subtitle: "AI-managed data context",
    desc: "The AI engine determines the optimal data context from your submitted requirement and executes all tests automatically. Recommended for rapid initial validation.",
    color: "border-positive/40 hover:border-positive text-positive",
    badge: "Recommended",
  },
];

const TestExecution = () => {
  const navigate = useNavigate();

  // Phase controls which section is visible
  const [phase, setPhase] = useState<Phase>("select");
  const [dataSource, setDataSource] = useState<DataSource>("auto");
  const [columnInput, setColumnInput] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | undefined>();
  const [runStarted, setRunStarted] = useState<RunStarted | null>(null);
  const [liveResults, setLiveResults] = useState<TestResult[]>([]);
  const [totalExpected, setTotalExpected] = useState(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const runTestsMutation = useRunTests();

  // Preview-phase state
  const [previewData, setPreviewData] = useState<PreviewDataset | null>(null);
  const [editableRows, setEditableRows] = useState<Record<string, unknown>[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const passed = liveResults.filter((t) => t.status === "PASS").length;
  const failed = liveResults.filter((t) => t.status === "FAIL").length;
  const total = liveResults.length;
  const successRate = totalExpected > 0 ? Math.round((passed / totalExpected) * 100) : 0;
  const totalDuration = liveResults.reduce((s, t) => s + t.duration, 0).toFixed(1);

  const pieData = [
    { name: "Passed", value: passed },
    { name: "Failed", value: failed },
  ];

  const canRun =
    dataSource === "auto" ||
    (dataSource === "file" && uploadedFile !== null) ||
    (dataSource === "columns" && columnInput.trim().length > 0);

  // -- Polling: while in "running" phase, fetch new results every 800ms ----
  useEffect(() => {
    if (phase !== "running" || !activeRunId || totalExpected === 0) return;

    const poll = async () => {
      try {
        const res = await api.getResults(activeRunId, totalExpected + 10);
        setLiveResults(res);
        if (res.length >= totalExpected) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setPhase("results");
        }
      } catch {
        // keep polling on transient network errors
      }
    };

    poll(); // immediate first check
    pollingRef.current = setInterval(poll, 800);
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  }, [phase, activeRunId, totalExpected]);

  const handleRunTests = async (rowsOverride?: Record<string, unknown>[]) => {
    setPhase("running");
    setLiveResults([]);
    try {
      const requirementId = localStorage.getItem("lastRequirementId") ?? undefined;
      const started = await runTestsMutation.mutateAsync({
        dataSource,
        requirementId,
        columns: dataSource === "columns" ? columnInput : undefined,
        file: dataSource === "file" ? (uploadedFile ?? undefined) : undefined,
        previewRows: rowsOverride ?? (dataSource === "auto" && editableRows.length > 0 ? editableRows : undefined),
      });
      setActiveRunId(started.run_id);
      setTotalExpected(started.total);
      setRunStarted(started);
      // polling starts via the useEffect above
    } catch {
      setPhase("select");
    }
  };

  const handleGeneratePreview = async () => {
    const requirementId = localStorage.getItem("lastRequirementId");
    if (!requirementId) {
      alert("No requirement found. Please analyse a requirement first (Step 1).");
      return;
    }
    setIsPreviewLoading(true);
    try {
      const result = await api.previewSyntheticData(requirementId, 20);
      setPreviewData(result);
      setEditableRows(result.rows.map(r => ({ ...r })));
      setPhase("preview");
    } catch (e) {
      alert("Failed to generate preview: " + (e as Error).message);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Editable table helpers
  const updateCell = (rowIdx: number, field: string, value: unknown) => {
    setEditableRows(prev => {
      const updated = [...prev];
      updated[rowIdx] = { ...updated[rowIdx], [field]: value };
      return updated;
    });
  };

  const addRow = () => {
    if (!previewData) return;
    const empty: Record<string, unknown> = {};
    previewData.schema_fields.forEach(f => {
      empty[f.name] = f.type === "boolean" ? false : f.type === "integer" || f.type === "float" ? 0 : "";
    });
    setEditableRows(prev => [...prev, empty]);
  };

  const deleteRow = (idx: number) => {
    setEditableRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setUploadedFile(f);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setUploadedFile(f);
  };

  const stats = [
    { label: "Total Tests", value: total, icon: Play, color: "text-primary" },
    { label: "Passed", value: passed, icon: CheckCircle2, color: "text-positive" },
    { label: "Failed", value: failed, icon: XCircle, color: "text-destructive" },
    { label: "Duration", value: `${totalDuration}s`, icon: Clock, color: "text-warning" },
  ];

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>

        {/* Step banner */}
        <div className="page-card flex items-center gap-3 mb-6 p-4 border-positive/20">
          <div className="h-9 w-9 rounded-lg bg-positive/20 border border-positive/30 flex items-center justify-center shrink-0 font-display font-bold text-positive text-sm">3</div>
          <div className="flex-1">
            <span className="font-display font-semibold text-sm">Step 3 of 4 Execute Test Suite</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select a data source configuration, then initiate execution. Choose to upload an existing file, define a column schema, or allow the AI to manage the data context automatically.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 font-display gap-1.5" onClick={() => navigate("/prioritization")}>
            <ArrowUpDown className="h-3.5 w-3.5" />Proceed to Prioritization<ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-start justify-between mb-6 gap-4">
          <PageHeader
            className="mb-0 flex-1"
            icon={FlaskConical}
            title="Test Execution"
            description={
              phase === "results"
                ? `Execution complete ${liveResults.length} test cases · ${totalDuration}s total duration`
                : "Configure a data source and initiate execution"
            }
          />
          {phase === "results" && (
            <Button
              variant="outline"
              size="sm"
              className="font-display gap-1.5"
              onClick={() => {
                setPhase("select"); setActiveRunId(undefined); setRunStarted(null);
                setLiveResults([]); setTotalExpected(0); setPreviewData(null); setEditableRows([]);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />Initiate New Run
            </Button>
          )}
        </div>

        {/* -- SELECT PHASE --------------------------------------- */}
        <AnimatePresence mode="wait">
          {phase === "select" && (
            <motion.div key="select" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>

              {/* 3 option cards */}
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {DATA_SOURCE_OPTIONS.map((opt) => {
                  const active = dataSource === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setDataSource(opt.id)}
                      className={`text-left p-5 rounded-xl border-2 transition-all bg-card ${active ? opt.color + " bg-muted/30 shadow-sm" : "border-border/40 hover:border-border"}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${active ? "bg-current/10" : "bg-muted"}`}>
                          <opt.icon className={`h-4.5 w-4.5 ${active ? opt.color.split(" ").pop() : "text-muted-foreground"}`} />
                        </div>
                        {opt.badge && (
                          <Badge variant="outline" className={`text-[10px] ${active ? opt.color : "border-border text-muted-foreground"}`}>
                            {opt.badge}
                          </Badge>
                        )}
                      </div>
                      <p className="font-display font-semibold text-sm mb-0.5">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground mb-2">{opt.subtitle}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{opt.desc}</p>
                      {active && (
                        <div className="mt-3 flex items-center gap-1 text-xs font-medium text-current">
                          <ChevronRight className="h-3 w-3" />Selected Configuration
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Inline input for the selected source */}
              <AnimatePresence mode="wait">
                {dataSource === "file" && (
                  <motion.div key="file-input" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="floating-card p-5 mb-6 overflow-hidden">
                    <div className="flex items-center gap-2 mb-3">
                      <Upload className="h-4 w-4 text-primary" />
                      <span className="font-display text-[13px] font-semibold tracking-tight">Upload Test Dataset</span>
                      <Badge variant="outline" className="text-[10px] ml-auto">CSV or XLSX</Badge>
                    </div>
                    <div
                      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/50 hover:bg-muted/20"}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleFileDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input type="file" ref={fileInputRef} accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
                      {uploadedFile ? (
                        <div className="flex items-center justify-center gap-3">
                          <FileSpreadsheet className="h-8 w-8 text-primary" />
                          <div className="text-left">
                            <p className="font-display font-semibold text-sm">{uploadedFile.name}</p>
                            <p className="text-xs text-muted-foreground">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <button
                            className="ml-4 text-muted-foreground hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                          <p className="text-sm font-display font-medium mb-1">Drag and drop your file here</p>
                          <p className="text-xs text-muted-foreground">or click to browse CSV or Excel (.xlsx) supported</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-start gap-2 mt-3 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Column headers from the uploaded file serve as the test data context. A maximum of 50 rows are processed per execution run.</span>
                    </div>
                  </motion.div>
                )}

                {dataSource === "columns" && (
                  <motion.div key="cols-input" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="floating-card p-5 mb-6 overflow-hidden">
                    <div className="flex items-center gap-2 mb-3">
                      <Columns className="h-4 w-4 text-secondary" />
                      <span className="font-display text-[13px] font-semibold tracking-tight">Define Column Schema</span>
                    </div>
                    <Textarea
                      value={columnInput}
                      onChange={(e) => setColumnInput(e.target.value)}
                      placeholder="e.g. vehicle_id, speed, fuel_level, engine_temp, gps_lat, gps_lng"
                      className="min-h-[80px] bg-muted/30 border-border/50 text-foreground placeholder:text-muted-foreground/40 focus:border-secondary/50 resize-none text-sm font-mono mb-3"
                    />
                    {columnInput.trim() && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {columnInput.split(",").map((c) => c.trim()).filter(Boolean).map((col) => (
                          <Badge key={col} variant="outline" className="text-[11px] border-secondary/30 bg-secondary/10 text-secondary font-mono">
                            {col}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Enter column names separated by commas. The AI engine synthesizes 20 realistic, schema-compliant data rows for use as the execution context.</span>
                    </div>
                  </motion.div>
                )}

                {dataSource === "auto" && (
                  <motion.div key="auto-info" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="floating-card p-5 mb-6 border-positive/20 overflow-hidden">
                    <div className="flex items-start gap-3 mb-4">
                      <AiIcon className="h-4 w-4 text-positive mt-0.5 shrink-0" />
                      <div>
                        <p className="font-display text-[13px] font-semibold tracking-tight mb-1">AI-Managed Data Configuration</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Select <strong>Generate Data Preview</strong> to review the records synthesized by the AI for your requirement. Individual values, rows, and columns may be modified prior to execution. Alternatively, proceed directly to execution for rapid validation.
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleGeneratePreview}
                      disabled={isPreviewLoading}
                      className="font-display gap-1.5 border-positive/40 text-positive hover:bg-positive/10"
                    >
                      {isPreviewLoading
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Synthesizing dataset…</>
                        : <><Table2 className="h-3.5 w-3.5" />Generate Data Preview</>}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex justify-end gap-2">
                {dataSource === "auto" && (
                  <Button
                    variant="outline"
                    onClick={() => handleRunTests()}
                    disabled={!canRun}
                    size="lg"
                    className="font-display gap-2 px-6"
                  >
                    <Play className="h-4 w-4" />
                    Execute Without Preview
                  </Button>
                )}
                <Button
                  onClick={dataSource === "auto" ? handleGeneratePreview : () => handleRunTests()}
                  disabled={!canRun || isPreviewLoading}
                  size="lg"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 font-display glow-primary gap-2 px-8"
                >
                  {isPreviewLoading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
                  ) : dataSource === "auto" ? (
                    <><Table2 className="h-4 w-4" />Generate Data Preview</>
                  ) : (
                    <><Play className="h-4 w-4" />Confirm &amp; Execute Tests</>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* -- PREVIEW PHASE ------------------------------------- */}
          {phase === "preview" && previewData && (
            <motion.div key="preview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="floating-card p-5 mb-4">
                <div className="flex items-center gap-2 mb-4">
                  <Table2 className="h-4 w-4 text-positive" />
                  <span className="font-display text-[13px] font-semibold tracking-tight">AI-Synthesized Dataset Review &amp; Refine</span>
                  <Badge variant="secondary" className="ml-2 text-xs">{editableRows.length} rows</Badge>
                  <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
                    <PenLine className="h-3 w-3" />Select any cell to modify
                  </span>
                </div>

                {/* Schema chips */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {previewData.schema_fields.map(f => (
                    <span
                      key={f.name}
                      title={f.description}
                      className="text-[10px] px-2 py-0.5 rounded-full border font-mono bg-positive/10 text-positive border-positive/20"
                    >
                      {f.name}
                      <span className="opacity-50 ml-1">:{f.type}</span>
                    </span>
                  ))}
                </div>

                {/* Editable table */}
                <div className="overflow-x-auto rounded-lg border border-border/30">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/30 bg-muted/40">
                        <th className="px-3 py-2.5 text-left font-display font-medium text-muted-foreground w-10">#</th>
                        {previewData.schema_fields.map(f => (
                          <th key={f.name} className="px-3 py-2.5 text-left font-display font-medium text-muted-foreground whitespace-nowrap">
                            {f.name}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {editableRows.map((row, rowIdx) => (
                        <tr key={rowIdx} className="border-b border-border/20 hover:bg-muted/10 group">
                          <td className="px-3 py-1.5 text-muted-foreground/40 font-mono select-none">{rowIdx + 1}</td>
                          {previewData.schema_fields.map(f => (
                            <td key={f.name} className="px-1 py-1">
                              {f.type === "boolean" ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(row[f.name])}
                                  onChange={e => updateCell(rowIdx, f.name, e.target.checked)}
                                  className="mx-3 accent-success"
                                />
                              ) : (
                                <input
                                  type={f.type === "integer" || f.type === "float" ? "number" : "text"}
                                  step={f.type === "float" ? "any" : undefined}
                                  value={String(row[f.name] ?? "")}
                                  onChange={e => {
                                    const raw = e.target.value;
                                    const val =
                                      f.type === "integer" ? (parseInt(raw) || 0)
                                      : f.type === "float" ? (parseFloat(raw) || 0)
                                      : raw;
                                    updateCell(rowIdx, f.name, val);
                                  }}
                                  className="w-full min-w-[90px] bg-transparent border border-transparent hover:border-border/40 focus:border-primary/50 focus:bg-primary/5 rounded px-2 py-1 font-mono outline-none transition-colors"
                                />
                              )}
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <button
                              onClick={() => deleteRow(rowIdx)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add Record */}
                <button
                  onClick={addRow}
                  className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-display"
                >
                  <Plus className="h-3.5 w-3.5" />Add Record
                </button>
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center">
                <Button
                  variant="outline" size="sm"
                  className="font-display gap-1.5"
                  onClick={() => setPhase("select")}
                >
                  ? Change Data Source
                </Button>
                <Button
                  size="lg"
                  onClick={() => handleRunTests(editableRows)}
                  disabled={editableRows.length === 0}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 font-display glow-primary gap-2 px-8"
                >
                  <Play className="h-4 w-4" />
                  Execute Tests with this Dataset
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}

          {phase === "running" && (
            <motion.div key="running" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              {/* Header */}
              <div className="floating-card p-6 mb-4 text-center">
                <div className="h-14 w-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4 animate-pulse-glow">
                  <Loader2 className="h-6 w-6 text-primary animate-spin" />
                </div>
                <h3 className="font-display font-semibold text-lg mb-1">Executing Test Suite…</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {liveResults.length} of {totalExpected} test cases executed
                </p>
                {/* Progress bar */}
                <div className="h-2 bg-muted rounded-full overflow-hidden max-w-sm mx-auto">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary to-success rounded-full"
                    animate={{ width: totalExpected > 0 ? `${(liveResults.length / totalExpected) * 100}%` : "0%" }}
                    transition={{ ease: "easeOut", duration: 0.4 }}
                  />
                </div>
              </div>

              {/* Live results stream */}
              {liveResults.length > 0 && (
                <div className="floating-card overflow-hidden">
                  <div className="p-3 border-b border-border/30 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="font-display text-[13px] font-semibold tracking-tight">Live Execution Feed</span>
                    <span className="ml-auto font-mono">
                      <span className="text-positive">{liveResults.filter(r => r.status === "PASS").length} pass</span>
                      {" · "}
                      <span className="text-destructive">{liveResults.filter(r => r.status === "FAIL").length} fail</span>
                    </span>
                  </div>
                  <div className="divide-y divide-border/20 max-h-72 overflow-y-auto">
                    {[...liveResults].reverse().map((t, i) => (
                      <motion.div
                        key={t.tc_id + i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <div className="flex items-center gap-2.5">
                          {t.status === "PASS"
                            ? <CheckCircle2 className="h-3.5 w-3.5 text-positive shrink-0" />
                            : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                          <span className="font-mono text-[11px] text-muted-foreground w-14 shrink-0">{t.tc_id}</span>
                          <span className="text-xs">{t.name}</span>
                        </div>
                        <span className="text-[11px] font-mono text-muted-foreground shrink-0 ml-4">{t.duration.toFixed(2)}s</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* -- RESULTS PHASE ------------------------------------- */}
          {phase === "results" && (
            <motion.div key="results" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

              {/* Data source tag */}
              {runStarted && runStarted.data_source && runStarted.data_source !== "auto" && (
                <div className="floating-card p-3 mb-5 flex items-center gap-3 text-sm border-border/40">
                  {runStarted.data_source === "file" ? <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" /> : <Columns className="h-4 w-4 text-secondary shrink-0" />}
                  <span className="text-muted-foreground text-xs">
                    {runStarted.data_source === "file" ? "Executed using uploaded file data" : "Executed using AI-synthesized data"}
                    {runStarted.data_columns && runStarted.data_columns.length > 0 && (
                      <> · columns: {runStarted.data_columns.map((c) => <Badge key={c} variant="outline" className="ml-1 text-[10px] font-mono">{c}</Badge>)}</>
                    )}
                    {runStarted.data_row_count != null && ` · ${runStarted.data_row_count} rows`}
                  </span>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {stats.map((s, i) => (
                  <motion.div key={s.label} initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="stat-card">
                    <div className="flex items-center gap-2 mb-2">
                      <s.icon className={`h-4 w-4 ${s.color}`} />
                      <span className="text-xs text-muted-foreground">{s.label}</span>
                    </div>
                    <span className="text-2xl font-display font-bold">{s.value}</span>
                  </motion.div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-4 mb-6">
                {/* Success rate */}
                <div className="floating-card p-5 flex flex-col items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-primary mb-2" />
                  <span className="text-xs text-muted-foreground mb-1">Overall Success Rate</span>
                  <span className="text-4xl font-display font-bold text-gradient-brand">{successRate}%</span>
                  <div className="w-full mt-4 h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div className="h-full bg-gradient-to-r from-success to-primary rounded-full" initial={{ width: 0 }} animate={{ width: `${successRate}%` }} transition={{ duration: 1, delay: 0.3 }} />
                  </div>
                </div>

                {/* Pie */}
                <div className="floating-card p-5">
                  <h3 className="font-display text-[13px] font-semibold tracking-tight mb-2 text-center">Pass vs. Fail Breakdown</h3>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={4} dataKey="value">
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))", fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex justify-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-positive" /> Passed</span>
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /> Failed</span>
                  </div>
                </div>

                {/* Coverage */}
                <div className="floating-card p-5">
                  <h3 className="font-display text-[13px] font-semibold tracking-tight mb-4">Test Coverage Analysis</h3>
                  {[{ label: "Functional", pct: 85 }, { label: "Edge Cases", pct: 60 }, { label: "API", pct: 75 }, { label: "Regression", pct: 50 }].map((c, i) => (
                    <div key={c.label} className="mb-3">
                      <div className="flex justify-between text-xs mb-1"><span className="text-muted-foreground">{c.label}</span><span className="font-mono">{c.pct}%</span></div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <motion.div className="h-full bg-primary rounded-full" initial={{ width: 0 }} animate={{ width: `${c.pct}%` }} transition={{ duration: 0.8, delay: 0.3 + i * 0.1 }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Full results timeline */}
              <div className="floating-card overflow-hidden">
                <div className="p-4 border-b border-border/30 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <span className="font-display text-[13px] font-semibold tracking-tight">Complete Execution Results</span>
                  <Badge variant="secondary" className="ml-2 text-xs">{liveResults.length} test cases</Badge>
                  {activeRunId && <span className="text-xs font-mono text-muted-foreground ml-auto">Run ID: {activeRunId.slice(0, 8)}…</span>}
                </div>

                {/* Failed tests first, then passed */}
                {(["FAIL", "PASS"] as const).map((filterStatus) => {
                  const group = liveResults.filter(t => t.status === filterStatus);
                  if (group.length === 0) return null;
                  return (
                    <div key={filterStatus}>
                      <div className={`px-4 py-2 text-[11px] font-display font-semibold flex items-center gap-2 ${filterStatus === "FAIL" ? "bg-destructive/5 text-destructive" : "bg-positive/5 text-positive"}`}>
                        {filterStatus === "FAIL" ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {filterStatus === "FAIL" ? `Failed (${group.length})` : `Passed (${group.length})`}
                      </div>
                      <div className="divide-y divide-border/20">
                        {group.map((t, i) => (
                          <motion.div
                            key={t.tc_id + i}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.02 }}
                            className="px-4 py-3 hover:bg-muted/20 transition-colors"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-3">
                                {t.status === "PASS"
                                  ? <CheckCircle2 className="h-4 w-4 text-positive shrink-0" />
                                  : <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                                <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{t.tc_id}</span>
                                <span className="text-sm font-medium">{t.name}</span>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className="text-xs text-muted-foreground font-mono">{t.duration.toFixed(2)}s</span>
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${t.status === "PASS" ? "bg-positive/15 text-positive border-positive/20" : "bg-destructive/15 text-destructive border-destructive/20"}`}
                                >
                                  {t.status}
                                </Badge>
                              </div>
                            </div>
                            {t.error_message && (
                              <div className="mt-1.5 ml-7 text-xs font-mono text-destructive/80 bg-destructive/5 border border-destructive/10 rounded px-3 py-2 leading-relaxed">
                                {t.error_message}
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Next step CTA */}
              <div className="mt-6 flex justify-end">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 font-display gap-2" onClick={() => navigate("/prioritization")}>
                  <ArrowUpDown className="h-4 w-4" />
                  Proceed to Priority Ranking
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </PageShell>
  );
};

export default TestExecution;
