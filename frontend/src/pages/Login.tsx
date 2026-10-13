import { apiErrorMessage } from "@/lib/api-error";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { BRAND_NAME, BRAND_TAGLINE, LOGO_SRC } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";

const fieldLabel = "mb-1.5 block text-xs font-medium text-ink-secondary";

export default function Login() {
  const navigate = useNavigate();
  const {
    login,
    loginDev,
    loginWithWorkos,
    workosEnabled,
    passwordAuthEnabled,
    devLoginEnabled,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (workosEnabled) {
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
      if (passwordAuthEnabled) {
        await login(email.trim(), password);
      } else {
        await loginDev(email.trim());
      }
      navigate("/dashboard");
    } catch (err: unknown) {
      // Sign-in never says which part was wrong, including when the server rejects
      // the input's shape (422) before it checks the account.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 422) {
        setError("Invalid email or password.");
      } else {
        setError(apiErrorMessage(err, "Could not sign in."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const workosSignIn = workosEnabled;

  return (
    <main className="flex min-h-screen bg-page">
      {/* Brand panel: the generated hall scene, anchored left so the wheel stays in view.
          The scrim only darkens the lower edge so the headline stays readable. */}
      <aside className="relative hidden min-w-0 flex-[1.4] flex-col justify-between overflow-hidden bg-[var(--ref-gray-950)] p-10 lg:flex">
        <img
          src="/brand/login-hero.jpg"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-left"
        />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
        <img src={LOGO_SRC} alt={BRAND_NAME} className="relative h-9 w-auto self-start" />
        <div className="relative max-w-[46ch]">
          <p className="font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ref-gray-400)]">{BRAND_TAGLINE}</p>
          <p className="mt-2 font-display text-[28px] leading-tight text-white">From requirement to release, verified.</p>
          <p className="mt-3 text-sm text-[var(--ref-gray-300)]">
            Generated test suites, real browser runs and risk ranking for your team, in one workspace.
          </p>
        </div>
      </aside>

      <section className="flex min-h-screen w-full shrink-0 flex-col lg:w-[min(28rem,42%)]">
        <div className="flex items-center justify-between px-8 pt-6">
          <BrandLogo className="h-6 w-auto lg:invisible" />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 flex-col justify-center px-8 py-10">
          <h1 className="font-display text-[22px] font-normal leading-tight text-ink">
            Sign in
          </h1>
          <p className="mt-1.5 text-sm text-ink-tertiary">
            {workosSignIn
              ? `Continue with WorkOS to access ${BRAND_NAME}.`
              : `Use the ${BRAND_NAME} email and password you were given.`}
          </p>

          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}

          {workosSignIn ? (
            <Button type="button" onClick={loginWithWorkos} className="mt-6 w-full">
              Continue with WorkOS
            </Button>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              <div>
                <label htmlFor="email" className={fieldLabel}>
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>

              <div>
                <label htmlFor="password" className={fieldLabel}>
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required={passwordAuthEnabled}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-quaternary transition-colors hover:text-ink-secondary"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
