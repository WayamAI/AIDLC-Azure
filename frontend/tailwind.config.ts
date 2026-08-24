import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/**
 * AIDLC Tailwind theme
 *
 * Prefer semantic tokens over raw palette colors:
 *   Surfaces  → bg-page | bg-container | bg-raised | bg-card
 *   Ink/text  → text-ink | text-ink-secondary | text-muted-foreground
 *               (text-primary ≈ ink in both themes; OK for accents)
 *   Actions   → bg-primary text-primary-foreground | bg-secondary …
 *   Status    → bg-status-* text-status-content
 *   Feedback  → text-success | bg-success/10 (quiet) not status pills
 *
 * Do NOT use text-secondary for muted copy shadcn secondary is a FILL.
 * Use text-ink-secondary or text-muted-foreground instead.
 */
export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        display: ['"Michroma"', "var(--font-display)", "sans-serif"],
        sans: ['"Geist"', '"Geist Sans"', "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ['"Geist"', '"Geist Sans"', "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(90deg, var(--brand-from) 0%, var(--brand-via) 50%, var(--brand-to) 100%)",
      },
      colors: {
        page: "var(--color-page)",
        container: "var(--color-container)",
        raised: "var(--color-raised)",
        "raised-2": "var(--color-raised-2)",
        action: "var(--color-action)",
        brand: {
          from: "var(--brand-from)",
          via: "var(--brand-via)",
          via2: "var(--brand-via-2)",
          to: "var(--brand-to)",
        },
        /* IMCC text hierarchy use these for copy, not shadcn secondary */
        ink: {
          DEFAULT: "hsl(var(--ink) / <alpha-value>)",
          secondary: "hsl(var(--ink-secondary) / <alpha-value>)",
          tertiary: "hsl(var(--ink-tertiary) / <alpha-value>)",
          quaternary: "hsl(var(--ink-quaternary) / <alpha-value>)",
          "on-color": "hsl(var(--ink-on-color) / <alpha-value>)",
        },
        stroke: {
          DEFAULT: "var(--color-stroke)",
          active: "var(--color-stroke-active)",
          muted: "var(--color-stroke-muted)",
        },
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
        },
        positive: {
          DEFAULT: "hsl(var(--positive) / <alpha-value>)",
          foreground: "hsl(var(--positive-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          foreground: "hsl(var(--info-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          primary: "hsl(var(--sidebar-primary) / <alpha-value>)",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          accent: "hsl(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
        },
        status: {
          critical: "var(--color-status-critical)",
          warning: "var(--color-status-warning)",
          success: "var(--color-status-success)",
          info: "var(--color-status-info)",
          pending: "var(--color-status-pending)",
          neutral: "var(--color-status-neutral)",
          content: "var(--color-status-content)",
        },
        feedback: {
          success: "var(--color-success)",
          warning: "var(--color-warning)",
          error: "var(--color-error)",
          info: "var(--color-info)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-accordion-content-height)", opacity: "1" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        "fade-in-up": "fade-in-up 0.6s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        float: "float 3s ease-in-out infinite",
        "scale-in": "scale-in 0.3s ease-out",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    typography,
    /*
     * Legacy IMCC names text-secondary/tertiary/quaternary → ink.
     * Do NOT remap text-primary: keep shadcn primary so text-primary/80 works
     * (primary ≈ ink in both themes). Prefer text-ink-* for new code.
     */
    plugin(({ addUtilities }) => {
      addUtilities({
        ".text-secondary": { color: "hsl(var(--ink-secondary))" },
        ".text-tertiary": { color: "hsl(var(--ink-tertiary))" },
        ".text-quaternary": { color: "hsl(var(--ink-quaternary))" },
      });
    }),
  ],
} satisfies Config;
