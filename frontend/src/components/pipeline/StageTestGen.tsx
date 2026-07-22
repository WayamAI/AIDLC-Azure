import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineContext } from "@/context/PipelineContext";
import { TestGenerator } from "@/components/workspace/TestGenerator";

export function StageTestGen() {
  const { commitSha, testSuite, setTestSuite, completeStage, goToStage } = usePipelineContext();

  return (
    <div className="flex flex-col h-full">
      {/* Banner */}
      <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/20 flex-shrink-0">
        <p className="text-xs text-primary/80">
          Stage 3 Generate Playwright test cases{commitSha ? ` for commit ${commitSha.slice(0, 7)}` : ""}.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => goToStage(2)}>← Back</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => completeStage(3)}>
            Next <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
          {testSuite.length > 0 && (
            <Button size="sm" className="h-7 text-xs" onClick={() => completeStage(3)}>
              Next <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </div>

      {/* TestGenerator fills the rest */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <div className="max-w-lg mx-auto h-full">
          <TestGenerator
            initialScope={commitSha ? "commits" : "entire_app"}
            initialCommitSha={commitSha ?? undefined}
            onTestsGenerated={(tests) => {
              setTestSuite(tests);
            }}
          />
        </div>
      </div>
    </div>
  );
}
