import { useLocale } from "../locale";
import { useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import { sendStatus } from "../campaign/sendStatus";
import "../crm-campaign.css";
import { type SendListEntry } from "../sendClient";
import type { Viewer } from "../viewer";


import SendProgressPanel from "./SendProgressPanel";

/** The campaign's sends, newest last as the host lists them. Read once by
 *  the page; opening one shows its result. */
export default function CampaignSends({
  scope,
  viewer,
  sends,
  error,
  onChanged,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  sends: SendListEntry[] | null;
  error: string | null;
  onChanged: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const [openId, setOpenId] = useState<string | null>(null);
  const sent = (sends ?? []).filter((row) => row.state !== "prepared");
  return (
    <section aria-label={t("Campaign sends")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">{t("Sends")}</h4>
      {error !== null && sends === null ? (
        <p className="text-label text-fail" role="alert">
          {t(error)}
        </p>
      ) : sends === null ? (
        <p className="text-label text-ink-400" role="status">
          {t("Reading sends…")}
        </p>
      ) : sent.length === 0 ? (
        <p className="text-label text-ink-400" data-empty="sends">
          {t("Nothing sent yet. Send from the Review and send tab.")}
        </p>
      ) : (
        <ol className="crm-history" aria-label={t("Sends")}>
          {sent.map((row) => {
            const total = row.counts.queued + row.counts.submitting + row.counts.accepted + row.counts.failed + row.counts.uncertain + row.counts.suppressed + row.counts.closed;
            const status = sendStatus(row);
            return (
              <li key={row.sendId} className="card px-3 py-3">
                <p className="text-label text-ink-200">
                  <span className="chip crm-send-chip" data-state={status.chip ?? undefined}>{t(status.label)}</span>{" "}
                  <span className="text-ink-400">
                    {formatNumber(row.counts.accepted)} {t("accepted")} {t("of")} {formatNumber(total)}
                  </span>{" "}
                  <button
                    type="button"
                    className="lnk"
                    aria-expanded={openId === row.sendId}
                    onClick={() => setOpenId(openId === row.sendId ? null : row.sendId)}
                  >
                    {t(openId === row.sendId ? "Hide" : "Show")}
                  </button>
                </p>
                {openId === row.sendId && (
                  <div className="mt-2">
                    <SendProgressPanel scope={scope} viewer={viewer} sendId={row.sendId} onChanged={onChanged} />
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
