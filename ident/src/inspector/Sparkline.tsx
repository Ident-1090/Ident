import { useIdentStore } from "../data/store";
import {
  altitudeLabelFromFeet,
  resolveUnitOverrides,
} from "../settings/format";

const VIEW_W = 320;
const VIEW_H = 46;
const PAD = 2;
const GRAD_ID = "ident-alt-spark-grad";
const SIGNIFICANT_ALTITUDE_RANGE_FT = 150;
const CONTEXT_SAMPLES = 2;
const LABEL_HALO_PROPS = {
  paintOrder: "stroke fill",
  stroke: "var(--color-paper)",
  strokeWidth: 3,
  strokeLinejoin: "round",
} as const;

type AltitudeWindowKind = "active" | "level";

export interface AltitudeWindow {
  kind: AltitudeWindowKind;
  samples: number[];
  startIndex: number;
  endIndex: number;
}

export function altitudeSparklineWindow(samples: number[]): AltitudeWindow {
  if (samples.length < 2) {
    return {
      kind: "level",
      samples,
      startIndex: 0,
      endIndex: Math.max(0, samples.length - 1),
    };
  }

  const mn = Math.min(...samples);
  const mx = Math.max(...samples);
  if (mx - mn < SIGNIFICANT_ALTITUDE_RANGE_FT) {
    return {
      kind: "level",
      samples: [samples[0], samples[samples.length - 1]],
      startIndex: 0,
      endIndex: samples.length - 1,
    };
  }

  const firstAltitude = samples[0];
  const lastAltitude = samples[samples.length - 1];
  const firstMovingIndex = samples.findIndex(
    (v) => Math.abs(v - firstAltitude) >= SIGNIFICANT_ALTITUDE_RANGE_FT,
  );
  let lastMovingIndex = -1;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i] - lastAltitude) >= SIGNIFICANT_ALTITUDE_RANGE_FT) {
      lastMovingIndex = i;
      break;
    }
  }

  if (firstMovingIndex < 0 || lastMovingIndex < 0) {
    return {
      kind: "active",
      samples,
      startIndex: 0,
      endIndex: samples.length - 1,
    };
  }

  const start = Math.max(0, firstMovingIndex - CONTEXT_SAMPLES);
  const end = Math.min(samples.length - 1, lastMovingIndex + CONTEXT_SAMPLES);
  return {
    kind: "active",
    samples: samples.slice(start, end + 1),
    startIndex: start,
    endIndex: end,
  };
}

export function altitudeSparklineWindowKind(
  samples: number[],
): "active" | "level" | "collecting" {
  if (samples.length < 2) return "collecting";
  return altitudeSparklineWindow(samples).kind;
}

