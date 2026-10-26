import { useLocale } from "../locale";
import { Button,ConfirmDialog } from "@cadence/screen-ui";
import { useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import {
missingReasons,
sendReadiness,
TEST_ANCHOR,
type CampaignTab
} from "../campaign/readiness";
import { focusAnchor } from "../campaign/OverviewPane";
import {
friendlyCampaignError,
parseContentDoc,
type ContentDoc
} from "../campaignGrammar";
import { contentClient } from "../contentClient";
import "../crm-campaign.css";
import { newAudienceId } from "../segmentGrammar";
import { isApprovalRequired } from "../hostErrors";
import {
friendlySendError,
parsePreparedSend,
parseSendView,
sendClient,
type PreparedSend,
type SendSelection,
type SmtpBinding,
type TestSendReceipt
} from "../sendClient";
import { WAITING_APPROVAL_TEXT } from "../sendingView";
import type { Viewer } from "../viewer";


import SendProgressPanel from "./SendProgressPanel";

export default function FinalSendPanel({
  scope,
  viewer,
  campaignId,
  doc,
  freezeId,
  freeze,
  freezeMissing,
  freezeError,
  selection,
  binding,
  testEvidence,
  audienceLabel,
  onTab,
  onDoc,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
  doc: ContentDoc;
  freezeId: string;
  freeze: { valid: boolean | null; finalCount?: number } | null;
  freezeMissing?: boolean;
  freezeError?: string | null;
  /** CAD-1836: the selection the send freezes with its one approval. */
  selection: SendSelection | null;
  binding: SmtpBinding | null | undefined;
  testEvidence: TestSendReceipt | null;
  audienceLabel?: string;
  onTab?: (tab: CampaignTab) => void;
  onDoc: (doc: ContentDoc) => void;
}) {
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const [prepared, setPrepared] = useState<PreparedSend | null>(null);
  const [preparePending, setPreparePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [approvePending, setApprovePending] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approvedSendId, setApprovedSendId] = useState<string | null>(null);

  const readiness = sendReadiness({ doc, freezeId, freeze, binding, testEvidence, selectionReady: selection !== null });
  const missing = missingReasons(readiness);
  const check = (key: "freeze" | "sender" | "test") =>
    readiness.find((row) => row.key === key)!;
  const canPrepare = canWrite && missing.length === 0;
  const recipients = freeze?.valid === true && typeof freeze.finalCount === "number" ? freeze.finalCount : null;
  const sendLabel =
    recipients === null
      ? t("Review and send")
      : t("Send {count} emails").replace("{count}", formatNumber(recipients));
  const approveLabel =
    recipients === null
      ? t("Approve send")
      : t("Send {count} emails").replace("{count}", formatNumber(recipients));

  const prepare = () => {
    setPreparePending(true);
    setError(null);
    setWaiting(false);
    setPrepared(null);
    setApprovedSendId(null);
    const commit = () => {
      void sendClient
        .sendPrepare(scope, campaignId, freezeId.trim(), newAudienceId("send"), selection ?? undefined)
        .then((value) => setPrepared(parsePreparedSend(value)))
        .catch((err: unknown) => {
          if (isApprovalRequired(err)) {
            setWaiting(true);
            return;
          }
          setError(friendlySendError(err));
        })
        .finally(() => setPreparePending(false));
    };
    // The daemon requires the current revision to be approved before it
    // prepares; this confirmation is that approval, so the campaign has no
    // separate content-approval step.
    if (doc.approval.valid && doc.approval.revision === doc.revision) {
      commit();
      return;
    }
    void contentClient
      .approve(scope, campaignId, doc.revision)
      .then((value) => {
        onDoc(parseContentDoc(value));
        commit();
      })
      .catch((err: unknown) => {
        if (isApprovalRequired(err)) {
          setWaiting(true);
          return;
        }
        setError(friendlyCampaignError(err));
        setPreparePending(false);
      });
  };

  const approve = () => {
    if (prepared === null) return;
    setApprovePending(true);
    setError(null);
    // The host freshly reads the prepared send and draws the
    // authoritative recipient-count/digest confirmation.
    void sendClient
      .sendApprove(scope, prepared.send.sendId)
      .then((value) => {
        setApprovedSendId(parseSendView(value).send.sendId);
        setPrepared(null);
      })
      .catch((err: unknown) => {
        setError(friendlySendError(err));
      })
      .finally(() => {
        setApprovePending(false);
        setApproveOpen(false);
      });
  };

  return (
    <section id="cmp-final-send" tabIndex={-1} aria-label={t("Send")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">{t("Send")}</h4>
      <p className="text-label text-ink-400">
        {t("The owner approves one send: the content revision, the frozen audience, the sender and the unsubscribe origin are committed into a digest, and any change before approval refuses it. SMTP acceptance is recorded — never inbox delivery, never reads.")}
      </p>
      <dl className="sdetail" aria-label={t("Send confirmation")} data-send-confirmation data-prerequisites={missing.length > 0 ? "missing" : "met"}>
        <div>
          <dt>{t("Audience")}</dt>
          <dd>
            {audienceLabel ?? "—"} ·{" "}
            {check("freeze").done
              ? `${selection !== null ? t("freezes with this send") : t("frozen")}${
                  typeof freeze?.finalCount === "number"
                    ? ` · ${formatNumber(freeze.finalCount)} ${t("recipients")}`
                    : ""
                }`
              : freezeMissing
                ? t("no audience selection yet")
                : freeze === null
                  ? t("checking the snapshot…")
                  : t("the audience changed since it was frozen")}
            {!check("freeze").done && onTab !== undefined && (
              <>{" "}<button type="button" className="lnk crm-confirm-go" onClick={() => onTab("audience")}>{t("Open audience")}</button></>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("Content")}</dt>
          <dd>
            r{formatNumber(doc.revision)} · {doc.subject}
          </dd>
        </div>
        <div>
          <dt>{t("Sender")}</dt>
          <dd>
            {check("sender").done && binding
              ? `${binding.sender.name} <${binding.sender.address}>`
              : t("no live sender")}
          </dd>
        </div>
        <div>
          <dt>{t("Test")}</dt>
          <dd>
            {check("test").done
              ? t("accepted for this revision")
              : t("not accepted for this revision")}
            {!check("test").done && (
              <>{" "}<button type="button" className="lnk crm-confirm-go" onClick={() => focusAnchor(TEST_ANCHOR)}>{t("Send a test")}</button></>
            )}
          </dd>
        </div>
      </dl>
      {freezeError != null && freezeError !== "" && (
        <p className="text-label text-fail" role="alert">
          {t(freezeError)}
        </p>
      )}
      {missing.length > 0 && (
        <p className="text-label text-ink-400">
          {t("Every check above must be met before a send can be requested.")}
        </p>
      )}
      {waiting && (
        <p className="text-label text-ink-200" role="status" data-approval-waiting>
          {t(WAITING_APPROVAL_TEXT)}.{" "}
          {t("Nothing has been sent — the request is in the owner's approvals inbox.")}
        </p>
      )}
      {error && (
        <p className="text-label text-fail" role="alert">
          {t(error)}
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
                ? t("Approve the current revision and request the owner's send approval")
                : `${t("Missing:")} ${missing.map((item) => t(item)).join("; ")}`
            }
            onClick={() => setRequestOpen(true)}
          >
            {sendLabel}
          </Button>
        </div>
      )}
      {prepared !== null && (
        <section aria-label={t("Prepared send")} className="card px-3 py-3 grid gap-3" data-prepared>
          <p className="text-label text-ink-200">
            {t("Ready to send")} —{" "}
            <span className="num">{formatNumber(prepared.counts.final)}</span> {t("recipients")} ·{" "}
            {binding?.sender.address ?? "—"}
          </p>
          <p className="text-micro text-ink-500">{doc.subject}</p>
          {prepared.sample.length > 0 && (
            <p className="text-micro text-ink-500">
              {t("Sample (masked):")}{" "}
              {prepared.sample.map((row) => `${row.customerId} · ${row.email}`).join(", ")}
            </p>
          )}
          <details className="crm-diag">
            <summary className="text-micro text-ink-500">{t("Details")}</summary>
            <dl className="crm-detail mt-1" aria-label={t("Prepared counts")}>
              <div>
                <dt>{t("Included")}</dt>
                <dd className="num" data-count="included">{prepared.counts.included}</dd>
              </div>
              <div>
                <dt>{t("Excluded")}</dt>
                <dd className="num" data-count="excluded">{prepared.counts.excluded}</dd>
              </div>
              <div>
                <dt>{t("Suppressed now")}</dt>
                <dd className="num" data-count="suppressed_now">{prepared.counts.suppressedNow}</dd>
              </div>
              <div>
                <dt>{t("Ceiling")}</dt>
                <dd className="num">{formatNumber(prepared.counts.maxRecipients)}</dd>
              </div>
              <div>
                <dt>{t("Content")}</dt>
                <dd className="num">r{formatNumber(prepared.send.contentRevision)} · {prepared.send.contentDigest.slice(0, 18)}…</dd>
              </div>
              <div>
                <dt>{t("Audience freeze")}</dt>
                <dd className="num">{prepared.send.audienceFreezeId} · {prepared.send.audienceDigest.slice(0, 18)}…</dd>
              </div>
              <div>
                <dt>{t("Sender")}</dt>
                <dd className="num break-all">
                  {prepared.send.connectionId} {t("· link r")}{prepared.send.linkRevision}
                </dd>
              </div>
              <div>
                <dt>{t("Unsubscribe origin")}</dt>
                <dd className="num">{prepared.send.unsubscribeOrigin}</dd>
              </div>
              <div>
                <dt>{t("Send digest")}</dt>
                <dd className="num" title={prepared.sendDigest}>{prepared.sendDigest.slice(0, 24)}…</dd>
              </div>
            </dl>
          </details>
          <div className="crm-toolbar">
            <Button size="sm" variant="danger" disabled={approvePending} onClick={() => setApproveOpen(true)}>
              {approveLabel}
            </Button>
            <button type="button" className="lnk text-label" onClick={() => setPrepared(null)}>
              {t("Discard prepared view")}
            </button>
          </div>
        </section>
      )}
      {approvedSendId !== null && (
        <SendProgressPanel scope={scope} viewer={viewer} sendId={approvedSendId} />
      )}
      {requestOpen && (
        <ConfirmDialog
          title={recipients === null ? t("Request this send?") : t("Send {count} emails?").replace("{count}", formatNumber(recipients))}
          body={
            <div className="grid gap-2">
              <p>
                {t("This sends real email to the frozen audience once the owner approves. A test send of this exact content and sender must already be accepted.")}
              </p>
              <p className="text-label text-ink-400">
                {audienceLabel ?? "—"} · r{formatNumber(doc.revision)} · {doc.subject}
              </p>
            </div>
          }
          confirmLabel={t("Request approval")}
          pending={preparePending}
          error={null}
          onCancel={() => setRequestOpen(false)}
          onConfirm={() => {
            setRequestOpen(false);
            prepare();
          }}
        />
      )}
      {approveOpen && prepared !== null && (
        <ConfirmDialog
          title={t("Send to {count} recipients?").replace("{count}", formatNumber(prepared.counts.final))}
          body={
            <p>
              {t("This is the real send. The frozen audience is the exact recipient list, and the send cannot be undone or resent.")}
            </p>
          }
          confirmLabel={t("Approve and send")}
          pending={approvePending}
          error={null}
          onCancel={() => setApproveOpen(false)}
          onConfirm={approve}
        />
      )}
    </section>
  );
}
