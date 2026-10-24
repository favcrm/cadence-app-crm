import { useLocale } from "../locale";
import { Button } from "@cadence/screen-ui";
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
  audienceLabel,
  onTab,
  onDoc,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
  doc: ContentDoc;
  freezeId: string;
  freeze: { valid: boolean | null } | null;
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
  const [approvePending, setApprovePending] = useState(false);
  const [approvedSendId, setApprovedSendId] = useState<string | null>(null);

  const readiness = sendReadiness({ doc, freezeId, freeze, binding, testEvidence });
  const missing = missingReasons(readiness);
  const check = (key: "freeze" | "sender" | "test") =>
    readiness.find((row) => row.key === key)!;
  const canPrepare = canWrite && missing.length === 0;

  const prepare = () => {
    setPreparePending(true);
    setError(null);
    setPrepared(null);
    setApprovedSendId(null);
    const commit = () => {
      void sendClient
        .sendPrepare(scope, campaignId, freezeId.trim(), newAudienceId("send"))
        .then((value) => setPrepared(parsePreparedSend(value)))
        .catch((err: unknown) => setError(friendlySendError(err)))
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
        setError(friendlyCampaignError(err));
        setPreparePending(false);
      });
  };

  return (
    <section id="cmp-final-send" tabIndex={-1} aria-label={t("Final send")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">
        {t("Final send — approved, bounded, no resend")}
      </h4>
      <p className="text-label text-ink-400">
        {t("Prepare approves the current content revision and commits it with the audience freeze, the sender link and the unsubscribe origin into one send digest the operator then approves. Any material change between prepare and approve refuses the send. SMTP acceptance is recorded — never inbox delivery, never reads.")}
      </p>
      <dl className="sdetail" aria-label={t("Send confirmation")} data-send-confirmation data-prerequisites={missing.length > 0 ? "missing" : "met"}>
        <div>
          <dt>{t("Audience")}</dt>
          <dd>
            {audienceLabel ?? "—"} ·{" "}
            {check("freeze").done
              ? t("frozen and valid")
              : freeze === null
                ? t("not frozen yet")
                : t("needs a recheck")}
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
      {missing.length > 0 && (
        <p className="text-label text-ink-400">
          {t("Prepare is unavailable until every check above is met.")}
        </p>
      )}
      {error && (
        <p className="text-label text-fail" role="alert">
          {t(error)}{" "}
          {prepared === null && <span className="text-ink-500">{t("Prepare again.")}</span>}
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
                ? t("Approve the current revision and commit the send's material")
                : `${t("Missing:")} ${missing.map((item) => t(item)).join("; ")}`
            }
            onClick={prepare}
          >
            {t("Prepare send")}
          </Button>
        </div>
      )}
      {prepared !== null && (
        <section aria-label={t("Prepared send")} className="card px-3 py-3 grid gap-3" data-prepared>
          <p className="text-label text-ink-200">
            {t("Send")} <span className="num">{prepared.send.sendId}</span> — {t("state")} {" "}
            <span className="chip crm-send-chip" data-state={prepared.send.state}>
              {t(prepared.send.state)}
            </span>
          </p>
          <dl className="crm-detail" aria-label={t("Prepared counts")}>
            <div>
              <dt>{t("Included")}</dt>
              <dd className="num" data-count="included">
                {prepared.counts.included}
              </dd>
            </div>
            <div>
              <dt>{t("Excluded")}</dt>
              <dd className="num" data-count="excluded">
                {prepared.counts.excluded}
              </dd>
            </div>
            <div>
              <dt>{t("Suppressed now")}</dt>
              <dd className="num" data-count="suppressed_now">
                {prepared.counts.suppressedNow}
              </dd>
            </div>
            <div>
              <dt>{t("Final recipients")}</dt>
              <dd className="num" data-count="final">
                {formatNumber(prepared.counts.final)} / {t("ceiling")} {formatNumber(prepared.counts.maxRecipients)}
              </dd>
            </div>
            <div>
              <dt>{t("Content")}</dt>
              <dd className="num">
                r{formatNumber(prepared.send.contentRevision)} · {prepared.send.contentDigest.slice(0, 18)}…
              </dd>
            </div>
            <div>
              <dt>{t("Audience freeze")}</dt>
              <dd className="num">
                {prepared.send.audienceFreezeId} · {prepared.send.audienceDigest.slice(0, 18)}…
              </dd>
            </div>
            <div>
              <dt>{t("Sender")}</dt>
              <dd className="num break-all">
                {binding?.sender.address ?? "—"}
                <details>
                  <summary className="cursor-pointer text-ink-400">{t("Details")}</summary>
                  {prepared.send.connectionId} {t("· link r")}{prepared.send.linkRevision}
                </details>
              </dd>
            </div>
            <div>
              <dt>{t("Unsubscribe origin")}</dt>
              <dd className="num">{prepared.send.unsubscribeOrigin}</dd>
            </div>
            <div>
              <dt>{t("Send digest")}</dt>
              <dd className="num" title={prepared.sendDigest}>
                {prepared.sendDigest.slice(0, 24)}…
              </dd>
            </div>
          </dl>
          {prepared.sample.length > 0 && (
            <p className="text-micro text-ink-500">
              {t("Sample (masked):")}{" "}
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
              {t("Approve and send…")}
            </Button>
            <button
              type="button"
              className="lnk text-label"
              onClick={() => setPrepared(null)}
            >
              {t("Discard prepared view")}
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
