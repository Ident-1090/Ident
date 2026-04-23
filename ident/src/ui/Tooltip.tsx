import {
  type CSSProperties,
  cloneElement,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type TooltipSide = "top" | "top-end" | "right" | "bottom" | "left";

export function Tooltip({
  label,
  side = "top",
  children,
}: {
  label: string;
  side?: TooltipSide;
  children: ReactElement<TooltipChildProps>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const child = cloneElement(children, {
    "aria-describedby": open
      ? mergeDescribedBy(children.props["aria-describedby"], id)
      : children.props["aria-describedby"],
    onPointerEnter: (event) => {
      children.props.onPointerEnter?.(event);
      setOpen(true);
    },
    onPointerLeave: (event) => {
      children.props.onPointerLeave?.(event);
      setOpen(false);
    },
    onFocus: (event) => {
      children.props.onFocus?.(event);
      setOpen(true);
    },
    onBlur: (event) => {
      children.props.onBlur?.(event);
      setOpen(false);
    },
    onKeyDown: (event) => {
      children.props.onKeyDown?.(event);
      if (event.key === "Escape") setOpen(false);
    },
  });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    setStyle(tooltipStyle(anchor.getBoundingClientRect(), side));
  }, [open, side]);

  return (
    <span ref={anchorRef} className="relative inline-grid">
      {child}
      {open &&
        style &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={style}
            className="pointer-events-none fixed z-[70] whitespace-nowrap rounded-sm border border-(--color-line) bg-paper px-2 py-1 font-mono text-[10px] text-(--color-ink) shadow-sm"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

type TooltipChildProps = {
  "aria-describedby"?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

function mergeDescribedBy(current: string | undefined, id: string): string {
  return current && current.length > 0 ? `${current} ${id}` : id;
}

function tooltipStyle(rect: DOMRect, side: TooltipSide): CSSProperties {
  const gap = 8;
  switch (side) {
    case "top":
      return {
        left: rect.left + rect.width / 2,
        top: rect.top - gap,
        transform: "translate(-50%, -100%)",
      };
    case "top-end":
      return {
        left: rect.right,
        top: rect.top - gap,
        transform: "translate(-100%, -100%)",
      };
    case "right":
      return {
        left: rect.right + gap,
        top: rect.top + rect.height / 2,
        transform: "translateY(-50%)",
      };
    case "bottom":
      return {
        left: rect.left + rect.width / 2,
        top: rect.bottom + gap,
        transform: "translateX(-50%)",
      };
    case "left":
      return {
        left: rect.left - gap,
        top: rect.top + rect.height / 2,
        transform: "translate(-100%, -50%)",
      };
  }
}
