import { Button } from "@cadence/screen-ui";
import { useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import {
missingReasons,
sendReadiness
} from "../campaign/readiness";
import {
type ContentDoc
} from "../campaignGrammar";
import "../crm-campaign.css";
import { newAudienceId } from "../segmentGrammar";
import {
friendlySendError,
parsePreparedSend,
parseSendView,
sendClient,
type PreparedSend,
type SmtpBinding,
type TestSendReceipt
} from "../sendClient";
import type { Viewer } from "../viewer";


import SendProgressPanel from "./SendProgressPanel";

export default function FinalSendPanel({
  scope,
  viewer,
  campaignId,
  doc,
  freezeId,
  freeze,
  binding,
  testEvidence,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
  doc: ContentDoc;
  freezeId: string;
  freeze: { valid: boolean | null } | null;
  binding: SmtpBinding | null | undefined;
  testEvidence: TestSendReceipt | null;
}) {
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const [prepared, setPrepared] = useState<PreparedSend | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvePending, setApprovePending] = useState(false);
  const [approvedSendId, setApprovedSendId] = useState<string | null>(null);

  const missing = missingReasons(sendReadiness({ doc, freezeId, freeze, binding, testEvidence }));
  const canPrepare = canWrite && missing.length === 0;

  const prepare = () => {
    setPreparePending(true);
    setError(null);
    setPrepared(null);
    setApprovedSendId(null);
    void sendClient
      .sendPrepare(scope, campaignId, freezeId.trim(), newAudienceId("send"))
      .then((value) => setPrepared(parsePreparedSend(value)))
      .catch((err: unknown) => setError(friendlySendError(err)))
      .finally(() => setPreparePending(false));
  };

  return (
    <section id="cmp-final-send" tabIndex={-1} aria-label="Final send" className="card px-4 py-4 grid gap-3 crm-send">
      <h4 className="text-cardtitle font-medium text-ink-100">
        Final send — approved, bounded, no resend
      </h4>
      <p className="text-label text-ink-400">
        Prepare commits content revision + digest, the audience freeze, the sender link and the
        unsubscribe origin into one send digest the operator then approves. Any material change
        between prepare and approve refuses the send. SMTP acceptance is recorded — never inbox
        delivery, never reads.
      </p>
      {missing.length > 0 ? (
        <div className="card px-3 py-3" data-prerequisites="missing">
          <p className="text-label text-ink-300">Prepare stays unavailable — missing:</p>
          <ul className="crm-history">
            {missing.map((item) => (
              <li key={item} className="text-label text-warn">
                · {item}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-label text-ok" data-prerequisites="met">
          Every prerequisite is in place — approved r{doc.revision}, the frozen audience
          (checked just now), sender {binding?.sender.address}, accepted test send of this content.
        </p>
      )}
      {error && (
        <p className="text-label text-fail" role="alert">
          {error}{" "}
          {prepared === null && <span className="text-ink-500">Prepare again.</span>}
        </p>
      )}
      {canWrite && (
        <div>
          <Button
            size="sm"
            variant="primary"
            loading={preparePending}
            disabled={!canPrepare || preparePending}
            title={
              canPrepare
                ? "Freeze the send's material and show what approval commits"
                : `Missing: ${missing.join("; ")}`
            }
            onClick={prepare}
          >
            Prepare send
          </Button>
        </div>
      )}
      {prepared !== null && (
        <section aria-label="Prepared send" className="card px-3 py-3 grid gap-3" data-prepared>
          <p className="text-label text-ink-200">
            Send <span className="num">{prepared.send.sendId}</span> — state{" "}
            <span className="chip crm-send-chip" data-state={prepared.send.state}>
              {prepared.send.state}
            </span>
          </p>
          <dl className="crm-detail" aria-label="Prepared counts">
            <div>
              <dt>Included</dt>
              <dd className="num" data-count="included">
                {prepared.counts.included}
              </dd>
            </div>
            <div>
              <dt>Excluded</dt>
              <dd className="num" data-count="excluded">
                {prepared.counts.excluded}
              </dd>
            </div>
            <div>
              <dt>Suppressed now</dt>
              <dd className="num" data-count="suppressed_now">
                {prepared.counts.suppressedNow}
              </dd>
            </div>
            <div>
              <dt>Final recipients</dt>
              <dd className="num" data-count="final">
                {prepared.counts.final} / ceiling {prepared.counts.maxRecipients}
              </dd>
            </div>
            <div>
              <dt>Content</dt>
              <dd className="num">
                r{prepared.send.contentRevision} · {prepared.send.contentDigest.slice(0, 18)}…
              </dd>
            </div>
            <div>
              <dt>Audience freeze</dt>
              <dd className="num">
                {prepared.send.audienceFreezeId} · {prepared.send.audienceDigest.slice(0, 18)}…
              </dd>
            </div>
            <div>
              <dt>Sender</dt>
              <dd className="num break-all">
                {binding?.sender.address ?? "—"}
                <details>
                  <summary className="cursor-pointer text-ink-400">Details</summary>
                  {prepared.send.connectionId} · link r{prepared.send.linkRevision}
                </details>
              </dd>
            </div>
            <div>
              <dt>Unsubscribe origin</dt>
              <dd className="num">{prepared.send.unsubscribeOrigin}</dd>
            </div>
            <div>
              <dt>Send digest</dt>
              <dd className="num" title={prepared.sendDigest}>
                {prepared.sendDigest.slice(0, 24)}…
              </dd>
            </div>
          </dl>
          {prepared.sample.length > 0 && (
            <p className="text-micro text-ink-500">
              Sample (masked):{" "}
              {prepared.sample.map((row) => `${row.customerId} · ${row.email}`).join(", ")}
            </p>
          )}
          <div className="crm-toolbar">
            <Button
              size="sm"
              variant="danger"
              disabled={approvePending}
              onClick={() => {
                setApprovePending(true);
                setError(null);
                // The host freshly reads the prepared send and draws the
                // authoritative recipient-count/digest confirmation.
                void sendClient.sendApprove(scope, prepared.send.sendId).then(value => {
                  setApprovedSendId(parseSendView(value).send.sendId);
                  setPrepared(null);
                }).catch(err => {
                  setPrepared(null);
                  setError(friendlySendError(err));
                }).finally(() => setApprovePending(false));
              }}
            >
              Approve and send…
            </Button>
            <button
              type="button"
              className="lnk text-label"
              onClick={() => setPrepared(null)}
            >
              Discard prepared view
            </button>
          </div>
        </section>
      )}
      {approvedSendId !== null && (
        <SendProgressPanel scope={scope} viewer={viewer} sendId={approvedSendId} />
      )}
    </section>
  );
}
