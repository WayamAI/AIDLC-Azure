import { useEffect, useState } from "react";
import { Cable, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ConnectorsPublic } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";

type SecretField = { configured?: boolean; masked?: string | null; source?: string };

function SecretInput({
  label,
  value,
  configured,
  masked,
  source,
  onChange,
}: {
  label: string;
  value: string;
  configured?: boolean;
  masked?: string | null;
  source?: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-[10px] text-muted-foreground">
          {configured ? `saved (${source || "org"}) ${masked || ""}` : "not set using env fallback"}
        </span>
      </div>
      <div className="relative">
        <Input
          type={show ? "text" : "password"}
          value={value}
          placeholder={configured ? "Leave blank to keep existing" : "Paste secret"}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
          autoComplete="off"
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide" : "Show"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function ConnectorsSettings() {
  const [data, setData] = useState<ConnectorsPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({
    github: { token: "", repo_id: "" },
    jira: { domain: "", email: "", token: "" },
    vercel: { token: "", team_id: "", project_id: "", project_name: "" },
    ollama: { base_url: "", api_key: "", model: "" },
    slack: { webhook_url: "" },
    datadog: { api_key: "", app_key: "" },
  });

  useEffect(() => {
    void api
      .getConnectors()
      .then((res) => {
        setData(res);
        setDraft({
          github: { token: "", repo_id: String(res.github?.repo_id || "") },
          jira: {
            token: "",
            domain: String(res.jira?.domain || ""),
            email: String(res.jira?.email || ""),
          },
          vercel: {
            token: "",
            team_id: String(res.vercel?.team_id || ""),
            project_id: String(res.vercel?.project_id || ""),
            project_name: String(res.vercel?.project_name || ""),
          },
          ollama: {
            api_key: "",
            base_url: String(res.ollama?.base_url || ""),
            model: String(res.ollama?.model || ""),
          },
          slack: { webhook_url: "" },
          datadog: { api_key: "", app_key: "" },
        });
      })
      .catch((e) => toast({ title: "Failed to load connectors", description: String(e), variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.putConnectors(draft);
      setData(next);
      setDraft((d) => ({
        ...d,
        github: { ...d.github, token: "" },
        jira: { ...d.jira, token: "" },
        vercel: { ...d.vercel, token: "" },
        ollama: { ...d.ollama, api_key: "" },
        slack: { webhook_url: "" },
        datadog: { api_key: "", app_key: "" },
      }));
      toast({ title: "Connectors saved", description: "Changes apply to this organization immediately." });
    } catch (e) {
      toast({ title: "Save failed", description: String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading connectors…
        </div>
      </PageShell>
    );
  }

  const ghToken = data?.github?.token as SecretField | undefined;
  const jiraToken = data?.jira?.token as SecretField | undefined;
  const vercelToken = data?.vercel?.token as SecretField | undefined;
  const ollamaKey = data?.ollama?.api_key as SecretField | undefined;
  const slackHook = data?.slack?.webhook_url as SecretField | undefined;
  const ddKey = data?.datadog?.api_key as SecretField | undefined;
  const ddApp = data?.datadog?.app_key as SecretField | undefined;

  return (
    <PageShell size="lg" className="space-y-6">
      <PageHeader
        icon={Cable}
        title="Connectors"
        description="Reconfigure GitHub, Jira, Vercel, Ollama, Slack, and Datadog for this org. Leave secrets blank to keep the current value. Env vars remain the fallback."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border bg-[var(--color-raised)] p-4">
          <h2 className="font-display text-sm tracking-wide">GitHub</h2>
          <SecretInput
            label="Token"
            value={draft.github.token}
            configured={ghToken?.configured}
            masked={ghToken?.masked}
            source={ghToken?.source}
            onChange={(v) => setDraft({ ...draft, github: { ...draft.github, token: v } })}
          />
          <div className="space-y-1.5">
            <Label>Default repo id</Label>
            <Input
              value={draft.github.repo_id}
              onChange={(e) => setDraft({ ...draft, github: { ...draft.github, repo_id: e.target.value } })}
              placeholder="owner/repo"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-[var(--color-raised)] p-4">
          <h2 className="font-display text-sm tracking-wide">Ollama</h2>
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={draft.ollama.base_url}
              onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, base_url: e.target.value } })}
              placeholder="https://ollama.com"
            />
          </div>
          <SecretInput
            label="API key"
            value={draft.ollama.api_key}
            configured={ollamaKey?.configured}
            masked={ollamaKey?.masked}
            source={ollamaKey?.source}
            onChange={(v) => setDraft({ ...draft, ollama: { ...draft.ollama, api_key: v } })}
          />
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input
              value={draft.ollama.model}
              onChange={(e) => setDraft({ ...draft, ollama: { ...draft.ollama, model: e.target.value } })}
              placeholder="kimi-k3:cloud"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-[var(--color-raised)] p-4">
          <h2 className="font-display text-sm tracking-wide">Jira</h2>
          <div className="space-y-1.5">
            <Label>Domain</Label>
            <Input
              value={draft.jira.domain}
              onChange={(e) => setDraft({ ...draft, jira: { ...draft.jira, domain: e.target.value } })}
              placeholder="your-org.atlassian.net"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              value={draft.jira.email}
              onChange={(e) => setDraft({ ...draft, jira: { ...draft.jira, email: e.target.value } })}
            />
          </div>
          <SecretInput
            label="API token"
            value={draft.jira.token}
            configured={jiraToken?.configured}
            masked={jiraToken?.masked}
            source={jiraToken?.source}
            onChange={(v) => setDraft({ ...draft, jira: { ...draft.jira, token: v } })}
          />
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-[var(--color-raised)] p-4">
          <h2 className="font-display text-sm tracking-wide">Vercel</h2>
          <SecretInput
            label="Token"
            value={draft.vercel.token}
            configured={vercelToken?.configured}
            masked={vercelToken?.masked}
            source={vercelToken?.source}
            onChange={(v) => setDraft({ ...draft, vercel: { ...draft.vercel, token: v } })}
          />
          <div className="space-y-1.5">
            <Label>Team ID</Label>
            <Input
              value={draft.vercel.team_id}
              onChange={(e) => setDraft({ ...draft, vercel: { ...draft.vercel, team_id: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Project ID</Label>
            <Input
              value={draft.vercel.project_id}
              onChange={(e) => setDraft({ ...draft, vercel: { ...draft.vercel, project_id: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Project name</Label>
            <Input
              value={draft.vercel.project_name}
              onChange={(e) => setDraft({ ...draft, vercel: { ...draft.vercel, project_name: e.target.value } })}
            />
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-[var(--color-raised)] p-4">
          <h2 className="font-display text-sm tracking-wide">Slack</h2>
          <SecretInput
            label="Webhook URL"
            value={draft.slack.webhook_url}
            configured={slackHook?.configured}
            masked={slackHook?.masked}
            source={slackHook?.source}
            onChange={(v) => setDraft({ ...draft, slack: { webhook_url: v } })}
          />
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-[var(--color-raised)] p-4">
          <h2 className="font-display text-sm tracking-wide">Datadog</h2>
          <SecretInput
            label="API key"
            value={draft.datadog.api_key}
            configured={ddKey?.configured}
            masked={ddKey?.masked}
            source={ddKey?.source}
            onChange={(v) => setDraft({ ...draft, datadog: { ...draft.datadog, api_key: v } })}
          />
          <SecretInput
            label="App key"
            value={draft.datadog.app_key}
            configured={ddApp?.configured}
            masked={ddApp?.masked}
            source={ddApp?.source}
            onChange={(v) => setDraft({ ...draft, datadog: { ...draft.datadog, app_key: v } })}
          />
        </section>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save connectors
        </Button>
      </div>
    </PageShell>
  );
}
