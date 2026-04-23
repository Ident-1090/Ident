import { useEffect, useRef } from "react";
import { bearingDeg, haversineNm } from "../../data/derive";
import { useIdentStore } from "../../data/store";
import type { Aircraft, ReceiverJson } from "../../data/types";
import {
  airDistanceLabelFromNm,
  airSpeedLabelFromKnots,
  resolveUnitOverrides,
  temperatureLabelFromC,
} from "../../settings/format";
import { KvList, KvRow } from "../KvRow";
import { loadRouteForAircraft } from "../route";

const CATEGORY_LABELS: Record<string, string> = {
  A0: "No info",
  A1: "Light (<15t)",
  A2: "Small (15-75t)",
  A3: "Large (75-300t)",
  A4: "High-vortex",
  A5: "Heavy (>300t)",
  A6: "High performance",
  A7: "Rotorcraft",
  B1: "Glider",
  B2: "Balloon",
  B6: "UAV",
  B7: "Space",
  C1: "Emergency vehicle",
  C2: "Service vehicle",
};

function categoryText(cat: string | undefined): string {
  if (!cat) return "—";
  const label = CATEGORY_LABELS[cat];
  return label ? `${cat} · ${label}` : cat;
}

function pad3(n: number): string {
  return String(Math.round(n)).padStart(3, "0");
}

export function TelemetryTab({
  aircraft,
  receiver,
}: {
  aircraft: Aircraft;
  receiver: ReceiverJson | null;
}) {
  const callsign = aircraft.flight?.trim().toUpperCase() ?? "";
  const route = useIdentStore((s) =>
    callsign ? (s.routeByCallsign[callsign] ?? null) : null,
  );
  const settings = useIdentStore((s) => s.settings);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);

  // Only refetch when the identity-relevant fields change; using the whole
  // `aircraft` object would thrash the network on every telemetry tick.
  const aircraftRef = useRef(aircraft);
  aircraftRef.current = aircraft;
  const flight = aircraft.flight;
  const lat = aircraft.lat;
  const lon = aircraft.lon;
  // biome-ignore lint/correctness/useExhaustiveDependencies: flight/lat/lon are used as reactive triggers — the effect reads the full aircraft off the ref
  useEffect(() => {
    void loadRouteForAircraft(aircraftRef.current);
  }, [flight, lat, lon]);

  const ias =
    aircraft.ias != null
      ? airSpeedLabelFromKnots(aircraft.ias, units.horizontalSpeed)
      : "—";
  const tas =
    aircraft.tas != null
      ? airSpeedLabelFromKnots(aircraft.tas, units.horizontalSpeed)
      : "—";
  const mach = aircraft.mach != null ? `M${aircraft.mach.toFixed(2)}` : "M—";
  const selHdg =
    aircraft.nav_heading != null ? `${pad3(aircraft.nav_heading)}°` : "—";

  const windStr =
    aircraft.wd != null && aircraft.ws != null
      ? `${pad3(aircraft.wd)}° / ${airSpeedLabelFromKnots(aircraft.ws, units.horizontalSpeed)}`
      : "—";
  const oatStr =
    aircraft.oat != null
      ? temperatureLabelFromC(aircraft.oat, units.temperature)
      : "—";

  const position =
    aircraft.lat != null && aircraft.lon != null
      ? `${aircraft.lat.toFixed(4)}°, ${aircraft.lon.toFixed(4)}°`
      : "—";

  let fromRx = "—";
  if (receiver && aircraft.lat != null && aircraft.lon != null) {
    const d = haversineNm(
      receiver.lat,
      receiver.lon,
      aircraft.lat,
      aircraft.lon,
    );
    const b = bearingDeg(
      receiver.lat,
      receiver.lon,
      aircraft.lat,
      aircraft.lon,
    );
    fromRx = `${airDistanceLabelFromNm(d, units.distance)} · ${pad3(b)}°`;
  }

  return (
    <KvList>
      <KvRow k="Flight" v={aircraft.flight?.trim() || "—"} />
      <KvRow k="ICAO 24" v={aircraft.hex.toUpperCase()} />
      <KvRow k="Registration" v={aircraft.r || "—"} />
      <KvRow
        k="Aircraft"
        v={
          aircraft.t
            ? [aircraft.t, aircraft.desc].filter(Boolean).join(" · ")
            : "—"
        }
      />
      <KvRow k="Operator" v={aircraft.ownOp || "—"} />
      <KvRow k="Category" v={categoryText(aircraft.category)} />
      <KvRow k="Route" v={route?.route ?? "—"} />
      <KvRow k="Origin" v={route?.origin ?? "—"} />
      <KvRow k="Destination" v={route?.destination ?? "—"} />
      <KvRow k="IAS/TAS/Mach" v={`${ias} / ${tas} · ${mach}`} />
      <KvRow k="Sel heading" v={selHdg} />
      <KvRow k="Wind" v={windStr} />
      <KvRow k="OAT" v={oatStr} />
      <KvRow k="Position" v={position} />
      <KvRow k="From RX" v={fromRx} />
    </KvList>
  );
}
