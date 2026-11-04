import { useLocale } from "../locale";
import { useEffect,useRef,useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import { sendStatus } from "../campaign/sendStatus";
import "../crm-campaign.css";
import {
DELIVERY_CLAIM,
friendlySendError,
parseSendView,
sendClient,
sendTerminal,
type SendView
} from "../sendClient";
import type { Viewer } from "../viewer";


import DeliveryRows from "./DeliveryRows";

/** The plain sentence above the numbers. Acceptance by the mail server is
 *  the most this app ever claims — never inbox delivery. */
function headline(view: SendView): { text: string; tone: "fail" | "normal" } {
  const status = sendStatus({ state: view.send.state, counts: view.counts });
  if (status.key === "sending") return { text: "Sending. You can leave this page; it continues.", tone: "normal" };
  if (status.key === "partial") return { text: "Sent, but {count} weren't accepted. They aren't retried automatically.", tone: "normal" };
  if (status.key === "uncertain") return { text: "This send stopped before it finished. Check the list below before doing anything else.", tone: "fail" };
  return { text: "Sent. The mail server accepted these, which doesn't confirm inbox delivery.", tone: "normal" };
}

export default function SendProgressPanel({
  scope,
  viewer,
  sendId,
  onChanged,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  sendId: string;
  /** The campaign's send list should be read again. */
  onChanged?: () => void;
}) {
  const { t, formatNumber } = useLocale();
  const [view, setView] = useState<SendView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null });

  useEffect(() => {
    let stopped = false;
    let ticks = 0;
    const tick = () => {
      if (stopped) return;
      ticks += 1;
      sendClient
        .sendShow(scope, sendId)
        .then((value) => {
          if (stopped) return;
          const parsed = parseSendView(value);
          setView(parsed);
          setError(null);
          if (!sendTerminal(parsed.send.state) && ticks < 150) {
            pollRef.current.timer = setTimeout(tick, 2000);
          } else {
            onChanged?.();
          }
        })
        .catch((e: unknown) => {
          if (stopped) return;
          setError(friendlySendError(e));
          if (ticks < 150) pollRef.current.timer = setTimeout(tick, 2000);
        });
    };
    tick();
    return () => {
      stopped = true;
      if (pollRef.current.timer !== null) clearTimeout(pollRef.current.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendId]);

  if (view === null && error === null) {
    return (
      <p className="text-label text-ink-400" role="status">
        {t("Reading the send…")}
      </p>
    );
  }
  if (view === null) {
    return (
      <p className="text-label text-fail" role="alert">
        {error !== null ? t(error) : null}
      </p>
    );
  }
  const counts = view.counts;
  const total = counts.queued + counts.submitting + counts.accepted + counts.failed + counts.uncertain + counts.suppressed + counts.closed;
  const head = headline(view);
  const cells: [string, number, boolean][] = [
    ["Audience", total, true],
    ["Accepted", counts.accepted, true],
    ["Skipped", counts.suppressed, true],
    ["Failed", counts.failed, true],
    ["Unconfirmed", counts.uncertain, counts.uncertain > 0],
    ["Waiting", counts.queued + counts.submitting, counts.queued + counts.submitting > 0],
    ["Not sent", counts.closed, counts.closed > 0],
  ];
  return (
    <section aria-label={t("Send result")} className="grid gap-3">
      <p className={`text-label ${head.tone === "fail" ? "text-fail" : "text-ink-200"}`} role="status">
        {t(head.text).replace("{count}", formatNumber(counts.failed))}
        {view.send.closeReason !== null && <span className="text-ink-400"> {view.send.closeReason}</span>}
      </p>
      <dl className="sdetail" aria-label={t("Delivery counts")}>
        {cells.filter(([, , shown]) => shown).map(([label, n]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd className="num" data-count={label.toLowerCase()}>{formatNumber(n)}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p className="text-label text-fail" role="alert">
          {t(error)}
        </p>
      )}
      {view.deliveries.length > 0 && (
        <DeliveryRows
          scope={scope}
          viewer={viewer}
          view={view}
          onResolved={() => {
            sendClient
              .sendShow(scope, sendId)
              .then((value) => { setView(parseSendView(value)); onChanged?.(); })
              .catch(() => undefined);
          }}
        />
      )}
      <details className="crm-diag" data-technical="true">
        <summary className="text-micro text-ink-500">{t("Technical details")}</summary>
        <dl className="sdetail mt-1">
          <div><dt>{t("Send")}</dt><dd className="num">{view.send.sendId}</dd></div>
          <div><dt>{t("Version")}</dt><dd className="num">r{formatNumber(view.send.contentRevision)} · {view.send.contentDigest.slice(0, 18)}…</dd></div>
          <div><dt>{t("Audience snapshot")}</dt><dd className="num">{view.send.audienceFreezeId} · {view.send.audienceDigest.slice(0, 18)}…</dd></div>
          <div><dt>{t("Sender link")}</dt><dd className="num break-all">{view.send.connectionId} {t("· link r")}{view.send.linkRevision}</dd></div>
          <div><dt>{t("Unsubscribe origin")}</dt><dd className="num">{view.send.unsubscribeOrigin}</dd></div>
          <div><dt>{t("Send digest")}</dt><dd className="num" title={view.send.sendDigest}>{view.send.sendDigest.slice(0, 24)}…</dd></div>
          <div><dt>{t("Delivery claim")}</dt><dd className="num">{view.deliveryClaim === DELIVERY_CLAIM ? t("Accepted by the mail server only") : view.deliveryClaim}</dd></div>
        </dl>
      </details>
    </section>
  );
}
