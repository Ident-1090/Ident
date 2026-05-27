import { useMemo } from "react";
import { match, P } from "ts-pattern";
import { useFrontendDiagnosticsSnapshot } from "../data/frontendDiagnostics";
import type { StatusStatKey } from "../data/preferences";
import { usePreferencesStore } from "../data/preferences";
import { useIdentStore } from "../data/store";
import type {
  IdentDiagnostic,
  IdentStatusValue,
  IdentUnavailableReason,
  ReceiverStats,
} from "../data/types";

export interface DiagnosticCell {
  id: StatusStatKey;
  k: string;
  v: string;
  title?: string;
  warn?: boolean;
}

interface ReceiverDiagnostics {
  cells: DiagnosticCell[];
  hiddenCells: DiagnosticCell[];
  allCells: DiagnosticCell[];
  producerLabel: string;
  diagnostics: IdentDiagnostic[];
}

const STATUS_STAT_LABELS: Record<StatusStatKey, string> = {
  gain: "Gain",
  uptime: "Uptime",
  maxRange: "Max Range",
  signal: "Signal",
  noise: "Noise",
  strong: "Strong",
  drops: "Drops",
  cpu: "CPU",
  ram: "RAM",
};

const UNAVAILABLE_REASON_LABEL: Record<IdentUnavailableReason, string> = {
  awaiting_classification: "Awaiting upstream classification",
  awaiting_second_sample: "Awaiting second counter sample",
  clock_not_advanced: "Counter timestamp did not advance",
  counter_reset: "Counter reset",
  malformed_file: "Malformed upstream file",
  not_provided_by_producer: "Not provided by upstream",
  producer_changed: "Upstream producer changed",
  stale_sample: "Counter sample is stale",
};

export function useReceiverDiagnostics(): ReceiverDiagnostics {
  const identStatus = useIdentStore((s) => s.identStatus);
  const capabilities = useIdentStore((s) => s.capabilities?.capabilities);
  const statusStats = usePreferencesStore((s) => s.statusStats);
  const backendDiagnostics = useIdentStore((s) => s.diagnostics);
  const frontendDiagnostics = useFrontendDiagnosticsSnapshot();
  // Merge backend + frontend diagnostics into one list sorted newest-first.
  // Frontend codes live under a `frontend.*` channel namespace so identity
  // collisions with backend codes are impossible — straight concat is safe.
  const diagnostics = useMemo(
    () =>
      [...backendDiagnostics, ...frontendDiagnostics].sort(
        (a, b) => b.seenAtEpochMs - a.seenAtEpochMs,
      ),
    [backendDiagnostics, frontendDiagnostics],
  );

  const normalizedGain = presentStatusValue(identStatus?.gain)?.db ?? null;
  const gainLabel =
    normalizedGain != null ? `${normalizedGain.toFixed(1)} dB` : "—";
  const gainTitle = unavailableTitle(
    unavailableStatusReason(identStatus?.gain),
  );

  const normalizedUptimeSec =
    presentStatusValue(identStatus?.uptime)?.sec ?? null;
  const uptimeLabel =
    normalizedUptimeSec != null ? formatUptime(normalizedUptimeSec) : "—";
  const uptimeTitle = unavailableTitle(
    unavailableStatusReason(identStatus?.uptime),
  );

  const normalizedMaxRange = presentStatusValue(identStatus?.maxRange);
  const rangeLabel =
    normalizedMaxRange?.scope === "last24h" ? "24h Range" : "Max Range";
  const rangeValue =
    normalizedMaxRange != null ? `${normalizedMaxRange.nm.toFixed(0)} NM` : "—";
  const rangeTitle = unavailableTitle(
    unavailableStatusReason(identStatus?.maxRange),
  );

  const capabilitiesEnvelope = useIdentStore((s) => s.capabilities);
  const producerKind = capabilitiesEnvelope?.producer?.kind ?? "unknown";
  const producerVer = capabilitiesEnvelope?.producer?.version
    ?.trim()
    .split(/\s+/)[0];
  const producerLabel = producerVer
    ? `${producerKind} ${producerVer}`
    : producerKind;

  const cellsById = new Map<StatusStatKey, DiagnosticCell>();
  if (capabilities?.gain !== "unavailable") {
    cellsById.set("gain", {
      id: "gain",
      k: STATUS_STAT_LABELS.gain,
      v: gainLabel,
      title: gainTitle,
    });
  }
  if (capabilities?.uptime !== "unavailable") {
    cellsById.set("uptime", {
      id: "uptime",
      k: STATUS_STAT_LABELS.uptime,
      v: uptimeLabel,
      title: uptimeTitle,
    });
  }
  if (capabilities?.maxRange !== "unavailable") {
    cellsById.set("maxRange", {
      id: "maxRange",
      k: rangeLabel,
      v: rangeValue,
      title: rangeTitle,
    });
  }
  addReceiverStatCells(cellsById, identStatus?.stats ?? null);
  const ordered = statusStats.order.flatMap((key) => {
    const cell = cellsById.get(key);
    return cell ? [cell] : [];
  });
  const hidden = new Set(statusStats.hidden);
  const cells = ordered.filter((cell) => !hidden.has(cell.id));
  const hiddenCells = ordered.filter((cell) => hidden.has(cell.id));
  return { cells, hiddenCells, allCells: ordered, producerLabel, diagnostics };
}

