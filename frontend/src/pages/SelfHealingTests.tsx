import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench01Icon } from "@hugeicons/core-free-icons";
import { AppIcon } from "@/components/AppIcon";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { api, apiClient } from "@/lib/api";
import { toast } from "sonner";

type HealingSummary = {
  broken_tests: number;
  healed_successfully: number;
  pending_review: number;
  failed_healing: number;
  healing_success_rate: number | null;
};

type HealingListItem = {
  id: string;
  test_name: string;
  failure_type: string;
  original_selector: string | null;
  candidate_selector: string | null;
  confidence: number;
  confidence_label: string;
  status: string;
  created_at: string | null;
};

export default function SelfHealingTests() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["healing", "list"],
    queryFn: async () => {
      const { data: body } = await apiClient.get<{
        summary: HealingSummary;
        items: HealingListItem[];
      }>("/testing/healing");
      return body;
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      action === "approve" ? api.approveHealing(id) : api.rejectHealing(id),
    onSuccess: (body) => {
      void queryClient.invalidateQueries({ queryKey: ["healing"] });
      toast.success(body.status === "approved" ? "Selector applied." : "Healing rejected.");
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not update healing attempt");
    },
  });

  return (
    <PageShell size="full" className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-raised">
          <AppIcon icon={Wrench01Icon} size={20} />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Self-Healing Tests</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            When a selector breaks, AIDLC scans the live page, proposes a real replacement, and waits
            for your approval before writing anything back to the stored test.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="floating-card p-8 text-center text-sm text-muted-foreground">
          Loading healing attempts…
        </div>
      )}
      {isError && (
        <div className="floating-card border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          Could not load healing attempts. Confirm the API is running and you are signed in.
        </div>
      )}

      {data?.summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {[
            ["Broken", data.summary.broken_tests],
            ["Healed", data.summary.healed_successfully],
            ["Pending", data.summary.pending_review],
            ["Failed", data.summary.failed_healing],
            [
              "Success rate",
              data.summary.healing_success_rate != null
                ? `${data.summary.healing_success_rate}%`
                : "n/a",
            ],
          ].map(([label, value]) => (
            <div key={String(label)} className="floating-card p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="floating-card p-6">
        <h2 className="text-[13px] font-semibold tracking-tight">Recent healing events</h2>
        <div className="mt-4 space-y-2">
          {(data?.items.length ?? 0) === 0 && !isLoading && (
            <p className="text-xs text-muted-foreground">
              No healing attempts yet. On a failed Live Test, open the result and click Heal selector.
            </p>
          )}
          {data?.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/40 bg-muted/10">
              <button
                type="button"
                onClick={() => setSelectedId((cur) => (cur === item.id ? null : item.id))}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-muted/20"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.test_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.original_selector ?? "—"}
                    {item.candidate_selector ? ` → ${item.candidate_selector}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{item.confidence}%</span>
                  <span className="rounded border border-border px-2 py-0.5 uppercase">{item.status}</span>
                </div>
              </button>
              {selectedId === item.id && (
                <div className="border-t border-border/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
                  <p><span className="text-foreground">Failure:</span> {item.failure_type}</p>
                  <p><span className="text-foreground">Original:</span> {item.original_selector || "—"}</p>
                  <p><span className="text-foreground">Candidate:</span> {item.candidate_selector || "—"}</p>
                  <p><span className="text-foreground">Confidence:</span> {item.confidence}% ({item.confidence_label})</p>
                  <p><span className="text-foreground">Status:</span> {item.status}</p>
                  {item.created_at && (
                    <p><span className="text-foreground">Created:</span> {item.created_at}</p>
                  )}
                  {item.status === "pending" && item.candidate_selector && (
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: item.id, action: "approve" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: item.id, action: "reject" })}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
