import { Check, GitPullRequest, Play, BarChart3, ChevronRight, Code2, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePipelineContext } from "@/context/PipelineContext";

const STAGES = [
  { n: 1, label: "Workspace",   icon: Code2,          short: "Edit & commit" },
  { n: 2, label: "Code Review", icon: GitPullRequest, short: "AI review" },
  { n: 3, label: "Deploy",      icon: Rocket,         short: "Ship commit" },
  { n: 4, label: "Live Tests",  icon: Play,           short: "Execute tests" },
  { n: 5, label: "Report",      icon: BarChart3,      short: "GO / NO-GO" },
];

export function PipelineStageBar() {
  const { activeStage, completedStages, repoUrl, commitSha, reviewResult, deployedUrl, liveTestSummary, reportResult, goToStage } = usePipelineContext();

  function stageBadge(n: number): string | null {
    if (n === 1 && commitSha) return commitSha.slice(0, 7);
    if (n === 2 && reviewResult) return `${reviewResult.review.findings?.length ?? 0} findings`;
    if (n === 3 && deployedUrl) return "READY";
    if (n === 4 && liveTestSummary) return `${liveTestSummary.passed}/${liveTestSummary.total} passed`;
    if (n === 5 && reportResult) return `${reportResult.score}/100`;
    return null;
  }

  const repoLabel = repoUrl
    ? repoUrl.replace("https://github.com/", "").split("/").slice(0, 2).join("/")
    : null;

  return (
    <div className="flex items-center gap-0 border-b border-border/50 bg-muted/20 px-4 py-2 flex-shrink-0 overflow-x-auto">
      {/* Repo label */}
      {repoLabel && (
        <>
          <span className="text-xs text-muted-foreground/60 font-mono mr-2 flex-shrink-0 hidden sm:inline">{repoLabel}</span>
          <span className="text-muted-foreground/30 text-xs mr-2 flex-shrink-0 hidden sm:inline">·</span>
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
                "flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-all",
                active && "bg-primary/15 text-primary border border-primary/30",
                done && !active && "text-positive hover:bg-positive/10 cursor-pointer",
                locked && "text-muted-foreground/40 cursor-not-allowed",
                !active && !done && !locked && "text-muted-foreground hover:text-foreground"
              )}
            >
              {done ? (
                <div className="h-4 w-4 rounded-full bg-primary/20 border border-primary/30/40 flex items-center justify-center flex-shrink-0">
                  <Check className="h-2.5 w-2.5 text-positive" />
                </div>
              ) : (
                <div className={cn(
                  "h-4 w-4 rounded-full border flex items-center justify-center flex-shrink-0 text-[9px] font-bold",
                  active ? "bg-primary/20 border-primary/60 text-primary" : "bg-muted border-border/50 text-muted-foreground"
                )}>
                  {stage.n}
                </div>
              )}
              <span className="font-medium hidden sm:inline">{stage.label}</span>
              {badge && (
                <span className={cn(
                  "text-[9px] px-1.5 py-0.5 rounded-full border font-mono",
                  done ? "bg-positive/10 border-positive/25 text-positive" : "bg-primary/10 border-primary/30 text-primary"
                )}>
                  {badge}
                </span>
              )}
            </button>
            {idx < STAGES.length - 1 && (
              <ChevronRight className="h-3 w-3 text-muted-foreground/30 mx-0.5 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}
