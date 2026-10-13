import { ErrorText } from "@/components/ErrorText";
import { EmptyState } from "@/components/EmptyState";
import { RepoInput } from "@/components/RepoInput";
import { GITHUB_STALE_MS } from "@/lib/query-times";
import { useState } from "react";
import { FileIcon } from "@/components/FileIcon";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileUp, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/imcc/DataTable";
import { KpiStat, Panel } from "@/components/imcc/Panel";
import { StatusBadge, type StatusTone } from "@/components/imcc/StatusBadge";
import { useActiveRepo } from "@/context/RepoContext";
import { cn } from "@/lib/utils";

const SEVERITY: Record<string, { label: string; tone: StatusTone }> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "warning" },
  medium: { label: "Medium", tone: "info" },
  low: { label: "Low", tone: "neutral" },
};

const RECOMMENDATION_CONFIG: Record<string, { label: string; description: string; tone: StatusTone }> = {
  APPROVE: { label: "Approved", description: "No blocking issues. Code is ready to merge.", tone: "success" },
  REQUEST_CHANGES: { label: "Changes requested", description: "Issues found that must be resolved before merging.", tone: "critical" },
  NEEDS_DISCUSSION: { label: "Needs discussion", description: "Review found concerns requiring engineering discussion.", tone: "warning" },
  COMMENT: { label: "Commented", description: "Suggestions provided. Not blocking, but worth reviewing.", tone: "info" },
  CONDITIONAL: { label: "Conditional", description: "Can merge after addressing the listed conditions.", tone: "warning" },
  INCOMPLETE: { label: "Incomplete", description: "Some files could not be reviewed. This is not an approval.", tone: "critical" },
};

const COVERAGE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  complete: { label: "All files reviewed", tone: "success" },
  partial: { label: "Partial coverage", tone: "warning" },
  incomplete: { label: "Review incomplete", tone: "critical" },
};

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

interface ReviewCoverage {
  status: string;
  filesInPr: number;
  reviewed: number;
  failed: number;
  skipped: number;
  truncated: number;
  failedFiles: { file: string; error: string }[];
  skippedFiles: { file: string; reason: string }[];
  truncatedFiles: string[];
}

// Counts come from the endpoint; null when the response carries none.
function readCoverage(review: any): ReviewCoverage | null {
  if (typeof review?.files_in_pr !== "number") return null;
  const meta = review?.review?.meta ?? {};
  const reviewed = review.files_reviewed ?? 0;
  const failed = review.files_failed ?? 0;
  const skipped = review.files_skipped ?? 0;
  const truncated = review.files_truncated ?? 0;
  // Without a status from the endpoint, "complete" is only claimed when the counts show it.
  const everythingRead = reviewed >= review.files_in_pr && failed === 0 && skipped === 0 && truncated === 0;
  return {
    status: review.review_status ?? (everythingRead ? "complete" : "partial"),
    filesInPr: review.files_in_pr,
    reviewed,
    failed,
    skipped,
    truncated,
    failedFiles: Array.isArray(meta.failed_files) ? meta.failed_files : [],
    skippedFiles: Array.isArray(meta.skipped_files) ? meta.skipped_files : [],
    truncatedFiles: Array.isArray(meta.truncated_files) ? meta.truncated_files : [],
  };
}

