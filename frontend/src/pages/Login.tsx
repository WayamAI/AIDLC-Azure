import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

type Mode = "login" | "signup";

export default function Login() {
  const navigate = useNavigate();
  const {
    login,
    signup,
    loginDev,
    loginWithWorkos,
    workosEnabled,
    passwordAuthEnabled,
    devLoginEnabled,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (workosEnabled && mode === "login") {
      loginWithWorkos();
      return;
    }

    if (!passwordAuthEnabled && !devLoginEnabled) {
      setError("Authentication is not configured.");
      return;
    }

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (passwordAuthEnabled && !password.trim()) {
      setError("Password is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signup(email.trim(), password, name.trim() || undefined);
      } else if (passwordAuthEnabled) {
        await login(email.trim(), password);
      } else {
        await loginDev(email.trim());
      }
      navigate("/dashboard");
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (mode === "signup" ? "Could not create account." : "Invalid email or password.");
      setError(String(detail));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page px-4 py-10 sm:py-14">
      <div className="absolute right-4 top-4 z-30">
        <ThemeToggle />
      </div>

      <div className="login-ambient" aria-hidden>
        <div className="login-wash" />
        <div className="login-orb login-orb--a" />
        <div className="login-orb login-orb--b" />
        <div className="login-orb login-orb--c" />
        <div className="login-grid" />
        <div className="login-flow login-flow--a" />
        <div className="login-flow login-flow--b" />
        <div className="login-flow login-flow--c" />
        <div className="login-sheen" />
      </div>

      <section className="login-enter relative z-10 w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-raised/90 shadow-[0_28px_80px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <div className="border-b border-border px-8 py-10 sm:px-12 sm:py-12">
          <div className="flex flex-col gap-4">
            <BrandLogo className="h-28 w-auto max-w-[420px] sm:h-32 sm:max-w-[460px]" />
            <p className="text-sm text-quaternary">{BRAND_TAGLINE}</p>
          </div>
        </div>

        <div className="px-8 py-8 sm:px-12 sm:py-10">
          <div className="mb-5 flex rounded-lg border border-border bg-page p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === "login"
                  ? "bg-raised text-[var(--color-primary)] shadow-sm"
                  : "text-quaternary hover:text-secondary"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === "signup"
                  ? "bg-raised text-[var(--color-primary)] shadow-sm"
                  : "text-quaternary hover:text-secondary"
              }`}
            >
              Sign up
            </button>
          </div>

          <h1 className="font-display text-2xl tracking-tight text-[var(--color-primary)]">
            {mode === "signup" ? "Create your workspace" : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-tertiary)]">
            {workosEnabled && mode === "login"
              ? `Continue with WorkOS to access ${BRAND_NAME}.`
              : `Use your ${BRAND_NAME} email and password. Accounts are stored in MongoDB.`}
          </p>

          {error && (
            <p className="mt-4 rounded-lg border border-[var(--color-status-critical)]/40 bg-[var(--color-error-bg)] px-3 py-2 text-sm text-[var(--color-error)]">
              {error}
            </p>
          )}

          {workosEnabled && mode === "login" ? (
            <button
              type="button"
              onClick={loginWithWorkos}
              className="mt-6 flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Continue with WorkOS
            </button>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              {mode === "signup" && (
                <div className="space-y-2">
                  <label htmlFor="name" className="block text-sm font-medium text-[var(--color-secondary)]">
                    Name
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-page px-3 text-sm text-[var(--color-primary)] outline-none placeholder:text-quaternary focus-visible:border-active"
                    placeholder="Mriganka Dey"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium text-[var(--color-secondary)]">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-page px-3 text-sm text-[var(--color-primary)] outline-none placeholder:text-quaternary focus-visible:border-active"
                  placeholder="you@company.com"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium text-[var(--color-secondary)]">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    required={passwordAuthEnabled}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-page px-3 pr-10 text-sm text-[var(--color-primary)] outline-none placeholder:text-quaternary focus-visible:border-active"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-quaternary hover:text-secondary"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting
                  ? mode === "signup"
                    ? "Creating account…"
                    : "Signing in…"
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
