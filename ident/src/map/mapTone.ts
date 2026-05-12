import { useEffect, useState } from "react";
import type { ThemeMode } from "../data/types";
import type { AltPaletteTone } from "./alt";
import { BASEMAPS, type BasemapId } from "./styles";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveThemeIsDark(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia(DARK_QUERY).matches;
  }
  return false;
}

export function useThemeIsDark(theme: ThemeMode): boolean {
  const [systemIsDark, setSystemIsDark] = useState(() =>
    resolveThemeIsDark("system"),
  );

  useEffect(() => {
    if (theme !== "system") return;
    const mql =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(DARK_QUERY)
        : null;
    if (!mql) {
      setSystemIsDark(false);
      return;
    }

    const apply = (): void => setSystemIsDark(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [theme]);

  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemIsDark;
}

export function resolveBasemapTone(
  id: BasemapId | undefined,
  themeIsDark: boolean,
): AltPaletteTone {
  const effective: BasemapId = id ?? "ident";
  if (effective === "ident" || effective === "esriTerrain") {
    return themeIsDark ? "dark" : "light";
  }
  return BASEMAPS[effective]?.isDark ? "dark" : "light";
}
