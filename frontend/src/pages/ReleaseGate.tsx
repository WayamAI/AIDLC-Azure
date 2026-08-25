import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import {
  Lock, Unlock, AlertTriangle, CheckCircle, XCircle, Loader2,
  GitBranch, Bug, Shield, TrendingDown, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";
import { api } from "@/lib/api";
import { useActiveRepo } from "@/context/RepoContext";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 75 ? "#B45309" : score >= 50 ? "#AFAFAF" : "#DC2626";
  return (
    <div className="relative flex items-center justify-center">
      <ResponsiveContainer width={200} height={200}>
        <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" startAngle={180} endAngle={0} data={[{ value: score, fill: color }]}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "hsl(var(--muted)/30)" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-8">
        <span className="text-4xl font-display font-bold" style={{ color }}>{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export default function ReleaseGate() {
  const { activeRepo, setActiveRepo } = useActiveRepo();
  const [form, setForm] = useState({
    version: "",
    owner: activeRepo?.owner ?? "",
    repo: activeRepo?.repo ?? "",
    jira_project: "",
  });

  const evaluateMutation = useMutation({
    mutationFn: () => api.evaluateRelease({
      version: form.version || "HEAD",
      owner: form.owner,
      repo: form.repo,
      jira_project: form.jira_project || undefined,
    }),
  });

  const result = evaluateMutation.data as any;
  const verdict = result?.verdict;
  const score = result?.score ?? 0;
  const signals = result?.signals || {};

  const verdictConfig: Record<string, { color: string; icon: React.ElementType; bg: string; border: string }> = {
    "GO": { color: "text-positive", icon: CheckCircle, bg: "bg-positive/10", border: "border-positive/25" },
    "NO-GO": { color: "text-red-700", icon: XCircle, bg: "bg-red-50", border: "border-red-200" },
    "CONDITIONAL": { color: "text-amber-700", icon: AlertTriangle, bg: "bg-amber-50", border: "border-amber-200" },
  };
  const vcfg = verdictConfig[verdict?.verdict || "CONDITIONAL"];

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <PageHeader
          icon={ShieldCheck}
          title="Release Gate"
          description="Compute a composite release readiness score from CI results, open bugs, and security findings."
        />

        {/* Input form */}
        <div className="floating-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="h-4 w-4 text-primary" />
            <span className="font-display text-[13px] font-semibold tracking-tight">Release Parameters</span>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">GitHub Owner</label>
              <Input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="e.g. expressjs" className="bg-muted/30 border-border/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Repository</label>
              <Input value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} placeholder="e.g. express" className="bg-muted/30 border-border/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Version / Tag</label>
              <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="e.g. v2.3.1" className="bg-muted/30 border-border/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Jira Project Key (optional)</label>
              <Input value={form.jira_project} onChange={(e) => setForm({ ...form, jira_project: e.target.value })} placeholder="e.g. PROJ" className="bg-muted/30 border-border/50" />
            </div>
          </div>
          <Button
            onClick={() => {
              if (form.owner && form.repo) setActiveRepo({ owner: form.owner, repo: form.repo, repoUrl: `https://github.com/${form.owner}/${form.repo}`, branch: activeRepo?.branch || "main" });
              evaluateMutation.mutate();
            }}
            disabled={!form.owner || !form.repo || evaluateMutation.isPending}
            className="bg-primary text-primary-foreground w-full"
          >
            {evaluateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Evaluating…</>
            ) : (
              <><Lock className="h-4 w-4 mr-2" />Evaluate Release</>
            )}
          </Button>
        </div>

        {evaluateMutation.isError && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            Evaluation failed. Check repository access and API keys.
          </div>
        )}

        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            {/* Verdict + Score */}
            <div className="floating-card p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-2">Release {result.version}</p>
                  {vcfg && (
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border ${vcfg.bg} ${vcfg.border} mb-4`}>
                      <vcfg.icon className={`h-5 w-5 ${vcfg.color}`} />
                      <span className={`text-xl font-display font-bold ${vcfg.color}`}>{verdict?.verdict}</span>
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground leading-relaxed">{verdict?.recommendation}</p>
                  {verdict?.primary_blocker && (
                    <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                      <p className="text-xs font-medium text-red-700 mb-1">Primary Blocker</p>
                      <p className="text-sm">{verdict.primary_blocker}</p>
                    </div>
                  )}
                  {verdict?.conditions?.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-amber-700 mb-2">Conditions to resolve:</p>
                      <ul className="space-y-1">
                        {verdict.conditions.map((c: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground">• {c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  <ScoreGauge score={score} />
                </div>
              </div>
            </div>

            {/* Signal breakdown */}
            <div className="floating-card p-6">
              <p className="text-[13px] font-semibold tracking-tight mb-4">Signal Breakdown</p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 rounded-lg border border-border/30">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-positive" />
                    <span className="text-xs font-medium">CI Test Pass Rate</span>
                  </div>
                  <p className="text-2xl font-display font-bold text-positive">{signals.test_pass_rate || 0}%</p>
                  <p className="text-xs text-muted-foreground">from last {signals.workflow_summary?.recent_evaluated || 0} runs</p>
                </div>
                <div className="p-3 rounded-lg border border-border/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Bug className="h-4 w-4 text-red-700" />
                    <span className="text-xs font-medium">Open Critical Bugs</span>
                  </div>
                  <p className="text-2xl font-display font-bold text-red-700">{(signals.open_critical_bugs || []).length}</p>
                  {(signals.open_critical_bugs || []).slice(0, 3).map((b: any) => (
                    <p key={b.key} className="text-xs text-muted-foreground truncate">{b.key}: {b.summary}</p>
                  ))}
                </div>
                <div className="p-3 rounded-lg border border-border/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-[var(--color-warning)]" />
                    <span className="text-xs font-medium">Security Findings</span>
                  </div>
                  <p className="text-2xl font-display font-bold text-[var(--color-warning)]">{signals.unresolved_security_findings || 0}</p>
                  <p className="text-xs text-muted-foreground">unresolved</p>
                </div>
                <div className="p-3 rounded-lg border border-border/30">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown className="h-4 w-4 text-amber-700" />
                    <span className="text-xs font-medium">Confidence</span>
                  </div>
                  <p className="text-2xl font-display font-bold text-amber-700">{Math.round((verdict?.confidence || 0) * 100)}%</p>
                  <p className="text-xs text-muted-foreground">AI verdict confidence</p>
                </div>
              </div>
            </div>

            {result.errors?.length > 0 && (
              <div className="p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                <p className="text-xs font-medium text-amber-700 mb-2">Warnings (partial data)</p>
                {result.errors.map((e: string, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground">• {e}</p>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </PageShell>
  );
}
