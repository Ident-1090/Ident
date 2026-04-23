import { Search } from "lucide-react";
import { useIdentStore } from "../data/store";
import { Kbd } from "../ui/Kbd";

interface Props {
  onOpenOmnibox: () => void;
}

// Sticky rail-top trigger. Displays the current search query or a placeholder
// and opens the omnibox on click. The Cmd/Ctrl+K shortcut is owned by App so
// it works regardless of which element has focus.
export function SearchBox({ onOpenOmnibox }: Props) {
  const query = useIdentStore((s) => s.search.query);

  const hasQuery = query.length > 0;

  return (
    <div className="flex-none sticky top-0 z-10 p-3 border-b border-(--color-line) bg-paper">
      <button
        type="button"
        onClick={onOpenOmnibox}
        aria-label="Open search"
        className="w-full flex items-center gap-2 bg-paper-2 border border-(--color-line) rounded-sm px-2.5 py-1.5 font-mono text-[12px] min-w-0 cursor-pointer text-left"
      >
        <Search
          className="w-3.25 h-3.25 text-ink-faint flex-none"
          strokeWidth={1.75}
        />
        <span
          className={
            "flex-1 min-w-0 truncate " +
            (hasQuery ? "text-(--color-ink)" : "text-ink-faint")
          }
        >
          {hasQuery ? query : "Callsign, hex, reg, squawk"}
        </span>
        <Kbd>⌘K</Kbd>
      </button>
    </div>
  );
}
