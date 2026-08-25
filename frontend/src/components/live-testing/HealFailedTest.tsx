import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wrench, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type HealingAttemptDetail } from "@/lib/api";
import { toast } from "sonner";
import { useState } from "react";

export function HealFailedTest({
  runId,
  testId,
  targetUrl,
}: {
  runId: string;
  testId: string;
  targetUrl: string;
}) {
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState<HealingAttemptDetail | null>(null);

  const analyze = useMutation({
    mutationFn: () => api.analyzeHealing({ run_id: runId, test_id: testId, target_url: targetUrl }),
    onSuccess: (data) => {
      setAttempt(data);
      void queryClient.invalidateQueries({ queryKey: ["healing"] });
      if (data.status === "pending") toast.success("Candidate selector found. Review and approve to apply.");
      else if (data.error) toast.error(data.error);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Healing failed to start");
    },
  });

  const decide = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      action === "approve" ? api.approveHealing(attempt!.id) : api.rejectHealing(attempt!.id),
    onSuccess: (data) => {
      setAttempt(data);
      void queryClient.invalidateQueries({ queryKey: ["healing"] });
      toast.success(data.status === "approved" ? "Selector applied to the stored test." : "Healing rejected.");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not update healing attempt");
    },
  });

  const canHeal = Boolean(runId && testId && targetUrl.startsWith("http"));

  return (
    <div className="space-y-2">
      {!attempt && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={!canHeal || analyze.isPending}
          onClick={(e) => {
            e.stopPropagation();
            analyze.mutate();
          }}
          title={!canHeal ? "Need a public target URL and a saved run to heal" : "Propose a replacement selector"}
        >
          {analyze.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
          Heal selector
        </Button>
      )}

      {attempt && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-xs space-y-2">
          <p className="font-medium text-foreground">
            Healing: {attempt.status}
            {attempt.confidence ? ` · ${attempt.confidence}% ${attempt.confidence_label}` : ""}
          </p>
          <p className="text-muted-foreground">
            {attempt.original_selector || "—"} → {attempt.candidate?.selector || "none"}
          </p>
          {attempt.candidate?.reasoning && (
            <p className="text-muted-foreground">{attempt.candidate.reasoning}</p>
          )}
          {attempt.error && <p className="text-destructive">{attempt.error}</p>}
          {attempt.status === "pending" && attempt.candidate?.selector && (
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={decide.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  decide.mutate("approve");
                }}
              >
                <Check className="h-3 w-3 mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={decide.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  decide.mutate("reject");
                }}
              >
                <X className="h-3 w-3 mr-1" /> Reject
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