function presentStatusValue<TValue, TSource extends string>(
  value: IdentStatusValue<TValue, TSource> | undefined,
): TValue | null {
  return match(value)
    .with(P.nullish, () => null)
    .with({ kind: "unavailable" }, () => null)
    .with({ kind: "producer_provided" }, (v) => v.value)
    .with({ kind: "ident_derived" }, (v) => v.value)
    .otherwise(() => null);
}

function unavailableStatusReason<TValue, TSource extends string>(
  value: IdentStatusValue<TValue, TSource> | undefined,
): IdentUnavailableReason | null {
  return match(value)
    .with({ kind: "unavailable" }, (v) => v.reason)
    .otherwise(() => null);
}

function unavailableTitle(
  reason: IdentUnavailableReason | null,
): string | undefined {
  return reason == null ? undefined : UNAVAILABLE_REASON_LABEL[reason];
}

function addReceiverStatCells(
  cellsById: Map<StatusStatKey, DiagnosticCell>,
  stats: ReceiverStats | null,
): void {
  if (!stats) return;
  const strong = presentStatusValue(stats.strongPct);
  const drops = presentStatusValue(stats.sampleDrops);
  const cpu = presentStatusValue(stats.cpuPct);
  const ram = presentStatusValue(stats.ramPct);
  addStatCell(
    cellsById,
    "signal",
    formatReceiverMetric(stats.signalDbfs, formatDbfs),
    { title: unavailableTitle(unavailableStatusReason(stats.signalDbfs)) },
  );
  addStatCell(
    cellsById,
    "noise",
    formatReceiverMetric(stats.noiseDbfs, formatDbfs),
    { title: unavailableTitle(unavailableStatusReason(stats.noiseDbfs)) },
  );
  addStatCell(
    cellsById,
    "strong",
    formatReceiverMetric(stats.strongPct, formatPercent),
    {
      title: unavailableTitle(unavailableStatusReason(stats.strongPct)),
      warn: typeof strong === "number" && strong >= 10,
    },
  );
  addStatCell(
    cellsById,
    "drops",
    formatReceiverMetric(stats.sampleDrops, (value) =>
      String(Math.max(0, Math.round(value))),
    ),
    {
      title: unavailableTitle(unavailableStatusReason(stats.sampleDrops)),
      warn: typeof drops === "number" && drops > 0,
    },
  );
  addStatCell(
    cellsById,
    "cpu",
    formatReceiverMetric(stats.cpuPct, (value) => formatPercent(value, 0)),
    {
      title: unavailableTitle(unavailableStatusReason(stats.cpuPct)),
      warn: typeof cpu === "number" && cpu >= 85,
    },
  );
  addStatCell(
    cellsById,
    "ram",
    formatReceiverMetric(stats.ramPct, (value) => formatPercent(value, 0)),
    {
      title: unavailableTitle(unavailableStatusReason(stats.ramPct)),
      warn: typeof ram === "number" && ram >= 90,
    },
  );
}

function formatReceiverMetric<TSource extends string>(
  metric: IdentStatusValue<number, TSource> | undefined,
  format: (value: number) => string | null,
): string | null {
  if (!metric) return null;
  if (metric.kind === "unavailable") {
    return "—";
  }
  return format(metric.value);
}

function addStatCell(
  cellsById: Map<StatusStatKey, DiagnosticCell>,
  id: StatusStatKey,
  value: string | null,
  options: Pick<DiagnosticCell, "warn" | "title"> = {},
): void {
  if (value == null) return;
  cellsById.set(id, {
    id,
    k: STATUS_STAT_LABELS[id],
    v: value,
    ...options,
  });
}

function formatDbfs(value: number | null | undefined): string | null {
  return typeof value === "number" ? `${value.toFixed(1)} dBFS` : null;
}

function formatPercent(
  value: number | null | undefined,
  digits = 1,
): string | null {
  return typeof value === "number" ? `${value.toFixed(digits)}%` : null;
}

function formatUptime(totalSec: number): string {
  if (totalSec < 60) return `${Math.floor(totalSec)}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
