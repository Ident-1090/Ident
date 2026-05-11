import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import type { ReactNode } from "react";
import { FiltersPanel } from "./FiltersPanel";
import { SearchBox } from "./SearchBox";
import { TrafficList } from "./TrafficList";

interface Props {
  onOpenOmnibox: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function Rail({ onOpenOmnibox, collapsed, onCollapsedChange }: Props) {
  if (collapsed) {
    return (
      <div
        className="[grid-area:left] h-full w-12 min-h-0 bg-paper border-r border-(--color-line) flex flex-col items-center gap-2 overflow-hidden py-3"
        data-rail-collapsed="true"
      >
        <RailIconButton
          label="Expand sidebar"
          onClick={() => onCollapsedChange(false)}
        >
          <PanelLeftOpen size={16} strokeWidth={1.8} aria-hidden="true" />
        </RailIconButton>
        <RailIconButton label="Open search" onClick={onOpenOmnibox}>
          <Search size={15} strokeWidth={1.8} aria-hidden="true" />
        </RailIconButton>
      </div>
    );
  }

  return (
    <div
      className="[grid-area:left] h-full min-h-0 bg-paper border-r border-(--color-line) flex flex-col overflow-hidden"
      data-rail-collapsed="false"
    >
      <SearchBox
        onOpenOmnibox={onOpenOmnibox}
        trailing={
          <RailIconButton
            label="Collapse sidebar"
            onClick={() => onCollapsedChange(true)}
          >
            <PanelLeftClose size={16} strokeWidth={1.8} aria-hidden="true" />
          </RailIconButton>
        }
      />
      <FiltersPanel />
      <TrafficList />
    </div>
  );
}

function RailIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-8 w-8 shrink-0 rounded-sm border border-(--color-line) bg-paper-2 text-(--color-ink) grid place-items-center cursor-pointer hover:bg-paper-3"
    >
      {children}
    </button>
  );
}
