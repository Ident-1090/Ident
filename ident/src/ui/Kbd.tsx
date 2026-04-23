import type { ReactNode } from "react";

type Tone = "faint" | "ink";

// Inline key-cap used in the rail trigger (⌘K) and omnibox footer (↑↓ ⏎ etc.).
// Deliberately a <span> so callers can drop it inside a button/flex row without
// interactive side-effects.
export function Kbd({
  children,
  tone = "faint",
  bg = true,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  bg?: boolean;
  className?: string;
}) {
  const color = tone === "ink" ? "text-(--color-ink)" : "text-ink-faint";
  const bgCls = bg ? "bg-paper" : "";
  return (
    <span
      className={
        `font-mono text-[10px] ${color} border border-(--color-line) rounded-xs px-1.25 py-px ${bgCls} flex-none ` +
        (className ?? "")
      }
    >
      {children}
    </span>
  );
}
