import type { ReactNode } from "react";

type Variant = "default" | "accent";

// Small outlined pill. Used for filter category toggles, the toggle chips
// below the altitude slider, and the active-filter readouts (accent variant).
export function Chip({
  active,
  onClick,
  variant = "default",
  leading,
  trailing,
  children,
  "aria-pressed": ariaPressed,
  "aria-label": ariaLabel,
}: {
  active?: boolean;
  onClick?: () => void;
  variant?: Variant;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  "aria-pressed"?: boolean;
  "aria-label"?: string;
}) {
  const layout =
    "font-mono text-[10.5px] px-[7px] py-[3px] rounded-[3px] border select-none inline-flex items-center gap-1.25";
  const tone =
    variant === "accent"
      ? "text-(--color-ink) pl-[8px] pr-[4px] gap-1.5"
      : active
        ? "bg-paper-2 text-(--color-ink) border-line-strong"
        : "bg-transparent text-ink-soft border-(--color-line)";
  const accentStyle =
    variant === "accent"
      ? {
          background:
            "color-mix(in oklab, var(--color-accent) 18%, var(--color-paper-2))",
          borderColor:
            "color-mix(in oklab, var(--color-accent) 40%, var(--color-line-strong))",
        }
      : undefined;

  const cls = `${layout} ${tone} ${onClick ? "cursor-pointer" : ""}`;

  if (!onClick) {
    return (
      <span
        className={cls}
        style={accentStyle}
        {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : {})}
      >
        {leading}
        {children}
        {trailing}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      className={cls}
      style={accentStyle}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
}

// Tiny colored dot for category chips.
export function ChipDot({ color }: { color: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full flex-none"
      style={{ background: color }}
    />
  );
}
