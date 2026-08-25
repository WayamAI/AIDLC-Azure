import React, { useEffect, useMemo, useState } from "react";
import { User } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PageCard } from "@/components/PageCard";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

interface ProfileSettings {
  name: string;
  email: string;
  notifications: boolean;
  newsletter: boolean;
}

const AVATAR_MAX_BYTES = 750_000;

function avatarKey(userId: string | undefined) {
  return userId ? `user_profile_avatar_${userId}` : "user_profile_avatar_dataurl";
}

export default function UserProfile() {
  const { user, refresh } = useAuth();
  const [settings, setSettings] = useState<ProfileSettings>({
    name: "",
    email: "",
    notifications: true,
    newsletter: false,
  });
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const initials = useMemo(() => {
    const parts = (settings.name || "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "U";
  }, [settings.name]);

  useEffect(() => {
    if (!user) return;
    setSettings({
      name: user.name || "",
      email: user.email || "",
      notifications: user.notifications !== false,
      newsletter: Boolean(user.newsletter),
    });
    try {
      const savedAvatar = localStorage.getItem(avatarKey(user.user_id));
      setAvatarDataUrl(savedAvatar);
    } catch {
      setAvatarDataUrl(null);
    }
  }, [user]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG/JPEG).");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("Avatar must be under 750 KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAvatarDataUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateMe({
        name: settings.name.trim(),
        notifications: settings.notifications,
        newsletter: settings.newsletter,
      });
      await refresh();
      if (avatarDataUrl) {
        localStorage.setItem(avatarKey(user?.user_id), avatarDataUrl);
      }
      toast.success("Profile saved");
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to save profile.";
      toast.error(String(detail));
    } finally {
      setSaving(false);
    }
  };

  const resetAvatar = () => {
    setAvatarDataUrl(null);
    localStorage.removeItem(avatarKey(user?.user_id));
  };

  return (
    <PageShell size="md" className="space-y-6">
      <PageHeader
        icon={User}
        title="Profile"
        description="Manage your workspace identity and notification preferences."
      />

      <form onSubmit={handleSave} className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <PageCard title="Profile" description="Basic details about you.">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16 ring-2 ring-white shadow-sm">
                {avatarDataUrl ? (
                  <AvatarImage src={avatarDataUrl} alt="Avatar" />
                ) : (
                  <AvatarFallback>{initials}</AvatarFallback>
                )}
              </Avatar>
              <div className="space-x-2">
                <Label htmlFor="avatar" className="sr-only">
                  Upload avatar
                </Label>
                <Input id="avatar" type="file" accept="image/*" onChange={handleFileChange} />
                {avatarDataUrl && (
                  <Button type="button" variant="secondary" onClick={resetAvatar} className="mt-2">
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                placeholder="Ada Lovelace"
                value={settings.name}
                onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="ada@example.com"
                value={settings.email}
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">Email is tied to your sign-in account.</p>
            </div>
          </div>
          <div className="mt-6 flex justify-end border-t border-border/40 pt-4">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </PageCard>

        <PageCard title="Settings" description="Personalise your experience.">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 p-4">
              <div>
                <p className="text-sm font-medium">Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Receive important updates about your tests and reports.
                </p>
              </div>
              <Switch
                checked={settings.notifications}
                onCheckedChange={(v) => setSettings({ ...settings, notifications: v })}
                aria-label="Toggle notifications"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 p-4">
              <div>
                <p className="text-sm font-medium">Monthly newsletter</p>
                <p className="text-sm text-muted-foreground">
                  Product updates, tips, and insights delivered monthly.
                </p>
              </div>
              <Switch
                checked={settings.newsletter}
                onCheckedChange={(v) => setSettings({ ...settings, newsletter: v })}
                aria-label="Toggle newsletter"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end border-t border-border/40 pt-4">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </PageCard>
      </form>
    </PageShell>
  );
}
