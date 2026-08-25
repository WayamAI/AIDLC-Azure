import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  GitPullRequest, Search, Shield, AlertTriangle, CheckCircle, XCircle,
  ChevronDown, ChevronRight, Code2, Loader2, Info, BookOpen, FileUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { toast } from "sonner";
import { useActiveRepo } from "@/context/RepoContext";

const SEVERITY_CONFIG: Record<string, { textColor: string; bg: string; border: string; icon: React.ElementType; label: string }> = {
  critical: { textColor: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", icon: XCircle, label: "Critical" },
  high: { textColor: "text-[var(--color-warning)]", bg: "bg-[var(--color-warning-bg)]", border: "border-[var(--color-status-warning)]/30", icon: AlertTriangle, label: "High" },
  medium: { textColor: "text-warning", bg: "bg-warning/10", border: "border-warning/30", icon: Info, label: "Medium" },
  low: { textColor: "text-info", bg: "bg-info/10", border: "border-info/30", icon: Info, label: "Low" },
};

const RECOMMENDATION_CONFIG: Record<string, { label: string; description: string; color: string }> = {
  APPROVE: { label: "Approved", description: "No blocking issues. Code is ready to merge.", color: "text-positive border-positive/25" },
  REQUEST_CHANGES: { label: "Changes Requested", description: "Issues found that must be resolved before merging.", color: "text-destructive border-destructive/30" },
  NEEDS_DISCUSSION: { label: "Needs Discussion", description: "Review found concerns requiring engineering discussion.", color: "text-[var(--color-warning)] border-[var(--color-status-warning)]/30" },
  COMMENT: { label: "Commented", description: "Suggestions provided not blocking, but worth reviewing.", color: "text-warning border-warning/30" },
  CONDITIONAL: { label: "Conditional", description: "Can merge after addressing the listed conditions.", color: "text-warning border-warning/30" },
};

const CATEGORY_COLORS: Record<string, string> = {
  security: "text-red-700",
  bug: "text-[var(--color-warning)]",
  performance: "text-amber-700",
  style: "text-sky-700",
  "test-coverage": "text-purple-400",
  maintainability: "text-positive",
};

function normalizeSummary(reviewPayload: any) {
  const summary = reviewPayload?.summary;
  if (summary && typeof summary === "object") return summary;
  return {
    overall_risk: "medium",
    what_changed: typeof summary === "string" ? summary : "Review completed.",
    test_coverage_estimate: reviewPayload?.coverage_estimate ?? "Not available",
    review_recommendation: reviewPayload?.recommendation ?? "CONDITIONAL",
  };
}

function normalizeFindingRange(finding: any): string {
  const start = Number(finding?.start_line ?? finding?.line);
  const end = Number(finding?.end_line ?? finding?.line ?? start);
  if (!Number.isFinite(start) || start <= 0) return "line ?";
  if (!Number.isFinite(end) || end <= 0 || end === start) return `line ${start}`;
  return `lines ${start}-${end}`;
}

function isActionableFinding(finding: any): boolean {
  const message = String(finding?.message || "").trim().toLowerCase();
  if (!message) return false;
  return !["lgtm", "lgtm!", "looks good", "looks good to me", "no changes needed."].includes(message);
}

function RepoInput({
  onSearch,
  defaultUrl = "",
}: {
  onSearch: (owner: string, repo: string) => void;
  defaultUrl?: string;
}) {
  const [input, setInput] = useState(defaultUrl);

  const handleSearch = () => {
    const parts = input.trim().replace("https://github.com/", "").split("/");
    if (parts.length >= 2) {
      onSearch(parts[0], parts[1]);
    }
  };

  return (
    <div className="floating-card p-6">
      <div className="flex items-center gap-2 mb-4">
        <Code2 className="h-4 w-4 text-primary" />
        <span className="font-display text-[13px] font-semibold tracking-tight">Connect GitHub Repository</span>
      </div>
      <div className="flex gap-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="flex-1 bg-muted/30 border-border/50"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={!input.trim()} className="bg-primary text-primary-foreground">
          <Search className="h-4 w-4 mr-2" />
          Load PRs
        </Button>
      </div>
    </div>
  );
}

function PRCard({ pr, owner, repo, customRules }: { pr: any; owner: string; repo: string; customRules?: string }) {
  const [expanded, setExpanded] = useState(false);
  const reviewMutation = useMutation({
    mutationFn: () => api.reviewPR(owner, repo, pr.number, customRules),
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        || (err as { message?: string })?.message
        || "AI review failed";
      toast.error(String(detail));
    },
  });

  const review = reviewMutation.data as any;
  const reviewPayload = review?.review ?? {};
  const summary = normalizeSummary(reviewPayload);
  const recommendation = summary?.review_recommendation ?? reviewPayload?.recommendation ?? "CONDITIONAL";
  const actionableFindings = useMemo(() => {
    const findings = Array.isArray(reviewPayload?.findings) ? reviewPayload.findings : [];
    return findings.filter(isActionableFinding);
  }, [reviewPayload]);

  const findingsByFile = useMemo(() => {
    const findings = actionableFindings;
    return findings.reduce((acc: Record<string, any[]>, finding: any) => {
      const fileName = finding?.file || "unmapped";
      if (!acc[fileName]) acc[fileName] = [];
      acc[fileName].push(finding);
      return acc;
    }, {});
  }, [actionableFindings]);

  return (
    <div className="floating-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <GitPullRequest className="h-4 w-4 text-primary shrink-0" />
            <span className="font-medium text-sm truncate">{pr.title}</span>
            <span className="text-xs text-muted-foreground shrink-0">#{pr.number}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>@{pr.author}</span>
            <span>{pr.base} ← {pr.head}</span>
            {pr.changed_files > 0 && <span>{pr.changed_files} files</span>}
            {(pr.additions > 0 || pr.deletions > 0) && (
              <>
                <span className="text-positive">+{pr.additions}</span>
                <span className="text-destructive">-{pr.deletions}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {review && (() => {
            const recCfg = RECOMMENDATION_CONFIG[recommendation] ?? RECOMMENDATION_CONFIG.COMMENT;
            return (
              <div className="text-right">
                <Badge className={`text-xs border ${recCfg.color}`}>{recCfg.label}</Badge>
                <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[160px]">{recCfg.description}</p>
              </div>
            );
          })()}
          {!review && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                reviewMutation.mutate();
                setExpanded(true);
              }}
              disabled={reviewMutation.isPending}
              className="text-xs"
            >
              {reviewMutation.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Reviewing...</> : "AI Review"}
            </Button>
          )}
          {reviewMutation.isError && !review && (
            <span className="text-[10px] text-destructive max-w-[160px]">
              {(reviewMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
                || "Review failed"}
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && review && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
              <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                <p className="text-sm font-medium mb-1">{summary?.what_changed}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
                  <span>Coverage: {summary?.test_coverage_estimate}</span>
                  <span>Risk: {(summary?.overall_risk || "medium").toUpperCase()}</span>
                  {(() => {
                    const recCfg = RECOMMENDATION_CONFIG[recommendation] ?? RECOMMENDATION_CONFIG.COMMENT;
                    return (
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-xs ${recCfg.color}`}>{recCfg.label}</Badge>
                        <span className="text-[10px] text-muted-foreground italic">{recCfg.description}</span>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {Object.keys(findingsByFile).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {actionableFindings.length} Findings
                  </p>
                  <div className="space-y-3">
                    {(Object.entries(findingsByFile) as Array<[string, any[]]>).map(([fileName, groupedFindings]) => (
                      <div key={fileName} className="rounded-lg border border-border/40 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <code className="text-[11px] bg-muted/40 px-2 py-1 rounded text-foreground/80">{fileName}</code>
                          <span className="text-[10px] text-muted-foreground">{groupedFindings.length} issue(s)</span>
                        </div>
                        <div className="space-y-2">
                          {groupedFindings.map((f: any, i: number) => {
                            const cfg = SEVERITY_CONFIG[f.severity?.toLowerCase()] || SEVERITY_CONFIG.low;
                            const Icon = cfg.icon;
                            return (
                              <div key={`${fileName}-${i}`} className={`p-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                                <div className="flex items-start gap-2">
                                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.textColor}`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                      <span className={`text-[10px] font-bold uppercase tracking-wide ${cfg.textColor}`}>{cfg.label}</span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-foreground/70">
                                        {normalizeFindingRange(f)}
                                      </span>
                                      {f.category && (
                                        <span className={`text-[10px] font-medium ${CATEGORY_COLORS[f.category] || "text-muted-foreground"}`}>{f.category}</span>
                                      )}
                                    </div>
                                    <p className="text-xs text-foreground/90">{f.message}</p>
                                    {f.suggestion && (
                                      <p className="mt-1 text-[11px] text-muted-foreground italic">{f.suggestion}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(findingsByFile).length === 0 && (
                <div className="p-3 rounded-lg bg-positive/10 border border-primary/30/20 text-xs text-muted-foreground">
                  No material issues found in reviewed hunks.
                </div>
              )}

              {reviewPayload?.security_flags?.length > 0 && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-destructive" />
                    <span className="text-xs font-medium text-destructive">Security Flags</span>
                  </div>
                  <ul className="space-y-1">
                    {reviewPayload.security_flags.map((f: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground">• {f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(reviewPayload?.positive_observations?.length > 0 || reviewPayload?.positives?.length > 0) && (
                <div className="p-3 rounded-lg bg-positive/10 border border-primary/30/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-positive" />
                    <span className="text-xs font-medium text-positive">Positive Observations</span>
                  </div>
                  <ul className="space-y-1">
                    {(reviewPayload.positive_observations || reviewPayload.positives || []).map((o: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground">• {o}</li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewPayload?.meta && (
                <div className="text-[10px] text-muted-foreground border-t border-border/30 pt-2">
                  Engine: {reviewPayload.meta.engine_version || "v1"} • Files reviewed: {reviewPayload.meta.files_reviewed ?? "-"}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CodeReview() {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [repoCoords, setRepoCoords] = useState<{ owner: string; repo: string } | null>(
    activeRepo ? { owner: activeRepo.owner, repo: activeRepo.repo } : null,
  );
  const [customRules, setCustomRules] = useState<string>("");
  const [isRulesExpanded, setIsRulesExpanded] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCustomRules(ev.target?.result as string);
      setIsRulesExpanded(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const prsQuery = useQuery({
    queryKey: ["github-prs", repoCoords?.owner, repoCoords?.repo],
    queryFn: () => api.getRepoPRs(repoCoords!.owner, repoCoords!.repo),
    enabled: !!(repoCoords?.owner && repoCoords?.repo),
  });

  const prs = prsQuery.data || [];

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <PageHeader
          icon={GitPullRequest}
          title="AI Code Review"
          description="Connect a GitHub repository, fetch open PRs, and run AI-powered inline code review."
        />

        <RepoInput
          defaultUrl={activeRepo?.repoUrl ?? ""}
          onSearch={(owner, repo) => {
            setRepoCoords({ owner, repo });
            setActiveRepo({ owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, branch: activeRepo?.branch || "main" });
          }}
        />

        {repoCoords && (
          <div className="mt-4 mb-4 text-xs text-muted-foreground flex items-center gap-2">
            <Code2 className="h-3.5 w-3.5" />
            <span>
              Viewing <strong className="text-foreground">{repoCoords.owner}/{repoCoords.repo}</strong>
            </span>
          </div>
        )}

        {repoCoords && (
          <div className="mb-6 rounded-xl border border-border/50 bg-card/50 overflow-hidden shadow-sm">
            <div 
              className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setIsRulesExpanded(!isRulesExpanded)}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${customRules ? 'bg-indigo-500/10 text-indigo-500' : 'bg-muted text-muted-foreground'}`}>
                  <BookOpen className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Custom Ground Rules</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Enforce team-specific architectural or formatting constraints.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {customRules && <Badge variant="secondary" className="text-[10px] bg-indigo-500/10 text-indigo-500 border-indigo-500/20">Rules Active</Badge>}
                <Button size="sm" variant="ghost" className="h-8 shadow-none" onClick={(e) => { e.stopPropagation(); setIsRulesExpanded(!isRulesExpanded); }}>
                  {isRulesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            
            <AnimatePresence>
              {isRulesExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-4 pt-0 border-t border-border/30 bg-muted/10">
                    <div className="my-3 flex items-center justify-between">
                      <label className="relative cursor-pointer group">
                        <input type="file" accept=".md,.txt" className="hidden" onChange={handleFileUpload} />
                        <div className="flex items-center gap-2 text-xs font-medium text-positive bg-positive/100/10 group-hover:bg-positive/100/20 px-3 py-1.5 rounded-md transition-colors border border-primary/30/20">
                          <FileUp className="h-3.5 w-3.5" />
                          Upload `.md` Rules
                        </div>
                      </label>
                      {customRules && (
                        <Button variant="ghost" size="sm" onClick={() => setCustomRules("")} className="h-7 text-xs text-muted-foreground hover:text-red-500">
                          Clear Rules
                        </Button>
                      )}
                    </div>
                    <textarea 
                      value={customRules}
                      onChange={(e) => setCustomRules(e.target.value)}
                      placeholder="Or directly paste your team's PR guidelines, formatting laws, or architectural constraints here. The AI will strictly critique against these."
                      className="w-full h-36 px-4 py-3 text-[13px] font-mono border rounded-lg bg-background resize-none focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500/40 outline-none leading-relaxed placeholder:text-muted-foreground/60 shadow-inner"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {prsQuery.isLoading && (
          <div className="mt-6 flex items-center justify-center gap-3 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Fetching pull requests…</span>
          </div>
        )}

        {prsQuery.isError && (
          <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            {(prsQuery.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
              || "Failed to fetch PRs. Check the repo name and GitHub token in Settings → Connectors."}
          </div>
        )}

        {prs.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{prs.length} Open Pull Requests</p>
              <span className="text-xs text-muted-foreground">Click "AI Review" on any PR to analyse the diff</span>
            </div>
            {prs.map((pr: any) => (
              <PRCard key={pr.number} pr={pr} owner={repoCoords!.owner} repo={repoCoords!.repo} customRules={customRules} />
            ))}
          </motion.div>
        )}

        {!prsQuery.isLoading && prs.length === 0 && repoCoords && !prsQuery.isError && (
          <div className="mt-6 text-center py-12 text-muted-foreground text-sm">
            No open pull requests found for {repoCoords.owner}/{repoCoords.repo}.
          </div>
        )}
      </motion.div>
    </PageShell>
  );
}
