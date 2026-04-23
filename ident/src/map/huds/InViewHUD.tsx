import { HudCard } from "../../ui/HudCard";

interface Props {
  /** Count of aircraft whose projected position falls within the visible SVG. */
  count: number;
}

export function InViewHUD({ count }: Props) {
  return (
    <HudCard
      rounded="4px"
      padding="6px 10px"
      className="font-mono text-[10.5px] text-(--color-ink) text-right"
    >
      <b className="block text-[14px] font-medium mb-[1px] text-(--color-ink) leading-none">
        {count}
      </b>
      <span className="text-ink-faint text-[9.5px] uppercase tracking-widest">
        In view
      </span>
    </HudCard>
  );
}
