import { useEffect, useState } from "react";

/**
 * Reactive matchMedia hook. Returns `false` during SSR / when matchMedia is
 * unavailable (jsdom by default). Mirrors the guarded pattern used in
 * `useTheme.ts` so tests don't need to shim matchMedia to exercise the
 * non-mobile code path.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    function onChange(): void {
      setMatches(mql.matches);
    }
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export const PHONE_QUERY = "(max-width: 767px)";
