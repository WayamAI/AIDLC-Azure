import { GITHUB_STALE_MS } from "@/lib/query-times";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle, XCircle,
  ChevronDown, ChevronRight, Loader2, Info, ArrowRight, RotateCcw, FileUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { usePipelineContext, type ReviewCoverage } from "@/context/PipelineContext";
import { api } from "@/lib/api";
import type { CommitInfo, PipelineReview } from "@/lib/api";
import { toast } from "sonner";

const SEVERITY_CONFIG: Record<string, { textColor: string; bg: string; border: string; icon: React.ElementType; label: string }> = {
  critical: { textColor: "text-destructive", bg: "bg-raised", border: "border-stroke-muted", icon: XCircle, label: "Critical" },
  high:     { textColor: "text-warning", bg: "bg-raised", border: "border-stroke-muted", icon: AlertTriangle, label: "High" },
  medium:   { textColor: "text-warning", bg: "bg-raised", border: "border-stroke-muted", icon: Info, label: "Medium" },
  low:      { textColor: "text-info", bg: "bg-raised", border: "border-stroke-muted", icon: Info, label: "Low" },
};

const RECOMMENDATION_CONFIG: Record<string, { label: string; description: string; tone: StatusTone }> = {
  "APPROVE":          { label: "Approved",           description: "No blocking issues. Code is ready to merge.",              tone: "success" },
  "REQUEST_CHANGES":  { label: "Changes requested",  description: "Issues found that must be resolved before merging.",       tone: "critical" },
  "COMMENT":          { label: "Commented",          description: "Suggestions provided, not blocking, but worth reviewing.", tone: "info" },
  "CONDITIONAL":      { label: "Conditional",        description: "Can merge after addressing the listed conditions.",        tone: "warning" },
  "NEEDS_DISCUSSION": { label: "Needs discussion",   description: "Review found concerns requiring engineering discussion.", tone: "warning" },
  "INCOMPLETE":       { label: "Incomplete",         description: "Some files could not be reviewed. This is not an approval.", tone: "critical" },
};
// A verdict this page has no label for is shown as it was returned, never as "Commented".
const unknownRecommendation = (key: string) => ({
  label: key.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
  description: "The review returned a verdict this page has no description for.",
  tone: "neutral" as StatusTone,
});

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";

type ReviewResponse = { sha: string; review: PipelineReview; files_reviewed: number };

// The endpoint reports how much of the change was actually read. Older
// backends send only files_reviewed, which is treated as a complete review.
function readCoverage(data: unknown): ReviewCoverage {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const reviewed = num(d.files_reviewed);
  const status = d.review_status === "partial" || d.review_status === "incomplete" ? d.review_status : "complete";
  return {
    status,
    filesInPr: typeof d.files_in_pr === "number" ? d.files_in_pr : reviewed,
    reviewed,
    failed: num(d.files_failed),
    truncated: num(d.files_truncated),
  };
}

function coverageDetail(c: ReviewCoverage): string {
  const parts: string[] = [];
  if (c.failed > 0) parts.push(`${c.failed} could not be reviewed`);
  if (c.truncated > 0) parts.push(`${c.truncated} truncated`);
  return parts.join(", ");
}

