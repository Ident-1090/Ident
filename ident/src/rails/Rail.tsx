import { FiltersPanel } from "./FiltersPanel";
import { SearchBox } from "./SearchBox";
import { TrafficList } from "./TrafficList";

interface Props {
  onOpenOmnibox: () => void;
}

export function Rail({ onOpenOmnibox }: Props) {
  return (
    <div className="[grid-area:left] h-full min-h-0 bg-paper border-r border-(--color-line) flex flex-col overflow-hidden">
      <SearchBox onOpenOmnibox={onOpenOmnibox} />
      <FiltersPanel />
      <TrafficList />
    </div>
  );
}