export function AltitudeSparkline({
  samples,
  selectedAltitudeFt,
}: {
  samples: number[];
  selectedAltitudeFt?: number;
}) {
  const settings = useIdentStore((s) => s.settings);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);
  if (samples.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="block w-full h-[42px]"
        role="img"
        aria-label="Altitude sparkline, collecting samples"
      >
        <title>Altitude sparkline, collecting samples</title>
        <text
          x={VIEW_W / 2}
          y={VIEW_H / 2 + 3}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize="9"
          fill="var(--color-ink-faint)"
        >
          collecting samples…
        </text>
      </svg>
    );
  }

  const window = altitudeSparklineWindow(samples);
  const displaySamples = window.samples;
  const domainSamples =
    selectedAltitudeFt != null
      ? [...displaySamples, selectedAltitudeFt]
      : displaySamples;
  const rawMax = Math.max(...domainSamples);
  const rawMin = Math.min(...domainSamples);
  let mx = rawMax;
  let mn = rawMin;
  if (window.kind === "level" && rawMax - rawMin < 500) {
    const center = (rawMax + rawMin) / 2;
    mx = center + 250;
    mn = center - 250;
  }
  const range = Math.max(500, mx - mn);
  const sampleMax = Math.max(...displaySamples);
  const sampleMin = Math.min(...displaySamples);
  const selectedSide =
    selectedAltitudeFt == null
      ? null
      : selectedAltitudeFt > sampleMax
        ? "upper"
        : selectedAltitudeFt < sampleMin
          ? "lower"
          : "inside";
  const selectedLabel =
    selectedAltitudeFt != null
      ? altitudeLabelFromFeet(selectedAltitudeFt, units.altitude)
      : null;
  const upperLabel =
    selectedSide === "upper" && selectedLabel != null
      ? `ALT SEL ${selectedLabel}`
      : altitudeLabelFromFeet(mx, units.altitude);
  const lowerLabel =
    selectedSide === "lower" && selectedLabel != null
      ? `ALT SEL ${selectedLabel}`
      : altitudeLabelFromFeet(mn, units.altitude);

  const yForAltitude = (v: number): number =>
    VIEW_H - PAD - ((v - mn) / range) * (VIEW_H - 2 * PAD);
  const selectedY =
    selectedAltitudeFt != null ? yForAltitude(selectedAltitudeFt) : null;
  const plotX0 = PAD;
  const plotX1 = VIEW_W - PAD;
  const plotWidth = plotX1 - plotX0;
  let line = "";
  displaySamples.forEach((v, i) => {
    const x = plotX0 + (i / (displaySamples.length - 1)) * plotWidth;
    const y = yForAltitude(v);
    line += `${i === 0 ? "M " : " L "}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${line} L ${plotX1},${VIEW_H} L ${plotX0},${VIEW_H} Z`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block w-full h-[42px]"
      role="img"
      aria-label="Altitude sparkline"
      data-altitude-window={window.kind}
      data-sample-count={displaySamples.length}
    >
      <title>Altitude sparkline</title>
      <defs>
        <linearGradient id={GRAD_ID} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.35" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${GRAD_ID})`} />
      <path
        data-altitude-trace="barometric"
        d={line}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
      />
      <text
        data-altitude-bound="upper"
        x={PAD + 2}
        y={10}
        fontFamily="var(--font-mono)"
        fontSize="9.5"
        fill="var(--color-ink-faint)"
        {...LABEL_HALO_PROPS}
      >
        {upperLabel}
      </text>
      <text
        data-altitude-bound="lower"
        x={PAD + 2}
        y={VIEW_H - 4}
        fontFamily="var(--font-mono)"
        fontSize="9.5"
        fill="var(--color-ink-faint)"
        {...LABEL_HALO_PROPS}
      >
        {lowerLabel}
      </text>
      {selectedY != null && selectedLabel != null && (
        <g
          data-altitude-reference="selected"
          aria-label={`ALT SEL ${selectedLabel}`}
        >
          <line
            x1={plotX0}
            x2={plotX1}
            y1={selectedY}
            y2={selectedY}
            stroke="var(--color-ink-soft)"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity="0.85"
          />
          {selectedSide === "inside" && (
            <text
              x={VIEW_W / 2}
              y={Math.max(8, selectedY - 3)}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="9.5"
              fill="var(--color-ink-soft)"
              {...LABEL_HALO_PROPS}
            >
              ALT SEL
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

export function RssiBarSpark({ samples }: { samples: number[] }) {
  if (samples.length === 0) {
    return (
      <div className="h-[36px] flex items-center font-mono text-[10px] text-ink-faint">
        collecting samples…
      </div>
    );
  }
  // Typical RSSI range is roughly -45..-5 dBFS. Map linearly to 8-100% bar height.
  const RSSI_MIN = -45;
  const RSSI_MAX = -5;
  const bars = samples.map((v) => {
    const norm = (v - RSSI_MIN) / (RSSI_MAX - RSSI_MIN);
    return Math.max(8, Math.min(100, norm * 100));
  });
  return (
    <div className="flex items-end gap-0.5 h-[36px]">
      {bars.map((h, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-slot sparkline — each index is a stable visual position, samples array shifts by time
          key={i}
          className="flex-1 bg-(--color-accent) rounded-[1px]"
          style={{ height: `${h}%`, opacity: 0.4 + h / 200 }}
        />
      ))}
    </div>
  );
}
