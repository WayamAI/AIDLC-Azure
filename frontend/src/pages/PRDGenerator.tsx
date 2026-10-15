import React, { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Loader2,
  FileText,
  Download,
  Pencil,
  CheckCircle2,
  BookOpen,
  Users,
  Target,
  List,
  ClipboardList,
  BarChart3,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiClient } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseCase {
  title: string;
  actor: string;
  description: string;
  preconditions: string;
  steps: string[];
  postcondition: string;
}

interface UserStory {
  as_a: string;
  i_want: string;
  so_that: string;
  acceptance_criteria: string[];
  priority: "Must Have" | "Should Have" | "Nice to Have";
}

interface PRDData {
  product_name: string;
  version: string;
  created_at: string;
  executive_summary: string;
  problem_statement: string;
  goals: string[];
  target_users: { role: string; description: string }[];
  use_cases: UseCase[];
  user_stories: UserStory[];
  functional_requirements: { id: string; title: string; description: string }[];
  non_functional_requirements: { category: string; requirement: string }[];
  out_of_scope: string[];
  success_metrics: { metric: string; target: string }[];
  assumptions: string[];
  markdown: string;
}

// ── Section Blocks ─────────────────────────────────────────────────────────────

function SectionBlock({
  icon: Icon,
  number,
  title,
  color = "text-primary",
  children,
}: {
  icon: React.ElementType;
  number: string;
  title: string;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-stroke-muted bg-container overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stroke-muted">
        <span className="font-mono text-xs tabular-nums text-ink-quaternary">{number}</span>
        <h3 className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function UseCaseCard({ uc, index }: { uc: UseCase; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-stroke-muted bg-container">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
          UC-{String(index + 1).padStart(2, "0")}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{uc.title}</p>
          <p className="text-xs text-muted-foreground">Actor: {uc.actor}</p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-stroke-muted px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-muted-foreground">{uc.description}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Preconditions</p>
              <p className="text-xs text-ink">{uc.preconditions}</p>
            </div>
            <div>
              <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Postcondition</p>
              <p className="text-xs text-ink">{uc.postcondition}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">Main Flow</p>
            <ol className="space-y-1.5">
              {uc.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-ink">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-raised text-[10px] font-bold text-primary mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

const priorityColor: Record<string, string> = {
  "Must Have": "bg-raised text-destructive border-stroke-muted",
  "Should Have": "bg-raised text-warning border-stroke-muted",
  "Nice to Have": "bg-raised text-info border-stroke-muted",
};

function UserStoryCard({ story, index }: { story: UserStory; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-stroke-muted bg-container">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Badge variant="outline" className="text-[10px] font-mono shrink-0">
          US-{String(index + 1).padStart(2, "0")}
        </Badge>
        <p className="flex-1 min-w-0 text-sm text-left leading-snug">
          <span className="text-muted-foreground">As a </span>
          <span className="font-medium">{story.as_a}</span>
          <span className="text-muted-foreground">, I want to </span>
          <span className="font-medium">{story.i_want}</span>
        </p>
        <Badge
          variant="outline"
          className={`text-[10px] shrink-0 ${priorityColor[story.priority] ?? ""}`}
        >
          {story.priority}
        </Badge>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-stroke-muted px-4 pb-4 pt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-ink-secondary">So that:</span> {story.so_that}
          </p>
          <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
            Acceptance Criteria
          </p>
          <ul className="space-y-1">
            {story.acceptance_criteria.map((ac, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-ink">
                <CheckCircle2 className="h-3.5 w-3.5 text-positive mt-0.5 shrink-0" />
                {ac}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── PRD Viewer ────────────────────────────────────────────────────────────────

function PRDViewer({ prd }: { prd: PRDData }) {
  return (
    <div className="space-y-4">
      <SectionBlock icon={FileText} number="1" title="Executive Summary">
        <p className="text-sm text-ink leading-relaxed">{prd.executive_summary}</p>
      </SectionBlock>

      <SectionBlock icon={Target} number="2" title="Problem Statement" color="text-warning">
        <p className="text-sm text-ink leading-relaxed">{prd.problem_statement}</p>
      </SectionBlock>

      <SectionBlock icon={BarChart3} number="3" title="Goals & Objectives" color="text-positive">
        <ol className="space-y-2">
          {prd.goals.map((g, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-raised text-[10px] font-bold text-positive mt-0.5">
                {i + 1}
              </span>
              {g}
            </li>
          ))}
        </ol>
      </SectionBlock>

      <SectionBlock icon={Users} number="4" title="Target Users" color="text-info">
        <div className="space-y-3">
          {prd.target_users.map((u, i) => (
            <div key={i} className="flex items-start gap-3">
              <Badge variant="secondary" className="text-xs shrink-0 mt-0.5">
                {u.role}
              </Badge>
              <p className="text-sm text-ink">{u.description}</p>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={BookOpen} number="5" title="Use Cases" color="text-ink-secondary">
        <div className="space-y-2">
          {prd.use_cases.map((uc, i) => (
            <UseCaseCard key={i} uc={uc} index={i} />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={List} number="6" title="User Stories" color="text-ink-secondary">
        <div className="space-y-2">
          {prd.user_stories.map((s, i) => (
            <UserStoryCard key={i} story={s} index={i} />
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={ClipboardList} number="7" title="Functional Requirements" color="text-ink-secondary">
        <div className="space-y-2">
          {prd.functional_requirements.map((fr) => (
            <div key={fr.id} className="flex items-start gap-3 rounded-lg border border-stroke-muted px-4 py-3 bg-raised">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0 mt-0.5">
                {fr.id}
              </Badge>
              <div className="min-w-0">
                <p className="text-sm font-medium">{fr.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{fr.description}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={ClipboardList} number="8" title="Non-Functional Requirements" color="text-warning">
        <div className="space-y-2">
          {prd.non_functional_requirements.map((nfr, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-stroke-muted px-4 py-3 bg-raised">
              <Badge variant="outline" className="text-[10px] shrink-0 mt-0.5 border-stroke-muted text-warning">
                {nfr.category}
              </Badge>
              <p className="text-xs text-ink">{nfr.requirement}</p>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={XCircle} number="9" title="Out of Scope" color="text-destructive">
        <ul className="space-y-1.5">
          {prd.out_of_scope.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink">
              <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              {s}
            </li>
          ))}
        </ul>
      </SectionBlock>

      <SectionBlock icon={BarChart3} number="10" title="Success Metrics / KPIs" color="text-positive">
        <div className="space-y-2">
          {prd.success_metrics.map((m, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-stroke-muted px-4 py-2.5 bg-raised">
              <CheckCircle2 className="h-3.5 w-3.5 text-positive mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{m.metric}</span>
                <span className="text-muted-foreground mx-2 text-sm">—</span>
                <span className="text-sm text-ink">{m.target}</span>
              </div>
            </div>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock icon={FileText} number="11" title="Assumptions" color="text-muted-foreground">
        <ul className="space-y-1.5">
          {prd.assumptions.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink">
              <span className="text-primary mt-0.5">•</span>
              {a}
            </li>
          ))}
        </ul>
      </SectionBlock>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "input" | "view" | "edit";

export default function PRDGenerator() {
  const [productName, setProductName] = useState("");
  const [description, setDescription] = useState("");
  const [prd, setPrd] = useState<PRDData | null>(null);
  const [tab, setTab] = useState<Tab>("input");
  const [viewMode, setViewMode] = useState<"notepad" | "designed">("notepad");
  const [editMarkdown, setEditMarkdown] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!productName.trim() || !description.trim()) {
      toast.error("Please enter both a product name and description.");
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const resp = await apiClient.post<PRDData>("/prd/generate", {
        product_name: productName.trim(),
        description: description.trim(),
      });
      const result = resp.data;
      setPrd(result);
      setEditMarkdown(result.markdown);
      setTab("view");
      toast.success("PRD generated");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: unknown } }; message?: string };
      const detail = e?.response?.data?.detail;
      const message = typeof detail === "string" && detail ? detail : e?.message || "The request failed.";
      setGenerateError(message);
      toast.error(`PRD generation failed: ${message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    const content = tab === "edit" ? editMarkdown : prd?.markdown ?? "";
    const filename = `${(prd?.product_name ?? "prd").toLowerCase().replace(/\s+/g, "-")}-prd.md`;
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(`Downloaded ${filename}`);
  };

  const steps = [
    { id: "input" as Tab, label: "Input" },
    { id: "view" as Tab, label: "PRD" },
    { id: "edit" as Tab, label: "Edit" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-stroke-muted bg-container">
      <div className="px-4 pt-4">
        <PageHeader
          title="Product Specs"
          description="Enter a product name and description to generate a structured product requirements document, then review, edit and download it as Markdown."
          className="border-b-0 pb-3"
          actions={
            prd ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload}>
                <Download className="h-4 w-4" />
                Download .md
              </Button>
            ) : undefined
          }
        />
      </div>

      {/* Step bar */}
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-y border-stroke-muted px-4 py-1.5">
        {steps.map((step) => (
          <button
            key={step.id}
            type="button"
            aria-pressed={tab === step.id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              tab === step.id
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border text-ink-secondary hover:bg-raised"
            }`}
            onClick={() => {
              if (step.id === "input" || prd) setTab(step.id);
            }}
            disabled={step.id !== "input" && !prd}
          >
            {step.label}
          </button>
        ))}

        {tab === "edit" && prd && (
          <div className="ml-auto">
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (prd) setPrd({ ...prd, markdown: editMarkdown });
                setTab("view");
                toast.success("Changes applied to this document");
              }}
            >
              Save and view
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Input ── */}
        {tab === "input" && (
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-3xl p-4 space-y-4">
              <p className="text-sm text-ink-tertiary">
                The generated PRD contains use cases, user stories, functional requirements and success metrics.
              </p>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="prd-name" className="block text-xs font-medium text-ink-secondary">
                    Product name <span className="text-destructive" aria-hidden>*</span>
                  </label>
                  <Input
                    id="prd-name"
                    required
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="e.g. Secure Web Gallery, Finance Calculator, Task Manager"
                    className="text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="prd-description" className="block text-xs font-medium text-ink-secondary">
                    Product description <span className="text-destructive" aria-hidden>*</span>
                  </label>
                  <Textarea
                    id="prd-description"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what the product does, the problem it solves, who it's for, and any key features or constraints. The more detail you provide, the more tailored the PRD will be."
                    className="min-h-[180px] text-sm resize-none"
                  />
                  <p className="text-xs text-ink-tertiary">
                    Mention the target audience, core workflows, and any compliance or technical requirements. More detail produces a more specific PRD.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    setProductName("Finance Calculator");
                    setDescription(
                      "A web application that helps individuals and business professionals perform accurate financial calculations including loan EMI, compound interest, tax estimation, and currency conversion. Users should be able to save and compare calculation results, export reports as PDF, and share results via link. The app must be mobile-first and work offline for basic calculations."
                    );
                  }}
                >
                  Fill with an example
                </Button>

                <Button
                  onClick={handleGenerate}
                  disabled={generating || !productName.trim() || !description.trim()}
                  className="gap-2"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating PRD…
                    </>
                  ) : (
                    "Generate PRD"
                  )}
                </Button>
              </div>

              {generateError && !generating && (
                <p role="alert" className="text-sm text-destructive">PRD generation failed: {generateError}</p>
              )}

              {generating && (
                <p className="text-sm text-ink-tertiary">
                  Building use cases, user stories, functional requirements and success metrics. This can take a minute.
                </p>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ── PRD View ── */}
        {tab === "view" && prd && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex h-11 items-center gap-2 border-b border-stroke-muted px-4">
                <span className="min-w-0 truncate font-mono text-xs text-ink-tertiary">
                  {prd.product_name.toLowerCase().replace(/\s+/g, "-")}-prd.md
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {(["notepad", "designed"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={viewMode === m}
                      onClick={() => setViewMode(m)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        viewMode === m
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-border text-ink-secondary hover:bg-raised"
                      }`}
                    >
                      {m === "notepad" ? "Document" : "Sections"}
                    </button>
                  ))}
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setTab("edit")}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                </div>
              </div>

              {viewMode === "notepad" ? (
                <ScrollArea className="flex-1">
                  <div className="mx-auto max-w-3xl px-8 py-8">
                    <article className="prose prose-sm max-w-none
                      prose-headings:font-semibold prose-headings:text-ink prose-headings:scroll-mt-20
                      prose-h1:text-xl prose-h1:font-bold prose-h1:border-b prose-h1:border-border prose-h1:pb-3 prose-h1:mb-6
                      prose-h2:text-base prose-h2:mt-8 prose-h2:mb-3
                      prose-h3:text-sm prose-h3:mt-5 prose-h3:mb-2
                      prose-p:text-ink prose-p:leading-relaxed prose-p:my-2
                      prose-li:text-ink prose-li:my-0.5
                      prose-strong:text-ink prose-strong:font-semibold
                      prose-blockquote:border-stroke prose-blockquote:text-muted-foreground prose-blockquote:not-italic
                      prose-code:text-primary prose-code:bg-raised prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
                      prose-table:text-xs prose-table:w-full
                      prose-thead:border-border prose-th:border prose-th:border-border prose-th:bg-raised prose-th:px-3 prose-th:py-2 prose-th:font-semibold prose-th:text-ink
                      prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-ink
                      prose-tr:border-border even:prose-tr:bg-raised
                      prose-hr:border-border prose-hr:my-6
                      prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {prd.markdown}
                      </ReactMarkdown>
                    </article>
                  </div>
                </ScrollArea>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="mx-auto max-w-3xl px-6 py-6 space-y-4">
                    {/* Title card */}
                    <div className="rounded-lg border border-stroke-muted bg-container px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="mb-1 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary">
                            Product requirements document
                          </p>
                          <h2 className="text-lg font-semibold text-ink">{prd.product_name}</h2>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="font-mono text-xs text-ink-tertiary">v{prd.version}</span>
                            <span className="text-xs text-ink-tertiary">
                              {new Date(prd.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <PRDViewer prd={prd} />
                  </div>
                </ScrollArea>
              )}
            </div>
        )}

        {/* ── Edit ── */}
        {tab === "edit" && prd && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex h-11 items-center gap-2 border-b border-stroke-muted px-4">
              <span className="min-w-0 truncate font-mono text-xs text-ink-tertiary">
                {prd.product_name.toLowerCase().replace(/\s+/g, "-")}-prd.md
              </span>
              <span className="ml-auto text-xs text-ink-tertiary">Markdown</span>
            </div>
            <Textarea
              value={editMarkdown}
              onChange={(e) => setEditMarkdown(e.target.value)}
              className="flex-1 rounded-none border-0 resize-none font-mono text-xs bg-raised focus-visible:ring-0 focus-visible:ring-offset-0 p-4 leading-relaxed"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
}
