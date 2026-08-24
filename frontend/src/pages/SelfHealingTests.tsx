import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Wrench01Icon } from "@hugeicons/core-free-icons";
import { AppIcon } from "@/components/AppIcon";
import { PageShell } from "@/components/PageShell";
import { apiClient } from "@/lib/api";

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
  const navigate = useNavigate();
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
              No healing attempts yet. Trigger one from a failed Playwright run via the healing analyze API.
            </p>
          )}
          {data?.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/self-healing/${item.id}`)}
              className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-muted/10 px-4 py-3 text-left transition hover:bg-muted/20"
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
          ))}
        </div>
      </div>
    </PageShell>
  );
}
