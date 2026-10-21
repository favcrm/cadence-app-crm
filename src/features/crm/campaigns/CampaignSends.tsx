import { useLocale } from "../locale";
import { useEffect,useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import "../crm-campaign.css";
import {
friendlySendError,
parseSendList,
sendClient,
type SendListEntry
} from "../sendClient";
import type { Viewer } from "../viewer";


import SendProgressPanel from "./SendProgressPanel";

export default function CampaignSends({
  scope,
  viewer,
  campaignId,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
}) {
  const { t, formatNumber } = useLocale();
  const [sends, setSends] = useState<SendListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const token = `${scope.installId}:${campaignId}`;
  useEffect(() => {
    const controller = new AbortController();
    sendClient
      .sendList(scope, campaignId)
      .then((value) => {
        if (!controller.signal.aborted) {
          setSends(parseSendList(value));
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(friendlySendError(e));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section aria-label={t("Campaign sends")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">{t("Sends of this campaign")}</h4>
      {error !== null ? (
        <p className="text-label text-fail" role="alert">
          {t(error)}
        </p>
      ) : sends === null ? (
        <p className="text-label text-ink-400" role="status">
          {t("Reading sends…")}
        </p>
      ) : sends.length === 0 ? (
        <p className="text-label text-ink-400" data-empty="sends">
          {t("No sends of this campaign yet — prepare and approve above.")}
        </p>
      ) : (
        <ol className="crm-history" aria-label={t("Sends")}>
          {sends.map((row) => {
            const total =
              row.counts.queued +
              row.counts.submitting +
              row.counts.accepted +
              row.counts.failed +
              row.counts.uncertain +
              row.counts.suppressed +
              row.counts.closed;
            return (
              <li key={row.sendId} className="card px-3 py-3">
                <p className="text-label text-ink-200">
                  <span className="num">{row.sendId}</span>{" "}
                  <span className="chip crm-send-chip" data-state={row.state}>
                    {t(row.state)}
                  </span>{" "}
                  <span className="num text-ink-400">
                    {formatNumber(row.counts.accepted)}/{formatNumber(total)} {t("accepted")} · {t("digest")} {row.sendDigest.slice(0, 18)}…
                  </span>{" "}
                  <button
                    type="button"
                    className="lnk"
                    onClick={() => setOpenId(openId === row.sendId ? null : row.sendId)}
                  >
                    {t(openId === row.sendId ? "Hide" : "Show")}
                  </button>
                </p>
                {openId === row.sendId && (
                  <div className="mt-2">
                    <SendProgressPanel scope={scope} viewer={viewer} sendId={row.sendId} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