function CoveragePanel({ coverage }: { coverage: ReviewCoverage }) {
  const status = COVERAGE_STATUS[coverage.status] ?? COVERAGE_STATUS.partial;
  const notFetched = coverage.skipped - coverage.skippedFiles.length;
  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-stroke-muted px-4 py-3">
        <h3 className={eyebrow}>Review coverage</h3>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        <span className="ml-auto text-xs tabular-nums text-ink-tertiary">
          {coverage.reviewed} of {coverage.filesInPr} files reviewed
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-5">
        <KpiStat mark="mark-code-review" className="bg-raised" label="Files in PR" value={coverage.filesInPr} />
        <KpiStat mark="mark-kpi-passed" className="bg-raised" label="Reviewed" value={coverage.reviewed} />
        <KpiStat mark="mark-kpi-failed" className="bg-raised" label="Failed" value={coverage.failed} hint="AI call failed" />
        <KpiStat mark="mark-kpi-skipped" className="bg-raised" label="Skipped" value={coverage.skipped} hint="not sent for review" />
        <KpiStat mark="mark-empty-error" className="bg-raised" label="Truncated" value={coverage.truncated} hint="only part of the diff was read" />
      </div>
      {coverage.failedFiles.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <h3 className={eyebrow}>Not reviewed: AI call failed</h3>
          <ul className="mt-1.5 space-y-1">
            {coverage.failedFiles.map((f) => (
              <li key={f.file} className="text-xs">
                <code className="font-mono text-ink-secondary">{f.file}</code>
                <span className="ml-2 text-ink-tertiary">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {coverage.skipped > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <h3 className={eyebrow}>Skipped</h3>
          <ul className="mt-1.5 space-y-1">
            {coverage.skippedFiles.map((f) => (
              <li key={f.file} className="text-xs">
                <code className="font-mono text-ink-secondary">{f.file}</code>
                <span className="ml-2 text-ink-tertiary">{f.reason}</span>
              </li>
            ))}
            {notFetched > 0 && (
              <li className="text-xs text-ink-tertiary">
                {notFetched} more file(s) in this PR were not fetched from GitHub.
              </li>
            )}
          </ul>
        </div>
      )}
      {coverage.truncatedFiles.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <h3 className={eyebrow}>Truncated</h3>
          <p className="mt-1.5 font-mono text-xs text-ink-secondary">{coverage.truncatedFiles.join(", ")}</p>
        </div>
      )}
    </Panel>
  );
}

interface PullRequest {
  number: number;
  title: string;
  author: string;
  base: string;
  head: string;
  changed_files: number;
  additions: number;
  deletions: number;
  updated_at?: string | null;
}

interface Finding {
  file?: string;
  severity?: string;
  category?: string;
  message?: string;
  suggestion?: string;
  line?: number;
  start_line?: number;
  end_line?: number;
}

interface ReviewSummary {
  what_changed?: string;
  test_coverage_estimate?: string;
  overall_risk?: string;
  review_recommendation?: string;
}

interface ReviewState {
  pending: boolean;
  /** Raw response of the review endpoint. */
  data?: unknown;
  error?: string;
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Only what the response actually says: a missing field stays missing rather than being filled in.
function normalizeSummary(reviewPayload: any): ReviewSummary {
  const summary = reviewPayload?.summary;
  if (summary && typeof summary === "object") return summary;
  return {
    what_changed: typeof summary === "string" ? summary : undefined,
    test_coverage_estimate: reviewPayload?.coverage_estimate,
    review_recommendation: reviewPayload?.recommendation,
  };
}

function verdictOf(review: any): { label: string; description: string; tone: StatusTone } {
  const payload = review?.review ?? {};
  // An incomplete review never shows an approving verdict, whatever the payload says.
  const recommendation: string | undefined =
    readCoverage(review)?.status === "incomplete"
      ? "INCOMPLETE"
      : (normalizeSummary(payload).review_recommendation ?? payload?.recommendation);
  if (!recommendation) {
    return { label: "No verdict", description: "The review response carried no recommendation.", tone: "neutral" };
  }
  return RECOMMENDATION_CONFIG[recommendation] ?? { label: recommendation, description: "", tone: "neutral" };
}

function normalizeFindingRange(finding: Finding): string {
  const start = Number(finding?.start_line ?? finding?.line);
  const end = Number(finding?.end_line ?? finding?.line ?? start);
  if (!Number.isFinite(start) || start <= 0) return "line ?";
  if (!Number.isFinite(end) || end <= 0 || end === start) return `line ${start}`;
  return `lines ${start}-${end}`;
}

function isActionableFinding(finding: Finding): boolean {
  const message = String(finding?.message || "").trim().toLowerCase();
  if (!message) return false;
  return !["lgtm", "lgtm!", "looks good", "looks good to me", "no changes needed."].includes(message);
}

const FINDING_COLUMNS: DataTableColumn<Finding>[] = [
  {
    id: "severity",
    header: "Severity",
    width: "w-28",
    className: "align-top",
    cell: (f) => {
      const cfg = SEVERITY[f.severity?.toLowerCase() ?? ""] || SEVERITY.low;
      return <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>;
    },
    sortValue: (f) => SEVERITY_RANK[f.severity?.toLowerCase() ?? ""] ?? 1,
  },
  {
    id: "file",
    header: "File",
    mono: true,
    className: "align-top text-ink",
    cell: (f) =>
      f.file ? (
        <span className="flex min-w-0 items-center gap-2">
          <FileIcon name={f.file} size={14} />
          <span className="truncate">{f.file}</span>
        </span>
      ) : (
        "unmapped"
      ),
    sortValue: (f) => f.file || "unmapped",
  },
  {
    id: "lines",
    header: "Lines",
    mono: true,
    width: "w-28",
    className: "align-top tabular-nums",
    cell: (f) => normalizeFindingRange(f),
    sortValue: (f) => Number(f.start_line ?? f.line) || null,
  },
  {
    id: "category",
    header: "Category",
    hideBelow: "md",
    className: "align-top text-xs",
    cell: (f) => f.category ?? "",
    sortValue: (f) => f.category,
  },
  {
    id: "finding",
    header: "Finding",
    wrap: true,
    cell: (f) => (
      <>
        <p>{f.message}</p>
        {f.suggestion && (
          <p className="mt-1 text-xs text-ink-tertiary">
            <span className="font-medium text-ink-secondary">Suggestion:</span> {f.suggestion}
          </p>
        )}
      </>
    ),
  },
];

function ReviewDetail({ review }: { review: any }) {
  const reviewPayload = review?.review ?? {};
  const summary = normalizeSummary(reviewPayload);
  const coverage = readCoverage(review);
  const verdict = verdictOf(review);
  const allFindings: Finding[] = Array.isArray(reviewPayload?.findings) ? reviewPayload.findings : [];
  // Stable sort keeps findings for the same file together, in the order the model reported them.
  const findings = allFindings
    .filter(isActionableFinding)
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => (a.finding.file || "unmapped").localeCompare(b.finding.file || "unmapped") || a.index - b.index);
  const positives: string[] = reviewPayload?.positive_observations || reviewPayload?.positives || [];

  return (
    <div className="space-y-4 py-1">
      {coverage && <CoveragePanel coverage={coverage} />}

      <div>
        <p className={cn(eyebrow, "mb-1.5")}>Summary</p>
        <p className={cn("text-sm", summary.what_changed ? "text-ink" : "text-ink-tertiary")}>
          {summary.what_changed || "The review returned no summary."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-tertiary">
          {summary.test_coverage_estimate && <span>Test coverage (AI estimate): {summary.test_coverage_estimate}</span>}
          {summary.overall_risk && <span className="capitalize">Risk: {summary.overall_risk}</span>}
          <span>
            {verdict.label}
            {verdict.description ? `: ${verdict.description}` : ""}
          </span>
        </div>
      </div>

      {findings.length > 0 && (
        <DataTable
          caption={
            <>
              Findings <span className="ml-1 tabular-nums">{findings.length}</span>
            </>
          }
          columns={FINDING_COLUMNS}
          rows={findings.map((entry) => entry.finding)}
          rowKey={(f) => String(allFindings.indexOf(f))}
          searchText={findings.length > 20 ? (f) => `${f.file ?? ""} ${f.category ?? ""} ${f.severity ?? ""} ${f.message ?? ""}` : undefined}
          searchPlaceholder="Filter findings"
          pageSize={25}
        />
      )}

      {findings.length === 0 && (
        <p className="text-sm text-ink-secondary">
          {coverage && coverage.status !== "complete" ? (
            <>
              No findings in the {coverage.reviewed} file(s) that were reviewed.{" "}
              {coverage.filesInPr > coverage.reviewed
                ? `${coverage.filesInPr - coverage.reviewed} file(s) were not reviewed, so this is not a clean result.`
                : `${coverage.truncated} file(s) were only partly read.`}
            </>
          ) : (
            "No material issues found in reviewed hunks."
          )}
        </p>
      )}

      {reviewPayload?.security_flags?.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <p className={eyebrow}>Security flags</p>
            <StatusBadge tone="critical">{reviewPayload.security_flags.length}</StatusBadge>
          </div>
          <ul className="list-disc space-y-1 pl-4 text-xs text-ink-secondary">
            {reviewPayload.security_flags.map((f: string, i: number) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {positives.length > 0 && (
        <div>
          <p className={cn(eyebrow, "mb-1.5")}>Positive observations</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-ink-secondary">
            {positives.map((o: string, i: number) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}

      {reviewPayload?.meta?.engine_version && (
        <p className="font-mono text-[11px] text-ink-quaternary">Engine: {reviewPayload.meta.engine_version}</p>
      )}
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
    staleTime: GITHUB_STALE_MS,
  });

  const prs = (prsQuery.data || []) as PullRequest[];

  // One review per PR of the loaded repository, keyed so a different repo never shows another repo's result.
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const reviewKey = (pr: PullRequest) => `${repoCoords?.owner}/${repoCoords?.repo}#${pr.number}`;
  const reviewOf = (pr: PullRequest): ReviewState | undefined => reviews[reviewKey(pr)];

  const runReview = async (pr: PullRequest) => {
    if (!repoCoords) return;
    const key = reviewKey(pr);
    setReviews((current) => ({ ...current, [key]: { pending: true } }));
    try {
      const data = await api.reviewPR(repoCoords.owner, repoCoords.repo, pr.number, customRules);
      setReviews((current) => ({ ...current, [key]: { pending: false, data } }));
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        "AI review failed";
      toast.error(String(detail));
      setReviews((current) => ({ ...current, [key]: { pending: false, error: String(detail) } }));
    }
  };

  const prColumns: DataTableColumn<PullRequest>[] = [
    { id: "number", header: "PR", mono: true, width: "w-20", cell: (pr) => `#${pr.number}`, sortValue: (pr) => pr.number },
    {
      id: "title",
      header: "Title",
      grow: true,
      cell: (pr) => <span className="font-medium text-ink">{pr.title}</span>,
      title: (pr) => pr.title,
      sortValue: (pr) => pr.title,
    },
    { id: "author", header: "Author", hideBelow: "sm", cell: (pr) => `@${pr.author}`, sortValue: (pr) => pr.author },
    { id: "branches", header: "Base ← head", mono: true, hideBelow: "lg", cell: (pr) => `${pr.base} ← ${pr.head}` },
    {
      id: "files",
      header: "Files",
      align: "right",
      hideBelow: "md",
      width: "w-20",
      cell: (pr) => (pr.changed_files > 0 ? pr.changed_files : "–"),
      sortValue: (pr) => pr.changed_files || null,
    },
    {
      id: "changes",
      header: "Lines",
      align: "right",
      hideBelow: "md",
      width: "w-28",
      cell: (pr) => (pr.additions > 0 || pr.deletions > 0 ? `+${pr.additions} −${pr.deletions}` : "–"),
      sortValue: (pr) => (pr.additions || 0) + (pr.deletions || 0) || null,
    },
    {
      id: "updated",
      header: "Updated",
      hideBelow: "xl",
      width: "w-32",
      cell: (pr) => (pr.updated_at ? new Date(pr.updated_at).toLocaleDateString() : "–"),
      sortValue: (pr) => (pr.updated_at ? new Date(pr.updated_at) : null),
    },
    {
      id: "review",
      header: "Review",
      align: "right",
      width: "w-44",
      cell: (pr) => {
        const state = reviewOf(pr);
        if (state?.data) {
          const verdict = verdictOf(state.data);
          return (
            <StatusBadge tone={verdict.tone} title={verdict.description || undefined}>
              {verdict.label}
            </StatusBadge>
          );
        }
        return (
          <span className="inline-flex items-center justify-end gap-2">
            {state?.error && (
              <span className="max-w-[200px] truncate text-xs text-destructive" title={state.error}>
                {state.error}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => void runReview(pr)} disabled={state?.pending} className="h-7 gap-1.5 text-xs">
              {state?.pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {state?.pending ? "Reviewing" : "AI review"}
            </Button>
          </span>
        );
      },
    },
  ];
  const RulesChevron = isRulesExpanded ? ChevronDown : ChevronRight;

  return (
    <PageShell>
      <PageHeader
        title="Code Reviewer"
        description="Loads the open pull requests of a GitHub repository and asks the model to review a PR's diff. Coverage shows how many of the PR's files were actually read."
      />

      <RepoInput
        id="review-repo"
        action="Load PRs"
        busy={prsQuery.isFetching}
        defaultUrl={activeRepo?.repoUrl ?? ""}
        onSearch={(owner, repo) => {
          setRepoCoords({ owner, repo });
          setActiveRepo({ owner, repo, repoUrl: `https://github.com/${owner}/${repo}`, branch: activeRepo?.branch || "main" });
        }}
      />

      {repoCoords && (
        <Panel padded={false}>
          <button
            type="button"
            onClick={() => setIsRulesExpanded(!isRulesExpanded)}
            aria-expanded={isRulesExpanded}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
          >
            <RulesChevron className="h-3.5 w-3.5 shrink-0 text-ink-quaternary" />
            <div className="min-w-0 flex-1">
              <h3 className={eyebrow}>Custom ground rules</h3>
              <p className="mt-0.5 text-xs text-ink-tertiary">
                Team-specific architectural or formatting rules sent to the model with each review.
              </p>
            </div>
            {customRules && <StatusBadge tone="info">Rules active</StatusBadge>}
          </button>

          {isRulesExpanded && (
            <div className="border-t border-border/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-raised">
                  <input type="file" accept=".md,.txt" className="hidden" onChange={handleFileUpload} />
                  <FileUp className="h-4 w-4" />
                  Upload .md rules
                </label>
                {customRules && (
                  <Button variant="ghost" size="sm" onClick={() => setCustomRules("")} className="h-7 text-xs">
                    Clear rules
                  </Button>
                )}
              </div>
              <textarea
                value={customRules}
                onChange={(e) => setCustomRules(e.target.value)}
                aria-label="Custom ground rules"
                placeholder="Or paste your team's PR guidelines, formatting rules, or architectural constraints here."
                className="h-36 w-full resize-none rounded-md border border-input bg-container px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-ink-quaternary focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          )}
        </Panel>
      )}

      {prsQuery.isLoading && (
        <Panel>
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-ink-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Fetching pull requests…
          </p>
        </Panel>
      )}

      {prsQuery.isError && (
        <Panel>
          <EmptyState kind="error" compact>
            <ErrorText error={prsQuery.error} fallback="The pull requests could not be loaded. Check the owner and repository name." />
          </EmptyState>
        </Panel>
      )}

      {prs.length > 0 && (
        <DataTable
          caption={
            <>
              Open pull requests <span className="ml-1 tabular-nums">{prs.length}</span>
            </>
          }
          toolbar={
            <span className="font-mono text-xs text-ink-tertiary">
              {repoCoords!.owner}/{repoCoords!.repo}
            </span>
          }
          columns={prColumns}
          rows={prs}
          rowKey={(pr) => String(pr.number)}
          searchText={(pr) => `#${pr.number} ${pr.title} ${pr.author} ${pr.base} ${pr.head}`}
          searchPlaceholder="Filter pull requests"
          pageSize={25}
          // A finished review opens under its row; the chevron collapses it again.
          canExpand={(pr) => !!reviewOf(pr)?.data}
          defaultExpanded={(pr) => !!reviewOf(pr)?.data}
          renderExpanded={(pr) => <ReviewDetail review={reviewOf(pr)?.data} />}
        />
      )}

      {!prsQuery.isLoading && prs.length === 0 && repoCoords && !prsQuery.isError && (
        <Panel>
          <EmptyState kind="nothingToReview">
            No open pull requests found for {repoCoords.owner}/{repoCoords.repo}.
          </EmptyState>
        </Panel>
      )}
    </PageShell>
  );
}
