import type { Aircraft, ReceiverJson } from "../../data/types";
import { formatAgeSecondsAgo } from "../age";
import { KvList, KvRow } from "../KvRow";
import { RssiBarSpark } from "../Sparkline";
import { aircraftSourceLabel } from "../source";

export function SignalTab({
  aircraft,
  rssiBuf,
  receiver,
}: {
  aircraft: Aircraft;
  rssiBuf: number[];
  receiver: ReceiverJson | null;
}) {
  const rssi =
    aircraft.rssiDbfs != null ? `${aircraft.rssiDbfs.toFixed(1)} dBFS` : "—";
  const messages =
    aircraft.aircraftMessagesTotal != null
      ? aircraft.aircraftMessagesTotal.toLocaleString()
      : "—";
  const lastMsg = formatAgeSecondsAgo(aircraft.seenSec);
  const lastPos = formatAgeSecondsAgo(aircraft.seenPosSec);
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
        <KvRow
          k="Source"
          v={aircraftSourceLabel(aircraft.source, {
            adsb: "Direct 1090 ES",
            mlat: "MLAT (aggregator)",
          })}
        />
      </KvList>
    </div>
  );
}
