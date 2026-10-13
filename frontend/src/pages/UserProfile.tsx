import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Panel } from "@/components/imcc/Panel";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

interface ProfileSettings {
  name: string;
  email: string;
  notifications: boolean;
  newsletter: boolean;
}

const AVATAR_MAX_BYTES = 750_000;

const eyebrow = "font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-ink-quaternary";
const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

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
    <PageShell size="lg">
      <PageHeader title="Profile" description="Your name and avatar. Email comes from your sign-in account." />

      <form onSubmit={handleSave}>
        <Panel padded={false}>
          <h2 className={`${eyebrow} border-b border-stroke-muted px-4 py-3`}>Account</h2>
          <div className="space-y-4 p-4">
            <div>
              <Label htmlFor="avatar" className={fieldLabel}>
                Avatar <span className="font-normal text-ink-quaternary">(optional)</span>
              </Label>
              <div className="flex flex-wrap items-center gap-4">
                <Avatar className="h-14 w-14 border border-stroke-muted">
                  {avatarDataUrl ? (
                    <AvatarImage src={avatarDataUrl} alt="Avatar" />
                  ) : (
                    <AvatarFallback>{initials}</AvatarFallback>
                  )}
                </Avatar>
                <Input id="avatar" type="file" accept="image/*" onChange={handleFileChange} className="max-w-xs" />
                {avatarDataUrl && (
                  <Button type="button" variant="outline" onClick={resetAvatar}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-xs text-ink-tertiary">
                Stored on this device only. An image under 750 KB; it is not uploaded and does not appear in other
                browsers.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="name" className={fieldLabel}>
                  Full name
                </Label>
                <Input
                  id="name"
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="email" className={fieldLabel}>
                  Email
                </Label>
                <Input id="email" type="email" value={settings.email} disabled readOnly />
                <p className="mt-1.5 text-xs text-ink-tertiary">Email is tied to your sign-in account.</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t border-stroke-muted px-4 py-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </Panel>
      </form>
    </PageShell>
  );
}
