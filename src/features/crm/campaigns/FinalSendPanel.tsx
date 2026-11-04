import { useLocale } from "../locale";
import { Button,Link } from "@cadence/screen-ui";
import { useEffect,useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import {
firstBlocker,
sendReadiness,
testState,
type AudienceState,
type CampaignTab
} from "../campaign/readiness";
import { canStart } from "../campaign/sendChain";
import { runSendChain,settleSend } from "../campaign/runSendChain";
import type { ChainRecord } from "../campaign/sendChainStore";
import { latestSend,sendStatus } from "../campaign/sendStatus";
import { useSendingSetup } from "../campaign/sendingSetup";
import {
summarySubject,
type ContentDoc
} from "../campaignGrammar";
import "../crm-campaign.css";
import {
friendlySendError,
parseTestSendReceipt,
sendClient,
type SendListEntry,
type SendSelection,
type SmtpBinding,
type TestSendReceipt
} from "../sendClient";
import { EMAIL_SENDING_HREF,WAITING_APPROVAL_TEXT,isHostedTransport } from "../sendingView";
import type { Viewer } from "../viewer";


import SendProgressPanel from "./SendProgressPanel";

/**
 * Review and send. One card of facts, one primary button that names the
 * count, and one line that says why it is blocked.
 *
 * Pressing send runs the existing host steps in order, without this app
 * asking again in between: the host's content card (when this revision is
 * not yet approved), prepare, then the host's send card. Each host card
 * still needs its own press, and nothing here approves on the host's
 * behalf: a refused or cancelled card stops the chain and nothing is sent.
 */
export default function FinalSendPanel({
  scope,
  viewer,
  campaignId,
  doc,
  freezeId,
  selection,
  binding,
  testEvidence,
  onTestEvidence,
  audience,
  audienceTitle,
  sends,
  sendsError,
  onSendsChanged,
  onTab,
  onDoc,
  chain,
  chainId,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
  doc: ContentDoc;
  freezeId: string | null;
  /** CAD-1836: the selection the send freezes with its one approval. */
  selection: SendSelection | null;
  binding: SmtpBinding | null | undefined;
  testEvidence: TestSendReceipt | null;
  onTestEvidence: (receipt: TestSendReceipt | null) => void;
  audience: AudienceState;
  audienceTitle: string | null;
  sends: SendListEntry[] | null;
  /** Why the send list is unknown, when a read failed. */
  sendsError: string | null;
  onSendsChanged: () => void;
  onTab: (tab: CampaignTab) => void;
  onDoc: (doc: ContentDoc) => void;
  /** The running send, held outside this page: leaving the tab or remounting
   *  the page can neither re-arm Send nor start a second chain. */
  chain: ChainRecord;
  chainId: string;
}) {
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const setup = useSendingSetup();
  const [again, setAgain] = useState(false);
  const phase = chain.phase;
  const notice = chain.notice;
  const approvedSendId = chain.approvedSendId ?? chain.pendingSendId;
  useEffect(() => { if (chain.approvedSendId !== null) setAgain(false); }, [chain.approvedSendId]);
  const [testPending, setTestPending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const items = sendReadiness({ doc, binding, testEvidence, audience });
  // While earlier sends are unknown the page cannot tell whether this
  // campaign was already sent, so sending waits.
  const why = firstBlocker(items)
    ?? (chain.pendingSendId !== null ? "Check result first." : sendsError !== null ? "Couldn't check earlier sends." : sends === null ? "Checking earlier sends…" : null);
  const test = testState(doc, binding, testEvidence);
  const people = (n: number) => t(n === 1 ? "1 person" : "{count} people").replace("{count}", formatNumber(n));
  const count = audience.state === "ready" ? audience.count : null;
  const canSend = canWrite && why === null && selection !== null && freezeId !== null && canStart(phase) && chain.pendingSendId === null;
  const latest = sends === null ? null : latestSend(sends);
  // While a card is open, or while a lost answer is being settled, the page
  // shows the review (locked, with the Check result line), not a result.
  const resultId = phase !== null || notice?.kind === "unknown" ? null : (approvedSendId ?? latest?.sendId ?? null);

  const send = () => {
    if (!canSend || selection === null || freezeId === null) return;
    void runSendChain({ key: chainId, scope, campaignId, doc, selection, freezeId, count, knownSendIds: new Set((sends ?? []).map((row) => row.sendId)), onDoc });
  };

  const sendTest = () => {
    setTestError(null);
    onTestEvidence(null);
    setTestPending(true);
    void sendClient
      .smtpTestSend(scope, campaignId)
      .then((value) => onTestEvidence(parseTestSendReceipt(value)))
      .catch((err: unknown) => setTestError(friendlySendError(err)))
      .finally(() => setTestPending(false));
  };

  const from =
    binding === undefined ? t("Checking…")
    : binding === null || binding.state !== "live"
      ? setup.available
        ? <Link href={EMAIL_SENDING_HREF} onClick={(event) => { event.preventDefault(); setup.open(); }}>{t("No sender connected · Set up")}</Link>
        : <span data-smtp-setup="unavailable">{t("No sender connected")}. {t("Sending setup isn't available on this host.")}</span>
      : `${binding.sender.name} <${binding.sender.address}>${isHostedTransport(binding) ? ` · ${t("via AgenticOS")}` : ""}`;

  const testValue =
    test === "ok" ? `${t("Accepted for")} ${testEvidence?.to ?? ""}`
    : test === "sender-changed" ? t("Not sent for this sender")
    : test === "not-accepted" ? (testEvidence?.pendingApproval ? t(WAITING_APPROVAL_TEXT) : t("Not accepted"))
    : t("Not sent for this version");

  const review = (
    <section id="cmp-final-send" tabIndex={-1} aria-label={t("Review and send")} className="card px-4 py-4 grid gap-3" data-review>
      <h4 className="text-cardtitle font-medium text-ink-100">{t("Review and send")}</h4>
      <dl className="sdetail" aria-label={t("Send summary")} data-send-confirmation data-prerequisites={why === null ? "met" : "missing"}>
        <div>
          <dt>{t("Email")}</dt>
          <dd>
            {summarySubject(doc.subject)}{" "}
            <button type="button" className="lnk crm-confirm-go" disabled={!canStart(phase)} onClick={() => onTab("email")}>{t("Edit")}</button>
          </dd>
        </div>
        <div>
          <dt>{t("Audience")}</dt>
          <dd>
            {audienceTitle === null ? <span className="text-warn">{t("Not chosen")}</span> : (
              <>
                {audienceTitle}
                {count !== null && <> · {people(count)}</>}
              </>
            )}{" "}
            <button type="button" className="lnk crm-confirm-go" disabled={!canStart(phase)} onClick={() => onTab("audience")}>
              {t(audienceTitle === null ? "Choose" : "Change")}
            </button>
          </dd>
        </div>
        <div>
          <dt>{t("From")}</dt>
          <dd>
            <span className="num">{from}</span>
            {test === "sender-changed" && <span className="text-warn"> · {t("changed since last test")}</span>}
            {setup.error !== null && <span className="text-fail block" role="alert">{setup.error}</span>}
          </dd>
        </div>
        <div>
          <dt>{t("Test")}</dt>
          <dd>
            {test === "ok" ? testValue : <span className="text-warn">{testValue}</span>}
            {canWrite && doc !== null && (
              <>{" "}<button
                type="button"
                className="lnk crm-confirm-go"
                disabled={testPending || !canStart(phase) || binding === undefined || binding === null || binding.state !== "live"}
                onClick={sendTest}
              >{t(testPending ? "Sending test…" : test === "none" ? "Send test" : "Send again")}</button></>
            )}
          </dd>
        </div>
      </dl>
      <p className="text-label text-ink-400">
        {t("A test email goes to one address you enter when you confirm. The mail server's acceptance doesn't confirm inbox delivery, so check that inbox yourself.")}
      </p>
      {sendsError !== null && notice?.kind !== "unknown" && (
        // Shown whether or not an older list is on screen: a failed refresh
        // after a send must not leave a stale "no earlier sends" behind.
        <p className="text-label text-fail" role="alert" data-sends-error>
          {t(sendsError)}{" "}
          <button type="button" className="lnk" onClick={onSendsChanged}>{t("Retry")}</button>
        </p>
      )}
      {testError !== null && (
        <p className="text-label text-fail" role="alert">{t(testError)}</p>
      )}
      {notice?.kind === "waiting" && (
        <p className="text-label text-ink-200" role="status" data-approval-waiting>
          {t(WAITING_APPROVAL_TEXT)}.{" "}
          {t("Nothing has been sent — the request is in the owner's approvals inbox.")}
        </p>
      )}
      {notice?.kind === "cancelled" && (
        <p className="text-label text-ink-300" role="status" data-send-cancelled>
          {t("Cancelled. Nothing was sent.")}
        </p>
      )}
      {notice?.kind === "unknown" && chain.pendingSendId !== null && (
        <p className="text-label text-fail" role="alert" data-send-unknown>
          {t("Check result.")} {t(notice.text)}{" "}
          <button type="button" className="lnk" disabled={chain.settling} onClick={() => { void settleSend(chainId, scope, chain.pendingSendId!, 0); }}>
            {t("Retry")}
          </button>
        </p>
      )}
      {notice?.kind === "error" && (
        <p className="text-label text-fail" role="alert" data-send-error>
          {Object.entries(notice.slots ?? {}).reduce((text, [slot, value]) => text.replace(`{${slot}}`, formatNumber(Number(value))), t(notice.text))}{" "}
          {t("Nothing was sent.")}
        </p>
      )}
      {canWrite ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="primary"
            loading={phase !== null}
            disabled={!canSend}
            onClick={send}
          >
            {count !== null ? t("Send to {people}").replace("{people}", people(count)) : t("Send")}
          </Button>
          {phase !== null ? (
            <span className="text-label text-ink-400" role="status">
              {t(phase === "approving" ? "Waiting for your confirmation…" : phase === "preparing" ? "Preparing the send…" : "Waiting for your confirmation…")}
            </span>
          ) : why !== null ? (
            <span className="text-label text-ink-400" data-blocked-why>{t(why)}</span>
          ) : null}
        </div>
      ) : (
        <p className="text-label text-ink-400" data-state="read-only">{t("Read-only view. A verified operator sends campaigns.")}</p>
      )}
      {testEvidence !== null && (
        <details className="crm-diag" data-technical="true">
          <summary className="text-micro text-ink-500">{t("Technical details")}</summary>
          <dl className="sdetail mt-1">
            <div>
              <dt>{t("Test result")}</dt>
              <dd className="num">{testEvidence.pendingApproval ? t(WAITING_APPROVAL_TEXT) : `SMTP ${testEvidence.smtpCode ?? "—"} ${testEvidence.smtpMessage}`}</dd>
            </div>
            <div>
              <dt>{t("Version")}</dt>
              <dd className="num">r{formatNumber(testEvidence.contentRevision)} · {testEvidence.contentDigest.slice(0, 18)}…</dd>
            </div>
          </dl>
        </details>
      )}
    </section>
  );

  if (resultId === null) return review;
  // Another send is offered only once this one has clearly finished: not
  // while it runs, and not while its result still needs checking.
  const shown = sends?.find((row) => row.sendId === resultId) ?? null;
  const finished = shown !== null && ["sent", "partial", "failed", "nothing", "draft"].includes(sendStatus(shown).key);
  const shownKey = shown === null ? null : sendStatus(shown).key;
  return (
    <>
      <section aria-label={t("Send result card")} className="card px-4 py-4 grid gap-3" data-send-result>
        <h4 className="text-cardtitle font-medium text-ink-100">{t("Send result")}</h4>
        <SendProgressPanel scope={scope} viewer={viewer} sendId={resultId} onChanged={onSendsChanged} />
        {shownKey === "sending" && (
          <p className="text-micro text-ink-500" data-stalled-hint>
            {t("If this stays on Sending for a long time it may have stopped. Check Activity before cloning this campaign to send again.")}
          </p>
        )}
        {shown?.state === "closed" && (
          <p className="text-label text-ink-300" data-closed-hint>
            {t("This send ended early. You can clone this campaign to send again; check who was already emailed first.")}
          </p>
        )}
        {canWrite && !again && finished && canStart(phase) && (
          <div>
            <button type="button" className="lnk text-label" onClick={() => setAgain(true)}>{t("Prepare another send")}</button>
          </div>
        )}
      </section>
      {again && review}
    </>
  );
}
