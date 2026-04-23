import { useEffect } from "react";
import { useIdentStore } from "../data/store";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Applies the resolved theme to `<html data-theme>`. Call once near the top of
 * the component tree. Re-runs when the user changes settings.theme or when the
 * OS theme changes while settings.theme === "system".
 */
export function useAppliedTheme(): void {
  const theme = useIdentStore((s) => s.settings.theme);

  useEffect(() => {
    const root = document.documentElement;
    const mql =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(DARK_QUERY)
        : null;

    function apply(): void {
      const resolved =
        theme === "system" ? (mql?.matches ? "dark" : "light") : theme;
      if (resolved === "dark") {
        root.setAttribute("data-theme", "dark");
      } else {
        root.removeAttribute("data-theme");
      }
    }

    apply();
    if (theme !== "system" || !mql) return;

    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [theme]);
}
