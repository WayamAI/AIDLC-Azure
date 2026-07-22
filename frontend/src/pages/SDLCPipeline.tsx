import { PipelineProvider, usePipelineContext } from "@/context/PipelineContext";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { PipelineStageBar } from "@/components/pipeline/PipelineStageBar";
import { StageWorkspace } from "@/components/pipeline/StageWorkspace";
import { StageCodeReview } from "@/components/pipeline/StageCodeReview";
import { StageDeployment } from "@/components/pipeline/StageDeployment";
import { StageTestRunner } from "@/components/pipeline/StageTestRunner";
import { StageReport } from "@/components/pipeline/StageReport";

function PipelineContent() {
  const { activeStage } = usePipelineContext();
  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <PipelineStageBar />
      <div className="flex-1 min-h-0 relative">
        {activeStage === 1 && <StageWorkspace />}
        {activeStage === 2 && <StageCodeReview />}
        {activeStage === 3 && <StageDeployment />}
        {activeStage === 4 && <StageTestRunner />}
        {activeStage === 5 && <StageReport />}
      </div>
    </div>
  );
}

export default function SDLCPipeline() {
  return (
    <PipelineProvider>
      {/* WorkspaceProvider lives here so workspace connection persists across all stage navigation */}
      <WorkspaceProvider>
        <PipelineContent />
      </WorkspaceProvider>
    </PipelineProvider>
  );
}
