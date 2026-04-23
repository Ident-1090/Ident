import type { CSSProperties, ReactNode } from "react";

// Translucent overlay panel shared by every map HUD. Positioning is owned by
// the map control host; this primitive only handles the chrome — bordered,
// rounded, blurred background — and the optional title.
export function HudCard({
  children,
  className,
  style,
  padding = "10px",
  rounded = "5px",
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  padding?: string;
  rounded?: string;
}) {
  return (
    <div
      className={`liquid-glass ${className ?? ""}`}
      style={{
        borderRadius: rounded,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function HudTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="m-0 mb-[6px] font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
      {children}
    </h4>
  );
}
