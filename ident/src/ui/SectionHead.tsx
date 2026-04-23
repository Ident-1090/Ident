import type { ReactNode } from "react";

// Small uppercase label used at the head of rail sections (Filters, Traffic)
// and drawer sections. Keeps only the typography in one place; callers control
// their own row layout since the right-edge contents vary (count+reset on
// Filters, count+sort controls on Traffic, plain title elsewhere).
export function SectionHead({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "h3" | "h4";
}) {
  return (
    <Tag
      className={
        "text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink-faint " +
        (className ?? "")
      }
    >
      {children}
    </Tag>
  );
}
