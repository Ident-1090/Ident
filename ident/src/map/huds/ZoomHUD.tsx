import { useMap } from "../MapEngine";

const ZOOM_DURATION_MS = 200;

export function ZoomHUD() {
  const { map, isReady } = useMap();
  if (!isReady || !map) return null;

  const btnClass =
    "w-7.5 h-7.5 grid place-items-center text-(--color-ink) " +
    "font-mono text-[14px] font-normal cursor-pointer";

  return (
    <div className="liquid-glass flex flex-col rounded-sm overflow-hidden">
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => map.zoomIn({ duration: ZOOM_DURATION_MS })}
        className={`${btnClass} border-b border-[rgb(from_var(--color-ink)_r_g_b/0.1)]`}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => map.zoomOut({ duration: ZOOM_DURATION_MS })}
        className={btnClass}
      >
        −
      </button>
    </div>
  );
}
