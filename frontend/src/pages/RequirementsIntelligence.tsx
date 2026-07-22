import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import {
  FileText, Search, Loader2, ChevronDown, ChevronRight, AlertTriangle,
  CheckCircle, Upload, Brain, PenLine, Info, Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";

// ─── What this module does ───────────────────────────────────────────────────
// Takes a user story (from Jira or typed manually) and uses AI to:
//  • Generate BDD acceptance criteria (Given / When / Then scenarios)
//  • Flag ambiguous terms that need clarification
//  • Score the story's defect risk (0–100)
//  • Suggest test hints
// If connected to Jira you can also push the generated AC back to the issue.

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "text-red-700 border-red-200 bg-red-50",
  Highest: "text-red-700 border-red-200 bg-red-50",
  High: "text-orange-700 border-orange-200 bg-orange-50",
  Medium: "text-amber-700 border-amber-200 bg-amber-50",
  Low: "text-sky-700 border-sky-200 bg-sky-50",
  Lowest: "text-muted-foreground border-border/30",
};

// ─── Shared StoryCard ────────────────────────────────────────────────────────

function StoryCard({ item, canPushToJira = false }: { item: any; canPushToJira?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const { toast } = useToast();
  const { story, ai_analysis } = item;

  const pushMutation = useMutation({
    mutationFn: () => {
      const acText = ai_analysis?.acceptance_criteria
        ?.map((ac: any, i: number) =>
          `Scenario ${i + 1}: ${ac.scenario}\nGiven: ${ac.given}\nWhen: ${ac.when}\nThen: ${ac.then}`
        )
        .join("\n\n");
      return api.pushACToJira(story.key, acText || "");
    },
    onSuccess: () =>
      toast({ title: "Pushed to Jira", description: `${story.key} updated with AI-generated acceptance criteria.` }),
    onError: () =>
      toast({ title: "Push failed", description: "Could not update Jira. Check credentials in backend .env.", variant: "destructive" }),
  });

  const riskScore = ai_analysis?.risk_score || 0;
  const riskColor =
    riskScore >= 75 ? "text-red-700" :
    riskScore >= 50 ? "text-orange-700" :
    riskScore >= 25 ? "text-amber-700" :
    "text-positive";

  return (
    <div className="floating-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {story.key !== "MANUAL-1" && (
              <span className="text-xs font-mono text-muted-foreground">{story.key}</span>
            )}
            <Badge className={`text-[10px] border ${PRIORITY_COLORS[story.priority] || "text-muted-foreground"}`}>
              {story.priority}
            </Badge>
            {ai_analysis && (
              <Badge variant="outline" className={`text-[10px] ${riskColor}`}>
                Risk: {riskScore}/100
              </Badge>
            )}
            {ai_analysis?.duplicate_of && (
              <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30">
                Dupe of {ai_analysis.duplicate_of}
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium">{story.summary}</p>
          {story.key !== "MANUAL-1" && (
            <p className="text-xs text-muted-foreground mt-0.5">{story.status} · {story.assignee}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ai_analysis && canPushToJira && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => pushMutation.mutate()}
              disabled={pushMutation.isPending}
            >
              {pushMutation.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <><Upload className="h-3 w-3 mr-1" />Push to Jira</>}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && ai_analysis && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
              {story.description && (
                <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Story Description</p>
                  <p className="text-sm text-muted-foreground">
                    {story.description.slice(0, 300)}{story.description.length > 300 ? "…" : ""}
                  </p>
                </div>
              )}

              {ai_analysis.acceptance_criteria?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {ai_analysis.acceptance_criteria.length} Acceptance Criteria Scenarios
                  </p>
                  <div className="space-y-2">
                    {ai_analysis.acceptance_criteria.map((ac: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg bg-positive/10 border border-primary/30/20 text-xs">
                        <p className="font-medium text-positive mb-1">{ac.scenario}</p>
                        <p><span className="text-muted-foreground font-medium">Given </span>{ac.given}</p>
                        <p><span className="text-muted-foreground font-medium">When </span>{ac.when}</p>
                        <p><span className="text-muted-foreground font-medium">Then </span>{ac.then}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ai_analysis.ambiguity_flags?.length > 0 && (
                <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                    <span className="text-xs font-medium text-amber-700">
                      {ai_analysis.ambiguity_flags.length} Ambiguity Flags needs clarification before development
                    </span>
                  </div>
                  {ai_analysis.ambiguity_flags.map((f: any, i: number) => (
                    <div key={i} className="mb-1 last:mb-0">
                      <p className="text-xs">
                        <span className="font-mono text-amber-700">"{f.term}"</span>
                        <span className="text-muted-foreground"> {f.question}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {ai_analysis.risk_reasoning && (
                <p className="text-xs text-muted-foreground italic">{ai_analysis.risk_reasoning}</p>
              )}

              {ai_analysis.test_hints?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Test Hints</p>
                  <div className="flex flex-wrap gap-1">
                    {ai_analysis.test_hints.map((h: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{h}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
        {expanded && !ai_analysis && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-border/50">
              <p className="text-xs text-muted-foreground">AI analysis unavailable for this story.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Tab = "jira" | "manual";

export default function RequirementsIntelligence() {
  const [tab, setTab] = useState<Tab>("manual");

  // Jira mode state
  const [projectKey, setProjectKey] = useState("");

  // Manual mode state
  const [manualSummary, setManualSummary] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualPriority, setManualPriority] = useState("Medium");

  // ── Jira mutation ────────────────────────────────────────────────────────
  const jiraMutation = useMutation({
    mutationFn: () => api.analyzeSprintAC(projectKey),
  });

  // ── Manual mutation ──────────────────────────────────────────────────────
  const manualMutation = useMutation({
    mutationFn: () => api.analyzeManualStory(manualSummary, manualDescription, manualPriority),
  });

  const jiraData = jiraMutation.data as any;
  const jiraItems = jiraData?.stories || [];
  const ambiguousCount = jiraItems.filter((i: any) => (i.ai_analysis?.ambiguity_flags?.length || 0) > 0).length;
  const highRiskCount = jiraItems.filter((i: any) => (i.ai_analysis?.risk_score || 0) >= 70).length;

  const manualResult = manualMutation.data as any;

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>

        <PageHeader
          icon={Lightbulb}
          title="Requirements Intelligence"
          description="AI generates BDD acceptance criteria, detects ambiguous language, and scores defect risk for your user stories."
        />

        {/* What this does */}
        <div className="page-card p-4 border-primary/20 mb-6">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><span className="text-foreground font-medium">What you get:</span> Given/When/Then BDD scenarios ready to paste into your test framework, a list of vague terms that need clarification before dev starts, and a 0–100 defect risk score.</p>
              <p><span className="text-foreground font-medium">Use "Jira Sprint"</span> to pull all stories from your active Jira sprint at once (requires Jira credentials in backend .env).</p>
              <p><span className="text-foreground font-medium">Use "Single Story"</span> to paste any story directly no Jira account needed.</p>
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted/30 rounded-lg w-fit mb-6">
          <button
            onClick={() => setTab("manual")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "manual" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <PenLine className="h-4 w-4" />
            Single Story
          </button>
          <button
            onClick={() => setTab("jira")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === "jira" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Brain className="h-4 w-4" />
            Jira Sprint
          </button>
        </div>

        {/* ── Manual Story tab ──────────────────────────────────────────────── */}
        {tab === "manual" && (
          <div className="space-y-6">
            <div className="floating-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <PenLine className="h-4 w-4 text-primary" />
                <span className="font-display text-[13px] font-semibold tracking-tight">Paste Your User Story</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Story Title / Summary <span className="text-red-700">*</span>
                  </label>
                  <Input
                    value={manualSummary}
                    onChange={(e) => setManualSummary(e.target.value)}
                    placeholder='e.g. "As a user I want to reset my password so I can regain account access"'
                    className="bg-muted/30 border-border/50"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Description / Details <span className="text-muted-foreground">(optional more detail = better scenarios)</span>
                  </label>
                  <Textarea
                    value={manualDescription}
                    onChange={(e) => setManualDescription(e.target.value)}
                    placeholder={"Describe acceptance conditions, constraints, or business rules...\n\nExample:\n- User clicks 'Forgot Password' on login page\n- System sends reset email within 2 minutes\n- Link expires after 24 hours\n- New password must be 8+ chars"}
                    rows={6}
                    className="bg-muted/30 border-border/50 resize-none font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                  <select
                    value={manualPriority}
                    onChange={(e) => setManualPriority(e.target.value)}
                    className="w-full h-9 px-3 text-sm rounded-md border border-border/50 bg-muted/30 text-foreground"
                  >
                    {["Critical", "High", "Medium", "Low"].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <Button
                  onClick={() => manualMutation.mutate()}
                  disabled={!manualSummary.trim() || manualMutation.isPending}
                  className="bg-primary text-primary-foreground w-full"
                >
                  {manualMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                    : <><Brain className="h-4 w-4 mr-2" />Generate Acceptance Criteria</>}
                </Button>
              </div>
            </div>

            {manualMutation.isError && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                AI generation failed. Check that Ollama credentials are set in backend .env.
              </div>
            )}

            {manualResult && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <p className="text-sm font-medium">Results</p>
                <StoryCard item={manualResult} canPushToJira={false} />
              </motion.div>
            )}
          </div>
        )}

        {/* ── Jira Sprint tab ───────────────────────────────────────────────── */}
        {tab === "jira" && (
          <div className="space-y-6">
            <div className="floating-card p-6">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-primary" />
                <span className="font-display text-[13px] font-semibold tracking-tight">Jira Sprint Analysis</span>
              </div>

              <div className="p-3 rounded-lg bg-muted/20 border border-border/30 mb-4 text-xs text-muted-foreground space-y-1">
                <p><span className="text-foreground font-medium">What is a Jira Project Key?</span> It's the short prefix on every ticket e.g. if your tickets are <code className="bg-muted px-1 rounded">PROJ-42</code> then the key is <code className="bg-muted px-1 rounded">PROJ</code>.</p>
                <p>You can find it in your Jira board URL: <code className="bg-muted px-1 rounded">jira.yourcompany.com/jira/software/projects/<strong>PROJ</strong>/boards</code></p>
                <p className="text-amber-700">Requires JIRA_DOMAIN, JIRA_EMAIL, and JIRA_TOKEN in the backend .env file.</p>
              </div>

              <div className="flex gap-3">
                <Input
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                  placeholder="Jira Project Key (e.g. PROJ, DEMO, ENG)"
                  className="flex-1 bg-muted/30 border-border/50 uppercase"
                  onKeyDown={(e) => e.key === "Enter" && projectKey && jiraMutation.mutate()}
                />
                <Button
                  onClick={() => jiraMutation.mutate()}
                  disabled={!projectKey || jiraMutation.isPending}
                  className="bg-primary text-primary-foreground"
                >
                  {jiraMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Analysing…</>
                    : <><Brain className="h-4 w-4 mr-2" />Analyse Sprint</>}
                </Button>
              </div>
            </div>

            {jiraMutation.isError && (
              <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive space-y-1">
                <p className="font-medium">Failed to connect to Jira</p>
                <p>Check: (1) Project key is correct, (2) JIRA_DOMAIN / JIRA_EMAIL / JIRA_TOKEN in backend .env are valid, (3) the project has an active sprint.</p>
                <p>Tip: use the "Single Story" tab if you don't have Jira configured.</p>
              </div>
            )}

            {jiraData && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <PageStat icon={FileText} label="Stories Analysed" value={jiraData.total} color="text-primary" />
                  <PageStat
                    icon={CheckCircle}
                    label="AC Scenarios Generated"
                    value={jiraItems.reduce((acc: number, i: any) => acc + (i.ai_analysis?.acceptance_criteria?.length || 0), 0)}
                    color="text-positive"
                    accent="success"
                  />
                  <PageStat icon={AlertTriangle} label="Ambiguous Stories" value={ambiguousCount} color="text-amber-700" accent="warning" />
                  <PageStat icon={AlertTriangle} label="High-Risk Stories" value={highRiskCount} color="text-red-700" accent="destructive" />
                </div>

                {jiraItems.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">{jiraItems.length} Sprint Stories</p>
                    {jiraItems.map((item: any) => (
                      <StoryCard key={item.story.key} item={item} canPushToJira={true} />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    No stories found in the active sprint for this project.
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}

      </motion.div>
    </PageShell>
  );
}
