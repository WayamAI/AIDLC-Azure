import { useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Send, Loader2, FileText, AlertCircle, BookOpen } from "lucide-react";
import { AiIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAnalyzeRequirement } from "@/hooks/use-requirements";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";

const exampleRequirement =
  "Truck sends engine health data to fleet platform every 30 seconds. The data includes engine temperature, RPM, oil pressure, fuel level, GPS coordinates, and vehicle speed. The fleet platform processes and stores the data for real-time monitoring and historical analysis.";

const Requirements = () => {
  const [requirement, setRequirement] = useState("");
  const [instructions, setInstructions] = useState("");
  const navigate = useNavigate();
  const analyzeMutation = useAnalyzeRequirement();
  const isAnalyzing = analyzeMutation.isPending;

  const handleGenerate = async () => {
    if (!requirement.trim()) return;
    try {
      const result = await analyzeMutation.mutateAsync({ text: requirement, instructions });
      localStorage.setItem("lastRequirementId", result.id);
      navigate("/generated-tests");
    } catch {
      /* error shown via analyzeMutation.isError */
    }
  };

  return (
    <PageShell size="md" className="space-y-6">
      <PageHeader
        icon={FileText}
        title="Requirement Analysis"
        description={`Describe your requirement in plain language. ${BRAND_NAME} generates a structured test suite covering functional, edge, API, failure, and regression scenarios.`}
        actions={
          <Button
            onClick={handleGenerate}
            disabled={!requirement.trim() || isAnalyzing}
            className="gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Generate test suite
              </>
            )}
          </Button>
        }
      />

      <PageCard title="Requirement" description="Primary feature or system behavior to test">
        <Textarea
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          placeholder="Describe the software requirement, system behavior, or feature specification…"
          className="mb-4 min-h-[180px] resize-none border-border/60 bg-muted/20 text-sm"
        />
        <div className="mb-2">
          <p className="text-sm font-medium text-foreground">Additional guidance</p>
          <p className="text-xs text-muted-foreground">Optional constraints or focus areas for test generation</p>
        </div>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Prioritize API error handling and offline network scenarios…"
          className="mb-4 min-h-[88px] resize-none border-border/60 bg-muted/20 text-sm"
        />
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setRequirement(exampleRequirement)}
          >
            <BookOpen className="mr-1.5 h-3.5 w-3.5" />
            Load sample
          </Button>
        </div>
      </PageCard>

      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <PageCard bodyClassName="py-10 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <AiIcon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">Generating your test suite</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Structuring cases, edge conditions, and synthetic data configurations
              </p>
              {(analyzeMutation as { isError?: boolean }).isError && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    {(
                      (analyzeMutation as { error?: { response?: { data?: { detail?: string } } } }).error
                    )?.response?.data?.detail ?? "Unable to reach the analysis service."}
                  </span>
                </div>
              )}
              <div className="mx-auto mt-6 h-1 max-w-xs overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-gradient-brand"
                  initial={{ width: "0%" }}
                  animate={{ width: "90%" }}
                  transition={{ duration: 2.2, ease: "easeInOut" }}
                />
              </div>
            </PageCard>
          </motion.div>
        )}
      </AnimatePresence>
    </PageShell>
  );
};

export default Requirements;
