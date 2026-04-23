import type { Aircraft, ReceiverJson } from "../../data/types";
import { formatAgeSecondsAgo } from "../age";
import { KvList, KvRow } from "../KvRow";
import { RssiBarSpark } from "../Sparkline";

function sourceLabel(t: Aircraft["type"]): string {
  if (t === "mlat") return "MLAT (aggregator)";
  if (t === "adsb_icao" || t === "adsb_icao_nt" || t === "adsb_other")
    return "Direct 1090 ES";
  if (t) return t;
  return "—";
}

export function SignalTab({
  aircraft,
  rssiBuf,
  receiver,
}: {
  aircraft: Aircraft;
  rssiBuf: number[];
  receiver: ReceiverJson | null;
}) {
  const rssi = aircraft.rssi != null ? `${aircraft.rssi.toFixed(1)} dBFS` : "—";
  const messages =
    aircraft.messages != null ? aircraft.messages.toLocaleString() : "—";
  const lastMsg = formatAgeSecondsAgo(aircraft.seen);
  const lastPos = formatAgeSecondsAgo(aircraft.seen_pos);
  const rxName = receiver?.version?.split(" ").slice(0, 2).join(" ") || "—";

  return (
    <div>
      <div className="mb-[10px]">
        <RssiBarSpark samples={rssiBuf} />
      </div>
      <KvList>
        <KvRow k="RSSI" v={rssi} />
        <KvRow k="Messages" v={messages} />
        <KvRow k="Last msg" v={lastMsg} />
        <KvRow k="Last position" v={lastPos} />
        <KvRow k="Receiver" v={rxName} />
        <KvRow k="Source" v={sourceLabel(aircraft.type)} />
      </KvList>
    </div>
  );
}
