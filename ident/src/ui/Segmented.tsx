import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

type Size = "sm" | "md" | "lg";
type Variant = "default" | "inverse";
type TooltipSide = NonNullable<Parameters<typeof Tooltip>[0]["side"]>;

// Shared container for a row of mutually-exclusive or multi-select buttons.
// `sm` = topbar's compact 22px control; `md` = settings-modal row; `lg` =
// mobile drawer's tall theme picker.
const WRAP: Record<Size, string> = {
  sm: "h-5.5 rounded-sm",
  md: "rounded-sm",
  lg: "rounded-[6px]",
};
const CELL: Record<Size, string> = {
  sm: "px-[8px] font-mono text-[10.5px] font-medium",
  md: "px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em]",
  lg: "h-11 gap-2 font-mono text-[11px]",
};
const TONE: Record<
  Variant,
  { active: string; inactive: string; wrap: string }
> = {
  default: {
    active: "bg-paper-2 text-(--color-ink)",
    inactive: "text-ink-soft hover:text-(--color-ink)",
    wrap: "border border-(--color-line)",
  },
  inverse: {
    active: "bg-(--color-ink) text-yellow",
    inactive:
      "bg-transparent text-gray-4 hover:bg-(--color-gray-1) hover:text-(--color-ink)",
    wrap: "border border-(--color-gray-2) bg-paper",
  },
};

export function Segmented({
  size = "sm",
  variant = "default",
  children,
  className,
}: {
  size?: Size;
  variant?: Variant;
  children: ReactNode;
  className?: string;
}) {
  const inner =
    size === "lg"
      ? "grid grid-cols-[repeat(auto-fit,minmax(0,1fr))]"
      : "inline-flex items-stretch";
  return (
    <div
      className={`${inner} ${WRAP[size]} ${TONE[variant].wrap} overflow-hidden [&>*:last-child]:border-r-0 [&>*:last-child>button]:border-r-0 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function SegButton({
  active,
  onClick,
  size = "sm",
  variant = "default",
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
  tooltip,
  tooltipSide = "top",
  children,
}: {
  active: boolean;
  onClick: () => void;
  "aria-label"?: string;
  size?: Size;
  variant?: Variant;
  "aria-pressed"?: boolean;
  tooltip?: string;
  tooltipSide?: TooltipSide;
  children: ReactNode;
}) {
  const t = TONE[variant];
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      className={`grid h-full w-full place-items-center border-r border-(--color-line) cursor-pointer ${CELL[size]} ${active ? t.active : t.inactive}`}
    >
      {children}
    </button>
  );

  if (tooltip == null) return button;
  return (
    <Tooltip label={tooltip} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
