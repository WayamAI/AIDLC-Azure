import { useTheme } from "next-themes";

/** Monaco theme that follows the app theme. Default dark matches ThemeProvider. */
export function useMonacoTheme(): "vs-dark" | "light" {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? "light" : "vs-dark";
}

export function useIsDarkTheme(): boolean {
  const { resolvedTheme } = useTheme();
  return resolvedTheme !== "light";
}
