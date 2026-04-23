import type { DistanceUnit } from "../../data/types";
import { mapDistanceLabelFromNm } from "../../settings/format";
import { HudCard } from "../../ui/HudCard";

// Round-number ladder of nm values the scale bar snaps to. The chosen step is
// the largest value whose pixel width is at or below TARGET_BAR_PX, so the bar
// always reads as a tidy number.
const STEPS_NM = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000];
const TARGET_BAR_PX = 80;

interface Props {
  pxPerNm: number;
  distanceUnit: DistanceUnit;
}

export function ScaleHUD({ pxPerNm, distanceUnit }: Props) {
  if (!Number.isFinite(pxPerNm) || pxPerNm <= 0) return null;

  let stepNm = STEPS_NM[0];
  for (const candidate of STEPS_NM) {
    if (candidate * pxPerNm <= TARGET_BAR_PX) stepNm = candidate;
    else break;
  }
  const barPx = Math.round(stepNm * pxPerNm);

  return (
    <HudCard
      padding="6px 10px"
      className="flex items-center gap-2 font-mono text-[10.5px] text-ink-soft"
    >
      <span data-testid="scale-label">
        {mapDistanceLabelFromNm(stepNm, distanceUnit)}
      </span>
      {/* Two-tier tick bar: outer box is the full span, inner pseudo-element
          carves the bar in half with a mid tick. */}
      <div
        className="relative h-1.5 border border-(--color-ink-soft) border-t-0"
        style={{ width: `${barPx}px` }}
      >
        <div
          aria-hidden="true"
          className="absolute left-[-1px] top-[-1px] bottom-[-1px] w-[50%] border-l border-t border-(--color-ink-soft)"
        />
      </div>
    </HudCard>
  );
}
