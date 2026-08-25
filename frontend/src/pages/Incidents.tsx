import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon, CheckCircle, Clock, ChevronDown, ChevronRight, FileText,
  Loader2, RefreshCw, Target, ShieldAlert, Lightbulb, Plus, X, Info,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";

// ─── What this module does ───────────────────────────────────────────────────
// Incident Intelligence tracks production data quality incidents.
// When an anomaly is detected (in Monitoring), you create an incident here.
// The AI runs Root Cause Analysis (RCA) automatically and gives you:
//   • Most likely root cause
//   • Supporting evidence
//   • Immediate action to take
//   • Prevention steps
// You can then resolve the incident and generate a structured post-mortem report.
//
// Incidents require MongoDB to be running (see MONGODB_URI in backend .env).

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ElementType }> = {
  investigating: { color: "text-[var(--color-warning)]", bg: "bg-[var(--color-warning-bg)]", border: "border-[var(--color-status-warning)]/30", icon: Clock },
  identified: { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", icon: Target },
  resolved: { color: "text-positive", bg: "bg-positive/10", border: "border-positive/25", icon: CheckCircle },
};

const DIMENSIONS = ["completeness", "uniqueness", "validity", "consistency", "performance", "general"];

// ─── New Incident Modal ───────────────────────────────────────────────────────

function NewIncidentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dimension, setDimension] = useState("general");
  const [severity, setSeverity] = useState<"critical" | "warning">("warning");
  const [recentCommits, setRecentCommits] = useState("");

  const createMutation = useMutation({
    mutationFn: () => {
      const anomaly = {
        dimension,
        severity,
        value: 0,
        drop: 0,
        z_score: 0,
        date: new Date().toISOString().slice(0, 10),
        description,
      };
      const commits = recentCommits
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      return api.createIncident({ anomaly, title, recent_commits: commits });
    },
    onSuccess: () => {
      toast({ title: "Incident created", description: "AI RCA is running. Open the incident to view results." });
      onCreated();
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || err?.message || "Unknown error";
      toast({
        title: "Failed to create incident",
        description: msg.includes("DNS") || msg.includes("MongoDB")
          ? "MongoDB is not running. Start it with: docker run -d --name mongodb -p 27017:27017 mongo:7"
          : msg,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg"
      >
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-5 w-5 text-red-700" />
            <h2 className="font-display font-semibold">Create Incident</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Incident Title <span className="text-red-700">*</span></label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g. "Orders table completeness dropped 18% overnight"'
              className="bg-muted/30 border-border/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Affected Dimension</label>
              <select
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
                className="w-full h-9 px-3 text-sm rounded-md border border-border/50 bg-muted/30 text-foreground"
              >
                {DIMENSIONS.map((d) => (
                  <option key={d} value={d} className="capitalize">{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "critical" | "warning")}
                className="w-full h-9 px-3 text-sm rounded-md border border-border/50 bg-muted/30 text-foreground"
              >
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              What happened? <span className="text-muted-foreground">(describe the issue AI uses this for RCA)</span>
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"Describe the anomaly:\n- Which dataset / table?\n- What metric dropped / spiked?\n- When did it start?\n- Any known upstream changes?"}
              rows={4}
              className="bg-muted/30 border-border/50 resize-none text-xs"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Recent commits / deploys <span className="text-muted-foreground">(optional, one per line)</span>
            </label>
            <Textarea
              value={recentCommits}
              onChange={(e) => setRecentCommits(e.target.value)}
              placeholder={"fix: update ETL pipeline batch size\nchore: bump dbt version to 1.7\ndeploy: prod release v2.3.1"}
              rows={3}
              className="bg-muted/30 border-border/50 resize-none font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 pb-5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || createMutation.isPending}
            className="bg-primary text-primary-foreground"
          >
            {createMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running AI RCA…</>
              : <><AlertOctagon className="h-4 w-4 mr-2" />Create & Investigate</>}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Incident Card ────────────────────────────────────────────────────────────

function IncidentCard({ incident }: { incident: any }) {
  const [expanded, setExpanded] = useState(false);
  const [postmortem, setPostmortem] = useState<any>(null);
  const queryClient = useQueryClient();

  const resolveMutation = useMutation({
    mutationFn: () => api.resolveIncident(incident.id, "Resolved via UI"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });

  const postmortemMutation = useMutation({
    mutationFn: () => api.generatePostmortem(incident.id),
    onSuccess: (data) => setPostmortem(data),
  });

  const cfg = STATUS_CONFIG[incident.status] || STATUS_CONFIG.investigating;
  const Icon = cfg.icon;

  return (
    <div className="floating-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`h-8 w-8 rounded-lg ${cfg.bg} border ${cfg.border} flex items-center justify-center shrink-0`}>
            <Icon className={`h-4 w-4 ${cfg.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-medium text-sm">{incident.title}</span>
              <Badge variant="outline" className={`text-[10px] ${cfg.color} ${cfg.border} shrink-0`}>
                {incident.status}
              </Badge>
              {incident.anomaly?.dimension && incident.anomaly.dimension !== "general" && (
                <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                  {incident.anomaly.dimension}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{incident.id} · {new Date(incident.triggered_at).toLocaleString()}</p>
            {incident.root_cause && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{incident.root_cause}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {incident.status !== "resolved" && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => resolveMutation.mutate()}
              disabled={resolveMutation.isPending}
            >
              {resolveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Resolve"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
              {incident.root_cause && (
                <div className="p-3 rounded-lg bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">Root Cause</span>
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round((incident.confidence || 0) * 100)}% confidence
                    </Badge>
                  </div>
                  <p className="text-sm">{incident.root_cause}</p>
                </div>
              )}

              {incident.evidence?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Evidence</p>
                  <ul className="space-y-1">
                    {incident.evidence.map((e: string, i: number) => (
                      <li key={i} className="text-xs text-muted-foreground">• {e}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                {incident.immediate_action && (
                  <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <ShieldAlert className="h-3.5 w-3.5 text-red-700" />
                      <span className="text-xs font-medium text-red-700">Immediate Action</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{incident.immediate_action}</p>
                  </div>
                )}
                {incident.prevention_action && (
                  <div className="p-3 rounded-lg bg-positive/10 border border-primary/30/20">
                    <div className="flex items-center gap-2 mb-1">
                      <Lightbulb className="h-3.5 w-3.5 text-positive" />
                      <span className="text-xs font-medium text-positive">Prevention</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{incident.prevention_action}</p>
                  </div>
                )}
              </div>

              {incident.timeline?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Timeline</p>
                  <div className="space-y-2">
                    {incident.timeline.map((t: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 text-xs">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                        <div>
                          <span className="text-muted-foreground">{new Date(t.time).toLocaleTimeString()} </span>
                          <span>{t.event}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => postmortemMutation.mutate()}
                  disabled={postmortemMutation.isPending}
                >
                  {postmortemMutation.isPending
                    ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Generating…</>
                    : <><FileText className="h-3.5 w-3.5 mr-1" />Generate Post-mortem</>}
                </Button>
              </div>

              {postmortem && (
                <div className="p-4 rounded-lg bg-muted/10 border border-border/50 text-xs space-y-2">
                  <p className="font-medium text-sm">Post-Mortem Report</p>
                  <div className="grid md:grid-cols-2 gap-2">
                    <div><span className="text-muted-foreground">Triggered: </span>{new Date(postmortem.triggered_at).toLocaleString()}</div>
                    <div><span className="text-muted-foreground">Resolved: </span>{postmortem.resolved_at === "Ongoing" ? "Ongoing" : new Date(postmortem.resolved_at).toLocaleString()}</div>
                  </div>
                  <div><span className="text-muted-foreground">Root Cause: </span>{postmortem.root_cause}</div>
                  <div><span className="text-muted-foreground">Immediate Action: </span>{postmortem.immediate_action}</div>
                  <div><span className="text-muted-foreground">Prevention: </span>{postmortem.prevention_action}</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Incidents() {
  const [showNewModal, setShowNewModal] = useState(false);
  const queryClient = useQueryClient();

  const incidentsQuery = useQuery({
    queryKey: ["incidents"],
    queryFn: () => api.listIncidents(),
    retry: 1,
  });

  const incidents = (incidentsQuery.data || []) as any[];
  const active = incidents.filter((i) => i.status !== "resolved");
  const resolved = incidents.filter((i) => i.status === "resolved");

  const isMongoDown =
    incidentsQuery.isError &&
    (String((incidentsQuery.error as any)?.message).includes("Network") ||
      String((incidentsQuery.error as any)?.response?.status) === "500");

  return (
    <PageShell size="full" className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>

        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <PageHeader
            className="mb-0 flex-1"
            icon={AlertOctagon}
            title="Incident Intelligence"
            description="AI-powered root cause analysis for data quality and production incidents. Resolve and generate post-mortems."
          />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["incidents"] })}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground"
              onClick={() => setShowNewModal(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              New Incident
            </Button>
          </div>
        </div>

        {/* How it works */}
        <div className="page-card p-4 border-primary/20 mb-6">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><span className="text-foreground font-medium">How incidents work:</span> An incident captures a data quality or production problem and runs AI root cause analysis automatically.</p>
              <div className="flex items-center gap-2 text-[11px] mt-2 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-muted text-foreground">1. Detect anomaly</span>
                <ArrowRight className="h-3 w-3" />
                <span className="px-2 py-0.5 rounded bg-muted text-foreground">2. Create incident (AI runs RCA)</span>
                <ArrowRight className="h-3 w-3" />
                <span className="px-2 py-0.5 rounded bg-muted text-foreground">3. Investigate + fix</span>
                <ArrowRight className="h-3 w-3" />
                <span className="px-2 py-0.5 rounded bg-muted text-foreground">4. Resolve</span>
                <ArrowRight className="h-3 w-3" />
                <span className="px-2 py-0.5 rounded bg-muted text-foreground">5. Post-mortem</span>
              </div>
              <p className="mt-1">You can also create incidents directly from the <strong>Monitoring</strong> page when an anomaly is detected.</p>
            </div>
          </div>
        </div>

        {/* MongoDB error */}
        {isMongoDown && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            <p className="font-medium mb-1">Cannot connect to MongoDB</p>
            <p>Incidents are stored in MongoDB. Start it with:</p>
            <code className="block mt-2 text-xs bg-muted text-foreground px-3 py-2 rounded">
              docker run -d --name mongodb -p 27017:27017 mongo:7
            </code>
          </div>
        )}

        {/* Loading */}
        {incidentsQuery.isLoading && (
          <div className="flex items-center justify-center gap-3 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Loading incidents…</span>
          </div>
        )}

        {/* Empty state */}
        {!incidentsQuery.isLoading && !incidentsQuery.isError && incidents.length === 0 && (
          <div className="floating-card p-12 text-center">
            <AlertOctagon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm font-medium mb-1">No incidents yet</p>
            <p className="text-xs text-muted-foreground mb-4">
              Create your first incident using the <strong>"New Incident"</strong> button above, or go to <strong>Monitoring</strong> and click "Create Incident" on a detected anomaly.
            </p>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground"
              onClick={() => setShowNewModal(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Create First Incident
            </Button>
          </div>
        )}

        {/* Active incidents */}
        {active.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertOctagon className="h-4 w-4 text-red-700" />
              <p className="text-sm font-medium">Active ({active.length})</p>
            </div>
            <div className="space-y-3">
              {active.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
            </div>
          </div>
        )}

        {/* Resolved incidents */}
        {resolved.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3 mt-6">
              <CheckCircle className="h-4 w-4 text-positive" />
              <p className="text-sm font-medium">Resolved ({resolved.length})</p>
            </div>
            <div className="space-y-3">
              {resolved.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} />
              ))}
            </div>
          </div>
        )}

      </motion.div>

      {/* New Incident Modal */}
      <AnimatePresence>
        {showNewModal && (
          <NewIncidentModal
            onClose={() => setShowNewModal(false)}
            onCreated={() => queryClient.invalidateQueries({ queryKey: ["incidents"] })}
          />
        )}
      </AnimatePresence>
    </PageShell>
  );
}
