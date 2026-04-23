import type { Aircraft } from "../../data/types";

export function RawTab({ aircraft }: { aircraft: Aircraft }) {
  return (
    <pre className="m-0 font-mono text-[10px] leading-[1.5] text-ink-soft whitespace-pre overflow-auto">
      {JSON.stringify(aircraft, null, 2)}
    </pre>
  );
}
