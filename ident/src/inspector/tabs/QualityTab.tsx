import { useIdentStore } from "../../data/store";
import type { Aircraft } from "../../data/types";
import {
  airDistanceLabelFromMeters,
  distanceMeaning,
  resolveUnitOverrides,
} from "../../settings/format";
import { KvList, KvRow } from "../KvRow";

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

function sourceLabel(t: Aircraft["type"]): string {
  if (t === "mlat") return "MLAT";
  if (t === "adsb_icao" || t === "adsb_icao_nt" || t === "adsb_other")
    return "ADS-B";
  if (t) return t;
  return "—";
}

export function QualityTab({ aircraft }: { aircraft: Aircraft }) {
  const settings = useIdentStore((s) => s.settings);
  const units = resolveUnitOverrides(settings.unitMode, settings.unitOverrides);
  const version = aircraft.version != null ? `v${aircraft.version}` : "—";
  const nic = distanceMeaning(aircraft.nic, NIC_MEANING_M, units.distance);
  const nacp = distanceMeaning(aircraft.nac_p, NACP_MEANING_M, units.distance);
  const sil = withMeaning(aircraft.sil, SIL_MEANING);
  const nicBaro = aircraft.nic_baro != null ? String(aircraft.nic_baro) : "—";
  const rc =
    aircraft.rc != null
      ? airDistanceLabelFromMeters(aircraft.rc, units.distance)
      : aircraft.nic != null && RC_FROM_NIC_M[aircraft.nic] != null
        ? airDistanceLabelFromMeters(
            RC_FROM_NIC_M[aircraft.nic],
            units.distance,
          )
        : "—";
  const gva = aircraft.gva != null ? String(aircraft.gva) : "—";
  const posAge =
    aircraft.seen_pos != null ? `${aircraft.seen_pos.toFixed(1)} s` : "—";
  const dataAge = aircraft.seen != null ? `${aircraft.seen.toFixed(1)} s` : "—";

  return (
    <KvList>
      <KvRow k="ADS-B version" v={version} />
      <KvRow k="NIC" v={nic} />
      <KvRow k="NACp" v={nacp} />
      <KvRow k="SIL" v={sil} />
      <KvRow k="NIC baro" v={nicBaro} />
      <KvRow k="Rc" v={rc} />
      <KvRow k="GVA" v={gva} />
      <KvRow k="Source" v={sourceLabel(aircraft.type)} />
      <KvRow k="Position age" v={posAge} />
      <KvRow k="Data age" v={dataAge} />
    </KvList>
  );
}
