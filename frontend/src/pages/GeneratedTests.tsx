import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, TestTubes, AlertTriangle, Globe, XCircle, RotateCcw, Loader2, ServerCrash, ArrowRight, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useGroupedTestCases, useUpdateTestCase } from "@/hooks/use-test-cases";
import { mockTestCases } from "@/lib/mockData";
import { Edit2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";

const SECTION_META = [
  { key: "functional", label: "Functional Tests", icon: TestTubes },
  { key: "edge", label: "Edge Cases", icon: AlertTriangle },
  { key: "api", label: "API Validation", icon: Globe },
  { key: "failure", label: "Failure Scenarios", icon: XCircle },
  { key: "regression", label: "Regression Tests", icon: RotateCcw },
] as const;

const severityColors: Record<string, string> = {
  Critical: "bg-destructive/15 text-destructive border-destructive/20",
  High: "bg-warning/15 text-warning border-warning/20",
  Medium: "bg-primary/15 text-primary border-primary/20",
  Low: "bg-positive/15 text-positive border-positive/20",
};

const GeneratedTests = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ functional: true });
  const [editingTest, setEditingTest] = useState<any | null>(null);
  const requirementId = localStorage.getItem("lastRequirementId") ?? undefined;

  const { data, isLoading, isError } = useGroupedTestCases(requirementId);
  const updateMutation = useUpdateTestCase();

  const handleSaveEdit = async () => {
    if (!editingTest) return;
    try {
      await updateMutation.mutateAsync({
        tc_id: editingTest.tc_id || editingTest.id,
        payload: {
          name: editingTest.name,
          description: editingTest.description,
          expected: editingTest.expected,
          severity: editingTest.severity,
        },
      });
      setEditingTest(null);
    } catch (e) {
      console.error(e);
    }
  };

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Fall back to mock data if backend is unreachable
  const grouped = data ?? (isError ? (mockTestCases as unknown as typeof data) : null);
  const total = grouped ? Object.values(grouped).flat().length : 0;

  if (isLoading) {
    return (
      <PageShell size="full" className="space-y-6 flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <p className="text-muted-foreground text-sm">Loading test suite…</p>
      </PageShell>
    );
  }

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
{/* Step banner */}
        <div className="page-card flex items-center gap-3 mb-6 p-4 border-secondary/20">
          <div className="h-9 w-9 rounded-lg bg-secondary/20 border border-secondary/30 flex items-center justify-center shrink-0 font-display font-bold text-secondary text-sm">2</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-display font-semibold text-sm">Step 2 of 4 Review Generated Test Suite</span>
              <Badge variant="outline" className="text-[10px] border-secondary/30 text-secondary bg-secondary/10">{total} test cases ready</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Review the AI-generated test cases organized by category. Modify individual test cases as needed, then proceed to Step 3 to execute the suite.</p>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 font-display gap-1.5"
            onClick={() => navigate("/test-execution")}
          >
            <Play className="h-3.5 w-3.5" />
            Run Tests
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mb-6 flex items-start justify-between gap-4">
          <PageHeader
            className="mb-0 flex-1"
            icon={TestTubes}
            title="AI-Generated Test Suite"
            description={
              isError
                ? "Live data unavailable displaying cached reference test suite"
                : "Comprehensive test suite generated from your submitted requirement"
            }
          />
          <div className="floating-card shrink-0 px-4 py-2">
            <span className="text-2xl font-display font-bold text-primary">{total}</span>
            <span className="ml-2 text-sm text-muted-foreground">test cases</span>
          </div>
        </div>

        {isError && (
          <div className="floating-card p-4 mb-6 border-warning/30 flex items-center gap-3 text-sm text-warning">
            <ServerCrash className="h-4 w-4 shrink-0" />
            The analysis service is currently unreachable. Displaying reference data. To restore live connectivity, start the server with{" "}
            <code className="font-mono bg-muted px-1 rounded">uv run uvicorn main:app --reload --port 8000</code>
          </div>
        )}

        <div className="space-y-4">
          {SECTION_META.map((section, si) => {
            const items = grouped?.[section.key] ?? [];
            return (
              <motion.div
                key={section.key}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: si * 0.08 }}
                className="floating-card overflow-hidden"
              >
                <button
                  onClick={() => toggle(section.key)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <section.icon className="h-4 w-4 text-primary" />
                    <span className="font-display text-[13px] font-semibold tracking-tight">{section.label}</span>
                    <Badge variant="secondary" className="bg-muted text-muted-foreground text-xs">
                      {items.length}
                    </Badge>
                  </div>
                  {expanded[section.key] ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                <AnimatePresence>
                  {expanded[section.key] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-3">
                        {items.map((tc, i) => {
                          const tcId = "tc_id" in tc ? tc.tc_id : (tc as { id: string }).id;
                          return (
                            <motion.div
                              key={tcId}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                              className="group relative p-5 rounded-xl bg-[#fefdfb] border border-secondary/20 shadow-sm transition-shadow hover:shadow-md"
                            >
                              <Button
                                size="icon"
                                variant="ghost"
                                className="absolute right-2 top-11 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => setEditingTest(tc)}
                              >
                                <Edit2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                              <div className="flex items-start justify-between mb-3 pr-10">
                                <span className="font-display font-bold text-lg leading-tight text-foreground/90">{tc.name}</span>
                                <Badge variant="secondary" className="bg-[#eef5e7] text-[#2c6517] hover:bg-[#eef5e7] border-none shrink-0 font-medium">
                                  {tc.severity}
                                </Badge>
                              </div>
                              <p className="text-sm text-foreground/70 mb-4 leading-relaxed pr-8">{tc.description}</p>
                              <div className="text-sm font-medium text-[#3b8520]">
                                {tc.expected}
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Edit Dialog */}
      <Dialog open={!!editingTest} onOpenChange={(open) => !open && setEditingTest(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Test Case</DialogTitle>
            <DialogDescription>Update the test case details and expected outcome below.</DialogDescription>
          </DialogHeader>
          {editingTest && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={editingTest.name}
                  onChange={(e) => setEditingTest({ ...editingTest, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Severity</label>
                <select
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  value={editingTest.severity}
                  onChange={(e) => setEditingTest({ ...editingTest, severity: e.target.value })}
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={editingTest.description}
                  onChange={(e) => setEditingTest({ ...editingTest, description: e.target.value })}
                  className="min-h-[100px]"
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Expected Result</label>
                <Input
                  value={editingTest.expected}
                  onChange={(e) => setEditingTest({ ...editingTest, expected: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTest(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving Changes..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default GeneratedTests;
