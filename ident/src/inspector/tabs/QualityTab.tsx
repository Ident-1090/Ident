import { useIdentStore } from "../../data/store";
import type { Aircraft } from "../../data/types";
import {
  airDistanceLabelFromMeters,
  distanceMeaning,
  resolveUnitOverrides,
} from "../../settings/format";
import { KvList, KvRow } from "../KvRow";
import { aircraftSourceLabel } from "../source";

// Human-meaning lookup for ADS-B integrity fields.
const NIC_MEANING_M: Record<number, number> = {
  11: 7.5,
  10: 25,
  9: 75,
  8: 185.2,
  7: 370.4,
  6: 926,
  5: 1852,
  4: 3704,
};
const NACP_MEANING_M: Record<number, number> = {
  11: 3,
  10: 10,
  9: 30,
  8: 93,
  7: 185,
  6: 556,
};
const SIL_MEANING: Record<number, string> = {
  3: "1e-7/hr",
  2: "1e-5/hr",
  1: "1e-3/hr",
  0: "unknown",
};
const RC_FROM_NIC_M: Record<number, number> = {
  11: 7.5,
  10: 25,
  9: 75,
  8: 185,
  7: 370,
  6: 926,
  5: 1850,
};

function withMeaning(
  n: number | undefined,
  map: Record<number, string>,
): string {
  if (n == null) return "—";
  const m = map[n];
  return m ? `${n} (${m})` : String(n);
}

export function QualityTab({ aircraft }: { aircraft: Aircraft }) {
  const settings = useIdentStore((s) => s.settings);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);
  const version =
    aircraft.adsbVersion != null ? `v${aircraft.adsbVersion}` : "—";
  const nic = distanceMeaning(aircraft.nic, NIC_MEANING_M, units.distance);
  const nacp = distanceMeaning(aircraft.nacP, NACP_MEANING_M, units.distance);
  const sil = withMeaning(aircraft.sil, SIL_MEANING);
  const nicBaro = aircraft.nicBaro != null ? String(aircraft.nicBaro) : "—";
  const rc =
    aircraft.rcM != null
      ? airDistanceLabelFromMeters(aircraft.rcM, units.distance)
      : aircraft.nic != null && RC_FROM_NIC_M[aircraft.nic] != null
        ? airDistanceLabelFromMeters(
            RC_FROM_NIC_M[aircraft.nic],
            units.distance,
          )
        : "—";
  const gva = aircraft.gva != null ? String(aircraft.gva) : "—";
  const posAge =
    aircraft.seenPosSec != null ? `${aircraft.seenPosSec.toFixed(1)} s` : "—";
  const dataAge =
    aircraft.seenSec != null ? `${aircraft.seenSec.toFixed(1)} s` : "—";

  return (
    <KvList>
      <KvRow k="ADS-B version" v={version} />
      <KvRow k="NIC" v={nic} />
      <KvRow k="NACp" v={nacp} />
      <KvRow k="SIL" v={sil} />
      <KvRow k="NIC baro" v={nicBaro} />
      <KvRow k="Rc" v={rc} />
      <KvRow k="GVA" v={gva} />
      <KvRow
        k="Source"
        v={aircraftSourceLabel(aircraft.source, {
          adsb: "ADS-B",
          mlat: "MLAT",
        })}
      />
      <KvRow k="Position age" v={posAge} />
      <KvRow k="Data age" v={dataAge} />
    </KvList>
  );
}
