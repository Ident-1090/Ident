import { Fragment } from "react";

export function KvRow({
  k,
  v,
  emph,
}: {
  k: string;
  v: string;
  emph?: boolean;
}) {
  return (
    <Fragment>
      <dt className="text-[9.5px] uppercase tracking-[0.06em] text-ink-faint py-[3px]">
        {k}
      </dt>
      <dd
        className="m-0 text-[10.5px] text-(--color-ink) py-[3px] leading-snug break-words min-w-0"
        style={emph ? { color: "var(--color-emerg)" } : undefined}
      >
        {v}
      </dd>
    </Fragment>
  );
}

export function KvList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[86px_1fr] gap-x-[10px] gap-y-[2px] m-0 font-mono">
      {children}
    </dl>
  );
}
