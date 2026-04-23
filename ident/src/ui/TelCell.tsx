import type { ReactNode } from "react";

export type TelTone = "muted" | "good" | "warn";

// One cell of the inspector telemetry grid. Grid borders are controlled by
// `borderR`/`borderB` so the 2×3 layout wires up with adjacent cells.
export function TelCell({
  label,
  value,
  unit,
  hint,
  tone = "muted",
  emph,
  borderR,
  borderB,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: TelTone;
  emph?: boolean;
  borderR?: boolean;
  borderB?: boolean;
}) {
  const borders = [
    borderR ? "border-r border-(--color-line-soft)" : "",
    borderB ? "border-b border-(--color-line-soft)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const hintColor =
    tone === "good"
      ? "text-(--color-live)"
      : tone === "warn"
        ? "text-(--color-warn)"
        : "text-ink-faint";
  return (
    <div className={`px-3 py-2.5 min-w-0 ${borders}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest text-ink-faint mb-1">
        {label}
      </div>
      <div
        className="font-mono text-[17px] font-medium text-(--color-ink) leading-none tracking-[-0.01em] tabular-nums overflow-hidden text-ellipsis whitespace-nowrap"
        style={emph ? { color: "var(--color-emerg)" } : undefined}
      >
        {value}
        {unit && (
          <span className="font-mono text-[10.5px] text-ink-soft font-normal ml-[3px]">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <div
          className={`font-mono text-[10px] ${hintColor} mt-[5px] overflow-hidden text-ellipsis whitespace-nowrap`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
