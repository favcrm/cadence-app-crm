import { useCallback,useEffect,useRef,useState } from "react";
import type { AudienceScope } from "../audienceClient";
import { latestSend,sendStatus } from "../campaign/sendStatus";
import { friendlySendError,parseSendList,sendClient,type SendListEntry } from "../sendClient";

/** One `sends.list` read per campaign page, polled while a send runs.
 *  `sends === null` means unknown (loading or failed), never "no sends". */
export function useCampaignSends(scope: AudienceScope, operator: boolean, campaignId: string) {
  const [sends, setSends] = useState<SendListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((n) => n + 1), []);
  const ticks = useRef(0);
  const running = sends !== null && (() => { const row = latestSend(sends); return row !== null && sendStatus(row).key === "sending"; })();
  useEffect(() => {
    if (!operator) return;
    const controller = new AbortController();
    sendClient
      .sendList(scope, campaignId)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSends(parseSendList(value));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(friendlySendError(e));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.installId, campaignId, token, operator]);
  useEffect(() => {
    if (!running) { ticks.current = 0; return; }
    if (ticks.current >= 200) return;
    const timer = setTimeout(() => { ticks.current += 1; refresh(); }, 3000);
    return () => clearTimeout(timer);
  }, [running, token, refresh]);
  return { sends, error, refresh };
}
