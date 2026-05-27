const SIGNIFICANT_ALTITUDE_RANGE_FT = 150;
const CONTEXT_SAMPLES = 2;

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
