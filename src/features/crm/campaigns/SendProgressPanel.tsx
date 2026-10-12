import { useEffect,useRef,useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
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

export default function SendProgressPanel({
  scope,
  viewer,
  sendId,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  sendId: string;
}) {
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
        Reading the send…
      </p>
    );
  }
  if (view === null) {
    return (
      <p className="text-label text-fail" role="alert">
        {error}
      </p>
    );
  }
  const counts = view.counts;
  const cells: [string, number][] = [
    ["prepared", view.send.state === "prepared" ? view.deliveries.length || counts.queued : view.deliveries.length],
    ["queued", counts.queued],
    ["suppressed", counts.suppressed],
    ["submitted", counts.submitting + counts.accepted + counts.failed + counts.uncertain],
    ["accepted", counts.accepted],
    ["failed", counts.failed],
    ["uncertain", counts.uncertain],
    ["closed", counts.closed],
  ];
  return (
    <section aria-label="Send progress" className="grid gap-3">
      <p className="text-label text-ink-300">
        <span className="chip crm-send-chip" data-state={view.send.state}>
          {view.send.state}
        </span>{" "}
        <span className="num">
          {view.send.sendId} · digest {view.send.sendDigest.slice(0, 18)}…
        </span>
        {view.send.closeReason !== null && (
          <span className="text-fail"> · {view.send.closeReason}</span>
        )}
      </p>
      <dl className="crm-detail" aria-label="Delivery counts">
        {cells.map(([label, count]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="num" data-count={label}>
              {count}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-micro text-ink-500">
        {DELIVERY_CLAIM === "smtp-acceptance-only" || view.deliveryClaim === DELIVERY_CLAIM
          ? "SMTP accepted the message — this is not proof of inbox delivery."
          : view.deliveryClaim}
      </p>
      {error && (
        <p className="text-label text-fail" role="alert">
          {error}
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
              .then((value) => setView(parseSendView(value)))
              .catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}

/**
 * The final-send section — visually distinct from the test send, it
 * gates Prepare on every prerequisite the host re-verifies (approved
 * content at the current revision, a valid named audience freeze, a
 * live sender binding, an accepted test send of this content+binding)
 * and shows which is missing before the wire ever sees a request.
 * Approve demands the operator type the final recipient count; the
 * body is exactly `{install_id, context_id, send_id, send_digest}`.
 * Any host refusal discards the prepared view — prepare again.
 */
