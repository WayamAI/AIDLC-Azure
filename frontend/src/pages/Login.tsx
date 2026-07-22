import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { LoginVideoProvider, LoginVideoSurface } from "@/components/LoginHeroVideo";
import { BRAND_NAME, BRAND_TAGLINE, LOGO_ICON_SRC, LOGO_SRC } from "@/lib/brand";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    window.setTimeout(() => {
      login();
      navigate("/dashboard");
    }, 400);
  };

  return (
    <LoginVideoProvider>
      <main className="login-shell login-shell--video relative flex min-h-screen items-center justify-center overflow-hidden px-1.5 py-2 sm:px-2 sm:py-3">
      {/* Full-page ambient video */}
      <LoginVideoSurface variant="backdrop" className="z-0" />
      <div className="absolute inset-0 z-[1] bg-gradient-to-b from-orange-950/20 via-orange-950/10 to-orange-950/30" aria-hidden="true" />

      <section className="modern-shadow login-enter relative z-10 w-full max-w-[440px] overflow-hidden rounded-[1.25rem] border border-white/70 bg-white lg:max-w-[980px] 2xl:max-w-[1240px]">
        <div className="grid gap-3 p-3 lg:min-h-[540px] lg:grid-cols-[1.02fr_0.98fr] 2xl:min-h-[46rem]">
          {/* Hero panel seamless looping video */}
          <div className="relative h-[200px] overflow-hidden rounded-lg sm:h-[260px] lg:h-auto lg:min-h-full">
            <LoginVideoSurface variant="hero" />
            <div className="absolute inset-0 bg-gradient-to-b from-orange-950/25 via-orange-950/10 to-orange-950/80" />

            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4 sm:p-6">
              <img src={LOGO_ICON_SRC} alt="" className="h-10 w-10 object-contain drop-shadow-md" />
              <span className="text-sm font-semibold tracking-wide text-white/90 drop-shadow-sm">
                {BRAND_NAME}
              </span>
            </div>

            <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6 lg:p-8">
              <p className="hidden text-sm font-medium text-orange-100 sm:block drop-shadow-sm">
                {BRAND_TAGLINE}
              </p>
              <h1 className="mt-2 max-w-sm text-lg font-semibold leading-tight tracking-[-0.04em] text-white drop-shadow-md sm:text-2xl lg:text-3xl">
                Every great release begins with intelligent quality.
              </h1>
            </div>
          </div>

          {/* Form panel */}
          <div className="flex items-center justify-center px-2 py-5 sm:px-6 sm:py-6 lg:py-4">
            <div className="login-enter w-full max-w-[400px] 2xl:max-w-[440px]">
              <img src={LOGO_SRC} alt={BRAND_NAME} className="mb-6 h-8 w-auto max-w-[180px] object-contain object-left" />
              <p className="text-xs font-medium text-primary">Sign in</p>
              <h2 className="mt-1.5 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-[1.9rem]">
                Welcome back
              </h2>
              <p className="mt-2.5 text-[13px] leading-6 text-slate-600">
                Use your email and password to access your {BRAND_NAME} workspace.
              </p>

              <form className="mt-6 space-y-3.5" onSubmit={handleSubmit} noValidate>
                <div className="space-y-2">
                  <label htmlFor="email" className="block text-[13px] font-medium text-slate-700">
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
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-[4px] focus:ring-orange-100"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="block text-[13px] font-medium text-slate-700">
                      Password
                    </label>
                    <a
                      href="#"
                      className="text-[12px] font-medium text-primary transition hover:text-[#DC440C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      onClick={(e) => e.preventDefault()}
                    >
                      Forgot password?
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-primary focus:bg-white focus:ring-[4px] focus:ring-orange-100"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>

                <label className="flex cursor-pointer select-none items-center gap-2.5 text-[12px] text-slate-600">
                  <input
                    type="checkbox"
                    name="remember"
                    className="size-4 rounded border-slate-300 accent-[#F0731A] focus:ring-orange-200"
                  />
                  Keep me signed in
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-gradient-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.99] disabled:opacity-70"
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <p className="mt-6 text-center text-[13px] text-slate-600">
                Don&apos;t have an account? Contact your administrator
              </p>
            </div>
          </div>
        </div>
      </section>
      </main>
    </LoginVideoProvider>
  );
}