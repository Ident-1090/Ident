import type { ThemeMode } from "../data/types";
import type { AltPaletteTone } from "./alt";
import { BASEMAPS, type BasemapId } from "./styles";

export function resolveThemeIsDark(theme: ThemeMode): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
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