function CommitCard({
  commit,
  owner,
  repo,
  githubPat,
  customRules,
  savedReview,
  onReviewDone,
}: {
  commit: CommitInfo;
  owner: string;
  repo: string;
  githubPat?: string;
  customRules?: string;
  /** Review of this commit kept in the pipeline state from an earlier visit. */
  savedReview?: PipelineReview;
  onReviewDone: (result: ReviewResponse) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const reviewMutation = useMutation({
    mutationFn: () => api.reviewCommit(owner, repo, commit.sha, githubPat, customRules),
    onSuccess: (data) => {
      onReviewDone(data);
      setExpanded(true);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || "Review failed";
      toast.error(String(detail));
    },
  });

  const review = (reviewMutation.data?.review as PipelineReview | undefined) ?? savedReview;

  const rawSummary = review?.summary;
  // AI sometimes returns summary as an object {overall_risk, what_changed, ...}
  const summaryObj = rawSummary && typeof rawSummary === "object" ? rawSummary as Record<string, string> : null;
  const summaryText = summaryObj ? summaryObj.what_changed ?? JSON.stringify(rawSummary) : (typeof rawSummary === "string" ? rawSummary : "");
  // recommendation can be top-level OR inside summary object
  const recKey = (review?.recommendation ?? summaryObj?.review_recommendation ?? "COMMENT") as string;
  const recCfg = RECOMMENDATION_CONFIG[recKey.toUpperCase()] ?? unknownRecommendation(recKey);

  return (
    <div className="rounded-lg border border-stroke-muted bg-container p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-xs bg-raised px-1.5 py-0.5 rounded font-mono text-ink-secondary shrink-0">
              {commit.short_sha}
            </code>
            <span className="font-medium text-sm text-ink truncate">{commit.message}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-tertiary">
            <span>@{commit.author}</span>
            <span>{commit.relative_date}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {review && (
            <StatusBadge tone={recCfg.tone} title={recCfg.description}>{recCfg.label}</StatusBadge>
          )}
          {!review && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => reviewMutation.mutate()}
              disabled={reviewMutation.isPending}
              className="text-xs"
            >
              {reviewMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Reviewing…</>
              ) : "Review"}
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <>
        {expanded && review && (
          <div
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-stroke-muted space-y-4">
              {/* Summary */}
              <div className="p-3 rounded-lg bg-raised border border-stroke-muted">
                {summaryObj ? (
                  <div className="space-y-1.5">
                    {summaryObj.overall_risk && (
                      <p className="text-xs"><span className="font-medium text-muted-foreground">Risk:</span> <span className="capitalize">{summaryObj.overall_risk}</span></p>
                    )}
                    {summaryObj.what_changed && (
                      <p className="text-sm font-medium">{summaryObj.what_changed}</p>
                    )}
                    {summaryObj.test_coverage_estimate && (
                      <p className="text-xs text-muted-foreground">{summaryObj.test_coverage_estimate}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-medium mb-1">{summaryText}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
                  {review.coverage_estimate != null && (
                    <span>Coverage: ~{review.coverage_estimate}%</span>
                  )}
                  <span>{recCfg.description}</span>
                </div>
              </div>

              {/* Findings */}
              {review.findings?.length > 0 && (
                <div>
                  <p className={`${eyebrow} mb-2`}>
                    {review.findings.length} finding{review.findings.length !== 1 ? "s" : ""}
                  </p>
                  <div className="space-y-2">
                    {review.findings.map((f, i) => {
                      const cfg = SEVERITY_CONFIG[f.severity?.toLowerCase()] || SEVERITY_CONFIG.low;
                      const Icon = cfg.icon;
                      return (
                        <div key={i} className={`p-3 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                          <div className="flex items-start gap-2">
                            <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.textColor}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className={`text-[11px] font-medium uppercase tracking-[0.08em] ${cfg.textColor}`}>{cfg.label}</span>
                                {f.file && (
                                  <code className="font-mono text-[11px] text-ink-secondary">
                                    {f.file}{f.line ? `:${f.line}` : ""}
                                  </code>
                                )}
                                {f.category && (
                                  <span className="text-[11px] text-ink-tertiary">{f.category}</span>
                                )}
                              </div>
                              <p className="text-xs text-ink">{f.message}</p>
                              {f.suggestion && (
                                <p className="mt-1 text-xs text-ink-tertiary">{f.suggestion}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Security flags */}
              {review.security_flags?.length > 0 && (
                <div className="p-3 rounded-lg bg-raised border border-stroke-muted">
                  <p className={`${eyebrow} mb-2`}>Security flags</p>
                  <ul className="space-y-1">
                    {review.security_flags.map((f, i) => (
                      <li key={i} className="text-xs text-destructive">{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Positive observations */}
              {((review.positives ?? (review as any).positive_observations) as string[] | undefined)?.length > 0 && (
                <div className="p-3 rounded-lg bg-raised border border-stroke-muted">
                  <p className={`${eyebrow} mb-2`}>Positive observations</p>
                  <ul className="space-y-1">
                    {((review.positives ?? (review as any).positive_observations) as string[]).map((o, i) => (
                      <li key={i} className="text-xs text-ink-secondary">{o}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    </div>
  );
}

export function StageCodeReview() {
  const {
    owner, repo, repoUrl, githubPat,
    reviewResult, setReviewResult, setReviewStatus,
    reviewCoverage: coverage, setReviewCoverage: setCoverage,
    completeStage, goToStage,
  } = usePipelineContext();

  const githubUrl = repoUrl || (owner && repo ? `https://github.com/${owner}/${repo}` : "");

  const commitsQuery = useQuery({
    queryKey: ["pipeline-commits", githubUrl, githubPat ? "with-pat" : "no-pat"],
    queryFn: () => api.getRepoCommits(githubUrl, githubPat || undefined),
    enabled: !!githubUrl,
    staleTime: GITHUB_STALE_MS,
  });

  const commits: CommitInfo[] = (commitsQuery.data?.commits as CommitInfo[]) ?? [];

  const [customRules, setCustomRules] = useState<string>("");
  const [isRulesExpanded, setIsRulesExpanded] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCustomRules(ev.target?.result as string);
      setIsRulesExpanded(true);
      toast.success(`Loaded rules from ${file.name}`);
    };
    reader.onerror = () => toast.error(`Could not read ${file.name}`);
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleReviewDone = (data: ReviewResponse) => {
    const next = readCoverage(data);
    setCoverage(next);
    if (next.status === "incomplete") {
      // Nothing usable came back: do not record a result, so the stage is not
      // shown or reported as reviewed.
      setReviewResult(null);
      setReviewStatus("error");
      return;
    }
    setReviewResult({
      sha: data.sha,
      review: data.review,
      files_reviewed: data.files_reviewed ?? 0,
    });
    setReviewStatus("done");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex h-11 items-center justify-between border-b border-stroke-muted px-4 flex-shrink-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className={eyebrow}>Code review</span>
          {owner && repo && (
            <code className="truncate font-mono text-xs text-ink-secondary">{owner}/{repo}</code>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => goToStage(1)}>Back</Button>
          {reviewResult ? (
            <Button size="sm" className="h-8 text-xs" onClick={() => completeStage(2)}>
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => completeStage(2)}>
              Skip review <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          {/* No repo connected */}
          {!githubUrl && (
            <div className="rounded-lg border border-stroke-muted bg-container p-8 text-center">
              <p className="text-sm text-ink-tertiary">No repository connected. Go back to the Workspace stage and connect one first.</p>
            </div>
          )}

          {/* Loading commits */}
          {commitsQuery.isLoading && (
            <div className="flex items-center justify-center gap-3 py-16">
              <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
              <span className="text-sm text-ink-tertiary">Fetching commits for {owner}/{repo}…</span>
            </div>
          )}

          {/* Error */}
          {commitsQuery.isError && (
            <div className="p-4 rounded-lg bg-raised border border-stroke-muted text-sm text-destructive flex items-center justify-between">
              <span>Failed to fetch commits. Check the GitHub token has access to {owner}/{repo}.</span>
              <Button variant="ghost" size="sm" onClick={() => commitsQuery.refetch()}>
                <RotateCcw className="h-4 w-4 mr-1" /> Retry
              </Button>
            </div>
          )}

          {/* Custom Rules Upload Section */}
          {githubUrl && (
            <div className="rounded-lg border border-stroke-muted bg-container overflow-hidden">
              <div 
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-raised transition-colors"
                onClick={() => setIsRulesExpanded(!isRulesExpanded)}
              >
                <div>
                  <h3 className={eyebrow}>Custom review rules</h3>
                  <p className="text-xs text-ink-tertiary mt-1">Team-specific architectural or formatting constraints the review is checked against.</p>
                </div>
                <div className="flex items-center gap-3">
                  {customRules && <StatusBadge tone="info">Rules active</StatusBadge>}
                  <Button size="sm" variant="ghost" className="h-8" onClick={(e) => { e.stopPropagation(); setIsRulesExpanded(!isRulesExpanded); }}>
                    {isRulesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              
              <>
                {isRulesExpanded && (
                  <div
                    className="overflow-hidden"
                  >
                    <div className="p-4 pt-0 border-t border-stroke-muted bg-raised">
                      <div className="my-3 flex items-center justify-between">
                        <label className="relative cursor-pointer group">
                          <input type="file" accept=".md,.txt" className="hidden" onChange={handleFileUpload} />
                          <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary bg-container group-hover:bg-raised-2 px-3 py-1.5 rounded-md transition-colors border border-border">
                            <FileUp className="h-4 w-4" />
                            Upload a .md or .txt rules file
                          </div>
                        </label>
                        {customRules && (
                          <Button variant="ghost" size="sm" onClick={() => setCustomRules("")} className="h-7 text-xs text-muted-foreground hover:text-destructive">
                            Clear rules
                          </Button>
                        )}
                      </div>
                      <textarea 
                        value={customRules}
                        onChange={(e) => setCustomRules(e.target.value)}
                        placeholder="Or paste your team's PR guidelines, formatting rules, or architectural constraints here. The review checks the diff against them."
                        className="w-full h-36 px-4 py-3 font-mono text-xs border border-input rounded-lg bg-container text-ink resize-none focus:ring-1 focus:ring-ring outline-none leading-relaxed placeholder:text-ink-quaternary"
                      />
                    </div>
                  </div>
                )}
              </>
            </div>
          )}

          {/* Commit list */}
          {commits.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className={eyebrow}>{commits.length} commit{commits.length !== 1 ? "s" : ""}</p>
                <span className="text-xs text-ink-tertiary">Select Review on a commit to analyse its diff</span>
              </div>
              {commits.map((commit) => (
                <CommitCard
                  key={commit.sha}
                  commit={commit}
                  owner={owner}
                  repo={repo}
                  githubPat={githubPat || undefined}
                  customRules={customRules}
                  savedReview={reviewResult?.sha === commit.sha ? reviewResult.review : undefined}
                  onReviewDone={handleReviewDone}
                />
              ))}
            </div>
          )}

          {/* No commits */}
          {!commitsQuery.isLoading && !commitsQuery.isError && commits.length === 0 && githubUrl && (
            <div className="text-center py-16 text-ink-tertiary text-sm space-y-3">
              <p>No commits found for <strong className="text-ink">{owner}/{repo}</strong>.</p>
              <Button variant="outline" size="sm" onClick={() => completeStage(2)}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Review outcome: how much of the change was actually read */}
          {coverage && coverage.status === "incomplete" && (
            <div className="rounded-lg border border-stroke-muted bg-container p-4 flex flex-wrap items-center gap-3">
              <StatusBadge tone="critical">Review incomplete</StatusBadge>
              <p className="min-w-0 flex-1 text-sm text-ink-secondary">
                Reviewed <span className="tabular-nums">{coverage.reviewed} of {coverage.filesInPr}</span> files
                {coverageDetail(coverage) && <> ({coverageDetail(coverage)})</>}. This stage is not marked as reviewed; run the review again or skip it.
              </p>
            </div>
          )}
          {reviewResult && (!coverage || coverage.status !== "incomplete") && (
            <div className="rounded-lg border border-stroke-muted bg-container p-4 flex flex-wrap items-center gap-3">
              {coverage?.status === "partial" ? (
                <StatusBadge tone="warning">Partial review</StatusBadge>
              ) : (
                <StatusBadge tone="success">Review complete</StatusBadge>
              )}
              <p className="min-w-0 flex-1 text-sm text-ink-secondary">
                {coverage ? (
                  <>
                    Reviewed <span className="tabular-nums">{coverage.reviewed} of {coverage.filesInPr}</span> files
                    {coverageDetail(coverage) && <> ({coverageDetail(coverage)})</>}
                    {coverage.status === "partial" && ". Findings cover only the files that were read"}.
                  </>
                ) : (
                  <>Reviewed <span className="tabular-nums">{reviewResult.files_reviewed}</span> files.</>
                )}
              </p>
              <Button size="sm" onClick={() => completeStage(2)}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
