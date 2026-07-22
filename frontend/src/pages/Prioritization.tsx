import { motion } from "framer-motion";
import { ArrowUpDown, AlertTriangle, AlertOctagon, Shield, Bug, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePrioritizedTests, useRefreshPrioritization } from "@/hooks/use-prioritization";
import { mockPrioritizedTests } from "@/lib/mockData";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";

const statusConfig = {
  failed: { color: "bg-destructive/15 text-destructive border-destructive/20", label: "Failed" },
  warning: { color: "bg-warning/15 text-warning border-warning/20", label: "At Risk" },
  stable: { color: "bg-positive/15 text-positive border-positive/20", label: "Stable" },
};

const Prioritization = () => {
  const { data, isLoading, isError } = usePrioritizedTests();
  const refreshMutation = useRefreshPrioritization();

  // Fall back to mock data
  const rawTests = data ?? (isError ? mockPrioritizedTests.map((t) => ({
    id: t.id,
    tc_id: t.id,
    name: t.name,
    failure_count: t.failureCount,
    severity: t.severity,
    priority: t.priority,
    status: t.status as "failed" | "warning" | "stable",
    known_failure: t.knownFailure,
  })) : []);

  const high = rawTests.filter((t) => t.priority >= 80);
  const medium = rawTests.filter((t) => t.priority >= 40 && t.priority < 80);
  const low = rawTests.filter((t) => t.priority < 40);
  const knownFailures = rawTests.filter((t) => t.known_failure);

  const sections = [
    { label: "High Priority", icon: AlertOctagon, items: high, accent: "text-destructive", border: "border-l-destructive" },
    { label: "Medium Priority", icon: AlertTriangle, items: medium, accent: "text-warning", border: "border-l-warning" },
    { label: "Low Priority", icon: Shield, items: low, accent: "text-positive", border: "border-l-positive" },
  ];

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        {/* Step banner */}
        <div className="page-card flex items-center gap-3 mb-6 p-4 border-warning/20">
          <div className="h-9 w-9 rounded-lg bg-warning/20 border border-warning/30 flex items-center justify-center shrink-0 font-display font-bold text-warning text-sm">4</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-display font-semibold text-sm">Step 4 of 4 Risk-Based Priority Ranking</span>
              <Badge variant="outline" className="text-[10px] border-warning/30 text-warning bg-warning/10">Final Step</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Test cases are ranked by risk exposure and failure history. Address <strong>High Priority</strong> items first these represent the greatest probability of uncovering critical defects. Use <strong>Refresh Priority Ranking</strong> to re-evaluate with the latest execution data.</p>
          </div>
        </div>

        <div className="mb-6 flex items-start justify-between gap-4">
          <PageHeader
            className="mb-0 flex-1"
            icon={ArrowUpDown}
            title="Risk-Based Test Prioritization"
            description={
              isError
                ? "Live data unavailable displaying cached reference prioritization"
                : "AI-ranked test execution order derived from failure history, risk exposure, and severity"
            }
          />
          <Button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isLoading}
            variant="outline"
            size="sm"
            className="shrink-0 font-display"
          >
            {refreshMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Re-evaluating…</>
            ) : (
              <><RefreshCw className="h-3.5 w-3.5 mr-2" />Refresh Ranking</>
            )}
          </Button>
        </div>

        {/* Known Failures */}
        {knownFailures.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="floating-card mb-6 border-destructive/30"
          >
            <div className="p-4 border-b border-border/30 flex items-center gap-2">
              <Bug className="h-4 w-4 text-destructive" />
              <span className="font-display text-[13px] font-semibold tracking-tight">Known Failures Pending Resolution</span>
              <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/20 text-xs ml-2">
                {knownFailures.length}
              </Badge>
            </div>
            <div className="divide-y divide-border/20">
              {knownFailures.map((t, i) => (
                <motion.div
                  key={t.tc_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 + i * 0.05 }}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground w-16">{t.tc_id}</span>
                    <span className="text-sm">{t.name}</span>
                    <Badge className="bg-destructive/20 text-destructive text-[10px] border-none">Known Failure</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{t.failure_count} failures</span>
                    <span className="font-mono text-xs font-semibold text-destructive">{t.priority}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Priority Sections */}
        <div className="space-y-4">
          {sections.map((section, si) => (
            <motion.div
              key={section.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + si * 0.1 }}
              className="floating-card overflow-hidden"
            >
              <div className="p-4 border-b border-border/30 flex items-center gap-2">
                <section.icon className={`h-4 w-4 ${section.accent}`} />
                <span className="font-display text-[13px] font-semibold tracking-tight">{section.label}</span>
                <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs ml-2">
                  {section.items.length}
                </Badge>
              </div>

              {section.items.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No test cases currently assigned to this priority level.</p>
              ) : (
                <div className="divide-y divide-border/20">
                  {section.items.map((t, i) => (
                    <motion.div
                      key={t.tc_id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.05 }}
                      className={`flex items-center justify-between px-4 py-3 border-l-2 ${section.border} hover:bg-muted/10 transition-colors`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-muted-foreground w-16">{t.tc_id}</span>
                        <span className="text-sm">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">{t.failure_count} failures</div>
                          <div className="text-[10px] text-muted-foreground">{t.severity}</div>
                        </div>
                        <div className="w-10 text-center">
                          <span className="font-mono text-sm font-bold">{t.priority}</span>
                        </div>
                        <Badge variant="outline" className={`text-xs ${statusConfig[t.status].color}`}>
                          {statusConfig[t.status].label}
                        </Badge>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </PageShell>
  );
};

export default Prioritization;
