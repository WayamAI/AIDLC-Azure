import { Check, ChevronRight } from "lucide-react";
import type { MarkId } from "@/lib/marks";
import { Mark } from "@/components/Mark";
import { cn } from "@/lib/utils";
import { usePipelineContext } from "@/context/PipelineContext";

const STAGES = [
  { n: 1, label: "Workspace", mark: "mark-ai-workspace" },
  { n: 2, label: "Code Review", mark: "mark-code-review" },
  { n: 3, label: "Deploy", mark: "mark-stage-deploy" },
  { n: 4, label: "Live Tests", mark: "mark-live-test-runner" },
  { n: 5, label: "Report", mark: "mark-stage-report" },
];

export function PipelineStageBar() {
  const { activeStage, completedStages, repoUrl, commitSha, reviewResult, deployedUrl, liveTestSummary, reportResult, goToStage } = usePipelineContext();

  function stageBadge(n: number): string | null {
    if (n === 1 && commitSha) return commitSha.slice(0, 7);
    if (n === 2 && reviewResult) return `${reviewResult.review.findings?.length ?? 0} findings`;
    if (n === 3 && deployedUrl) return "Ready";
    if (n === 4 && liveTestSummary) return `${liveTestSummary.passed}/${liveTestSummary.total} passed`;
    if (n === 5 && reportResult) return typeof reportResult.score === "number" ? `${reportResult.score}/100` : "No score";
    return null;
  }

  const repoLabel = repoUrl
    ? repoUrl.replace("https://github.com/", "").split("/").slice(0, 2).join("/")
    : null;

  return (
    <div className="flex h-11 items-center gap-0 border-b border-stroke-muted bg-container px-4 flex-shrink-0 overflow-x-auto">
      {/* Repo label */}
      {repoLabel && (
        <>
          <span className="text-xs text-ink-tertiary font-mono mr-4 flex-shrink-0 hidden sm:inline">{repoLabel}</span>
        </>
      )}

      {STAGES.map((stage, idx) => {
        const done = completedStages.includes(stage.n);
        const active = activeStage === stage.n;
        const locked = !done && !active && stage.n > activeStage;
        const badge = stageBadge(stage.n);

        return (
          <div key={stage.n} className="flex items-center flex-shrink-0">
            <button
              disabled={locked}
              onClick={() => !locked && goToStage(stage.n)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active && "border-transparent bg-primary text-primary-foreground",
                done && !active && "border-border text-ink-secondary hover:bg-raised cursor-pointer",
                locked && "border-transparent text-ink-quaternary cursor-not-allowed",
                !active && !done && !locked && "border-border text-ink-secondary hover:bg-raised"
              )}
            >
              {done ? (
                <Check className={cn("h-3.5 w-3.5 flex-shrink-0", !active && "text-positive")} />
              ) : (
                <span className="tabular-nums opacity-70">{stage.n}</span>
              )}
              <Mark id={stage.mark as MarkId} size={20} className="-my-1" />
              <span className="hidden sm:inline">{stage.label}</span>
              {badge && <span className="font-mono tabular-nums opacity-70">{badge}</span>}
            </button>
            {idx < STAGES.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-ink-quaternary mx-0.5 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
