import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Database,
  Layers,
  ChevronUp,
  Plus,
  Download,
  Code2,
  FileText,
} from "lucide-react";
import { AiIcon } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type WorkspacePlaywrightTest, type WorkspaceTestStep } from "@/lib/api";

// ── Export Helpers ────────────────────────────────────────────────────────────

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stepToString(s: WorkspaceTestStep): string {
  let str = s.action;
  if (s.selector) str += ` ${s.selector}`;
  if (s.value) str += ` → "${s.value}"`;
  if (s.description) str += ` (${s.description})`;
  return str.trim();
}

function testSource(t: WorkspacePlaywrightTest): string {
  return (t as any).source === "baseline" ? "baseline" : "session";
}

function escapeCsv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportJson(tests: WorkspacePlaywrightTest[]): string {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      total_tests: tests.length,
      tests: tests.map((t) => ({ ...t, source: testSource(t) })),
    },
    null,
    2
  );
}

function exportCsv(tests: WorkspacePlaywrightTest[]): string {
  const headers = ["id", "name", "description", "page_name", "severity", "source", "steps"];
  const rows = tests.map((t) =>
    [
      t.id,
      t.name,
      t.description,
      t.page_name,
      t.severity,
      testSource(t),
      t.steps.map((s, i) => `${i + 1}. ${stepToString(s)}`).join(" | "),
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [headers.join(","), ...rows].join("\r\n");
}

function exportMarkdown(tests: WorkspacePlaywrightTest[]): string {
  const lines: string[] = [];
  lines.push("# Execution Plan Test Cases");
  lines.push("");
  lines.push(`- Total tests: ${tests.length}`);
  lines.push(`- Exported: ${new Date().toISOString()}`);
  lines.push("");

  tests.forEach((t, idx) => {
    lines.push(`## ${idx + 1}. ${t.name}`);
    lines.push("");
    lines.push(`- **Page:** \`${t.page_name || "—"}\``);
    lines.push(`- **Severity:** ${t.severity}`);
    lines.push(`- **Source:** ${testSource(t)}`);
    lines.push("");
    if (t.description) {
      lines.push(t.description);
      lines.push("");
    }
    if (t.steps.length) {
      lines.push("**Steps:**");
      lines.push("");
      t.steps.forEach((s, i) => lines.push(`${i + 1}. ${stepToString(s)}`));
      lines.push("");
    }
  });

  return lines.join("\n");
}

const severityClass: Record<string, string> = {
  Critical: "bg-red-500/15 text-red-700 border-red-200",
  High: "bg-orange-500/15 text-orange-700 border-orange-200",
  Medium: "bg-yellow-500/15 text-amber-700 border-amber-200",
  Low: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

interface FileGroup {
  filePath: string;
  tests: WorkspacePlaywrightTest[];
}

export function UnifiedTestIntelligence({ tests }: { tests: WorkspacePlaywrightTest[] }) {
  const [expanded, setExpanded] = useState(true);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const sessionTests = tests.filter(t => (t as any).source === "session");
  const baselineTests = tests.filter(t => (t as any).source === "baseline");

  const buildGroups = (testList: WorkspacePlaywrightTest[]) => {
    return testList.reduce<FileGroup[]>((acc, t) => {
      const key = t.page_name || "Unknown";
      const existing = acc.find((g) => g.filePath === key);
      if (existing) {
        existing.tests.push(t);
      } else {
        acc.push({ filePath: key, tests: [t] });
      }
      return acc;
    }, []);
  };

  const sessionGroups = buildGroups(sessionTests);
  const baselineGroups = buildGroups(baselineTests);

  const allFilePaths = Array.from(new Set([...sessionGroups.map(g => g.filePath), ...baselineGroups.map(g => g.filePath)]));
  const allGroups = allFilePaths.map(fp => ({
    filePath: fp,
    sessionTests: sessionGroups.find(g => g.filePath === fp)?.tests || [],
    baselineTests: baselineGroups.find(g => g.filePath === fp)?.tests || []
  }));

  const toggleFile = (fp: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const handleDownload = (format: "json" | "csv" | "md") => {
    if (tests.length === 0) return;
    const base = "execution-plan-tests";
    if (format === "json") {
      triggerDownload(`${base}.json`, exportJson(tests), "application/json");
    } else if (format === "csv") {
      triggerDownload(`${base}.csv`, exportCsv(tests), "text/csv");
    } else {
      triggerDownload(`${base}.md`, exportMarkdown(tests), "text/markdown");
    }
  };

  const toggleTest = (id: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function renderTestItem(test: WorkspacePlaywrightTest, theme: "primary" | "secondary") {
    const isExpanded = expandedTests.has(test.id);
    return (
      <div
        key={test.id}
        className={cn(
          "group relative flex flex-col gap-0 rounded-2xl border transition-all overflow-hidden",
          theme === "primary" ? "border-primary/10 bg-primary/[0.02]" : "border-secondary/10 bg-secondary/[0.02]",
          isExpanded && (theme === "primary" ? "border-primary/30 ring-1 ring-primary/10" : "border-secondary/30 ring-1 ring-secondary/10")
        )}
      >
        <button 
           onClick={() => toggleTest(test.id)}
           className="flex items-center gap-3 py-3 px-4 w-full text-left hover:bg-white/5 transition-colors"
        >
          <div className={cn(
            "absolute left-1 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-full transition-all opacity-40 group-hover:opacity-100",
            theme === "primary" ? "bg-primary/50 group-hover:bg-primary" : "bg-secondary/50 group-hover:bg-secondary"
          )} />
          <FlaskConical className={cn("h-4 w-4 shrink-0", theme === "primary" ? "text-primary/60" : "text-secondary/60")} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black text-foreground/80 group-hover:text-foreground transition-colors truncate uppercase tracking-tight">
              {test.name}
            </p>
            {test.description && (
              <p className="text-[9px] text-muted-foreground truncate opacity-60 italic leading-tight">{test.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge 
              variant="outline" 
              className={cn(
                "text-[8px] h-4 px-1.5 font-black shrink-0 tracking-tighter uppercase",
                severityClass[test.severity.charAt(0).toUpperCase() + test.severity.slice(1).toLowerCase()] ?? "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {test.severity.slice(0, 3)}
            </Badge>
            {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground/60" /> : <ChevronDown className="h-3 w-3 text-muted-foreground/40" />}
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 animate-in fade-in slide-in-from-top-1 duration-300">
            <div className="mt-2 space-y-1.5 border-l border-border/40 pl-4 py-1 ml-1.5">
              {test.steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-[10px] py-1 group/step">
                  <span className="text-[9px] font-mono text-muted-foreground/40 mt-0.5 w-3 text-right">{idx + 1}</span>
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                        <span className={cn(
                          "font-black uppercase tracking-widest text-[8px] px-1.5 py-0.5 rounded",
                        theme === "primary"
                          ? "bg-primary/10 text-primary"
                          : "bg-secondary/10 text-secondary"
                        )}>
                          {step.action}
                        </span>
                       <span className="font-mono text-foreground/70 truncate max-w-[200px]">
                         {step.selector || step.value || "—"}
                       </span>
                    </div>
                    {step.description && (
                      <p className="text-[9px] text-muted-foreground font-medium italic opacity-70">{step.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ── Selection Summary Bar ────────────────────────────────────────────── */}
      <div className={cn(
        "grid grid-cols-1 gap-4 pb-2",
        baselineTests.length > 0 ? "md:grid-cols-3" : "md:grid-cols-2"
      )}>
        <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 backdrop-blur-sm group hover:border-primary/40 transition-all">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
              <AiIcon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">Session Intelligence</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black tabular-nums tracking-tighter">{sessionTests.length}</span>
                <span className="text-[10px] font-bold text-muted-foreground/60 uppercase">Units active</span>
              </div>
            </div>
          </div>
        </div>

        {baselineTests.length > 0 && (
          <div className="p-4 rounded-2xl bg-gradient-to-br from-secondary/10 to-secondary/5 border border-secondary/20 backdrop-blur-sm group hover:border-secondary/40 transition-all">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-2xl bg-secondary/10 border border-secondary/20 group-hover:scale-110 transition-transform">
                <Database className="h-4 w-4 text-secondary" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-secondary/70">Persistent Baseline</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-black tabular-nums tracking-tighter">{baselineTests.length}</span>
                  <span className="text-[10px] font-bold text-muted-foreground/60 uppercase">Units merged</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 backdrop-blur-sm group hover:border-primary/40 transition-all shadow-[0_0_30px_rgba(var(--primary),0.05)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-2xl bg-primary/10 border border-primary/20 group-hover:scale-110 transition-transform">
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">Total Suite Coverage</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black tabular-nums tracking-tighter">{tests.length}</span>
                <span className="text-[10px] font-bold text-muted-foreground/60 uppercase">Total active</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-border/40 bg-card/60 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm transition-all duration-500">
        <div className="bg-primary/5 px-6 py-4 flex items-center justify-between border-b border-border/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/20 border border-primary/30">
              <FlaskConical className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight uppercase">Execution Plan Orchestration</h3>
              <p className="text-[10px] text-muted-foreground font-medium">Configure and verify tests from diverse intelligence streams</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={tests.length === 0}
                  className="h-8 text-xs gap-1.5 bg-background/80 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary font-bold uppercase tracking-widest rounded-lg"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-xs">Export {tests.length} tests</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleDownload("json")} className="text-xs gap-2">
                  <Code2 className="h-3.5 w-3.5" /> JSON (.json)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("csv")} className="text-xs gap-2">
                  <Database className="h-3.5 w-3.5" /> CSV (.csv)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload("md")} className="text-xs gap-2">
                  <FileText className="h-3.5 w-3.5" /> Markdown (.md)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Badge variant="outline" className="bg-background/80 border-primary/30 text-primary font-bold px-3 py-1 rounded-lg">
              {tests.length} Units Ready
            </Badge>
            <button
              className="p-1.5 hover:bg-primary/10 rounded-lg transition-all text-muted-foreground hover:text-primary"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="p-6 bg-gradient-to-b from-transparent to-background/20">
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin">
              {allGroups.length === 0 ? (
                  <div className="py-20 text-center rounded-2xl border border-dashed border-border/20 bg-muted/5 space-y-4">
                  <div className="p-4 w-16 h-16 rounded-3xl bg-primary/10 border border-primary/20 mx-auto transition-transform flex items-center justify-center">
                    <Plus className="h-8 w-8 text-primary/40" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-foreground/80 uppercase tracking-widest">No Active Intelligence Units</p>
                    <p className="text-[11px] text-muted-foreground max-w-[200px] mx-auto">Switch to Growth Mode to generate or enable Repo Baseline.</p>
                  </div>
                </div>
              ) : (
                allGroups.map((group) => {
                  const isOpen = expandedFiles.has(group.filePath);
                  return (
                      <div key={group.filePath} className={cn(
                      "border rounded-2xl overflow-hidden transition-all duration-300",
                      isOpen ? "border-primary/20 shadow-sm ring-1 ring-primary/5 bg-card/40" : "border-border/30 hover:border-primary/20 bg-card/20",
                    )}>
                      <button
                        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/10 transition-colors"
                        onClick={() => toggleFile(group.filePath)}
                      >
                        <div className="relative">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-primary flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-[13px] font-black uppercase tracking-tight text-foreground/90">{group.filePath}</p>
                          <div className="flex items-center gap-3 mt-1.5">
                            {group.sessionTests.length > 0 && (
                                <Badge variant="outline" className="bg-primary/10 border-primary/20 text-primary text-[8px] h-4 tracking-widest font-black uppercase">
                                    {group.sessionTests.length} Session
                                </Badge>
                            )}
                            {group.baselineTests.length > 0 && (
                                <Badge variant="outline" className="bg-secondary/10 border-secondary/20 text-secondary text-[8px] h-4 tracking-widest font-black uppercase">
                                    {group.baselineTests.length} Baseline
                                </Badge>
                            )}
                          </div>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="px-5 pb-5 pt-1 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                           {group.sessionTests.length > 0 && (
                             <div className="space-y-3">
                               <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/60 ml-1">New Session Units</p>
                               <div className="grid grid-cols-1 gap-2">
                                 {group.sessionTests.map(t => renderTestItem(t, "primary"))}
                               </div>
                             </div>
                           )}
                           {group.baselineTests.length > 0 && (
                             <div className="space-y-3">
                               <p className="text-[9px] font-black uppercase tracking-[0.2em] text-secondary/60 ml-1">Production Baseline Units</p>
                               <div className="grid grid-cols-1 gap-2">
                                 {group.baselineTests.map(t => renderTestItem(t, "secondary"))}
                               </div>
                             </div>
                           )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
