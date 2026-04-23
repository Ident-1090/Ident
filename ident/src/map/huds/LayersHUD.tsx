import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useState } from "react";
import { useIdentStore } from "../../data/store";
import type { LayerKey } from "../../data/types";
import { HudCard, HudTitle } from "../../ui/HudCard";

const LAYERS: Array<{
  key: LayerKey;
  label: string;
}> = [
  { key: "rangeRings", label: "Range rings" },
  { key: "rxRange", label: "Measured max range" },
  { key: "losRings", label: "Line-of-sight rings" },
  { key: "trails", label: "Trails" },
];

// Folded by default — the raw 14-row list was dominating the map's top-left
// corner. Expanded state is transient (per page load), not persisted.
export function LayersHUD() {
  const layers = useIdentStore((s) => s.map.layers);
  const toggle = useIdentStore((s) => s.toggleLayer);
  const [open, setOpen] = useState(false);

  const activeCount = Object.values(layers).filter(Boolean).length;

  if (!open) {
    return (
      <HudCard padding="6px 10px">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 font-mono text-[10.5px] text-ink-soft hover:text-(--color-ink) cursor-pointer bg-transparent border-0 p-0 leading-none"
          aria-expanded={false}
          aria-label={`Layers (${activeCount} active) — click to expand`}
        >
          <Layers size={12} strokeWidth={1.75} aria-hidden="true" />
          <span className="uppercase tracking-[0.12em] text-[9px]">Layers</span>
          <span className="text-ink-faint tabular-nums">{activeCount}</span>
          <ChevronRight size={11} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </HudCard>
    );
  }

  return (
    <HudCard className="min-w-[180px]">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="flex items-center gap-1.5 mb-[6px] font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint hover:text-(--color-ink) cursor-pointer bg-transparent border-0 p-0 w-full"
        aria-expanded={true}
      >
        <ChevronDown size={11} strokeWidth={1.75} aria-hidden="true" />
        <HudTitle>Layers</HudTitle>
      </button>
      <div className="flex flex-col">
        {LAYERS.map(({ key, label }) => {
          const on = layers[key];
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(key)}
              className="flex items-center gap-1.5 py-0.5 text-left font-mono text-[10.5px] text-ink-soft hover:text-(--color-ink) cursor-pointer select-none"
            >
              <span
                className={
                  "inline-block w-[12px] text-center " +
                  (on ? "text-(--color-accent)" : "text-ink-faint")
                }
              >
                {on ? "\u2713" : ""}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </HudCard>
  );
}
