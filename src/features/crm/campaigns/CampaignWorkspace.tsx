import { useLocale } from "../locale";
import { Button,Link } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import { campaignChat } from "../../../bridge/chat";
import {
type AudienceBaseInput,
type AudienceScope
} from "../audienceClient";
import ActivityPane from "../campaign/ActivityPane";
import CampaignTabs from "../campaign/CampaignTabs";
import EmailPane from "../campaign/EmailPane";
import OverviewPane from "../campaign/OverviewPane";
import { setLanding } from "../campaign/landing";
import {
APPROVAL_ANCHOR,
TEST_ANCHOR,
sendReadiness,
type CampaignTab
} from "../campaign/readiness";
import { displayUiNotice, type UiNotice, useEmailDraft } from "../campaign/useEmailDraft";
import {
CAMPAIGN_NAME_MAX,
campaignTitle,
checkCampaignName,
friendlyCampaignError,
parseContentDoc,
parseProposalList,
parseRender,
type ContentDoc,
type ContentRender,
} from "../campaignGrammar";
import { contentClient } from "../contentClient";
import "../crm-campaign.css";
import {
friendlySendError,
parseTestSendReceipt,
readSmtpBinding,
sendClient,
type SmtpBinding,
type TestSendReceipt
} from "../sendClient";
import {
EMAIL_SENDING_HREF,
WAITING_APPROVAL_TEXT,
sendingFrom
} from "../sendingView";
import type { Viewer } from "../viewer";
import { useCrmQuery } from "../resources";


import HostPreview from "../../../bridge/HostPreview";
import FinalSendPanel from "./FinalSendPanel";
import ProposalRow from "./ProposalRow";
import SenderPanel from "./SenderPanel";

export default function CampaignWorkspace({
  scope,
  viewer,
  campaignId,
  doc,
  onDoc,
  onCloned,
  onDirtyChange,
  starterSenderBindingId,
  freezeId,
  freeze,
  audienceSlot,
  activitySlot,
  audienceLabel,
  tab,
  onTab,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
  doc: ContentDoc | null;
  onDoc: (doc: ContentDoc) => void;
  onCloned?: (campaignId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  starterSenderBindingId?: string | null;
  /** The detail page's named freeze + its last validity recheck —
   *  the final-send gate reads both. */
  freezeId?: string;
  freeze?: { valid: boolean | null } | null;
  /** CAD-1008: the saved campaign's audience/freeze panel, supplied by
   *  the owning page so the task order renders Content+Preview →
   *  approval → Audience → Sender → Test → Proposals → Final send.
   *  `undefined` on the new-campaign page, which keeps its own layout. */
  audienceSlot?: React.ReactNode;
  /** CAD-1055: the saved campaign's Activity tab body, the one-line
   *  audience summary for Overview and the controlled tab. */
  activitySlot?: React.ReactNode;
  audienceLabel?: string;
  tab?: CampaignTab;
  onTab?: (tab: CampaignTab) => void;
}) {
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const emailDraft = useEmailDraft(scope, campaignId, doc, onDoc);
  const [contentBindings, setContentBindings] = useState<{ id: string; name: string; address: string }[]>([]);
  const [contentBindingError, setContentBindingError] = useState<string | null>(null);
  const [contentBindingId, setContentBindingId] = useState<string | null>(starterSenderBindingId ?? null);
  useEffect(() => onDirtyChange?.(emailDraft.dirty), [emailDraft.dirty, onDirtyChange]);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneAudience, setCloneAudience] = useState(false);
  const [cloneSender, setCloneSender] = useState(false);
  const [clonePending, setClonePending] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const cloneDialogRef = useRef<HTMLDialogElement | null>(null);
  const [render, setRender] = useState<ContentRender | null>(null);
  const [renderPending, setRenderPending] = useState(false);
  const [renderError, setRenderError] = useState<UiNotice | null>(null);
  const [renderToken, setRenderToken] = useState(0);
  const [previewTab, setPreviewTab] = useState<"visual" | "html" | "text">("visual");
  const [sampleName, setSampleName] = useState("");
  const [approvePending, setApprovePending] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [testPending, setTestPending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testReceipt, setTestReceipt] = useState<TestSendReceipt | null>(null);
  // The live sender binding: `null` is the host's none-bound answer,
  // `undefined` is still-loading so dependent panels can wait.
  const [binding, setBinding] = useState<SmtpBinding | null | undefined>(undefined);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [bindingToken, setBindingToken] = useState(0);
  const proposalState = useCrmQuery(scope, "proposals.list", {}, parseProposalList);
  const proposals = proposalState.data?.filter(row => row.campaignId === campaignId) ?? [];
  const proposalsError = proposalState.error;
  const [proposalToken, setProposalToken] = useState(0);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [proposalNote, setProposalNote] = useState<string | null>(null);

  // A newly saved revision (create, Apply, save) invalidates test-send
  // evidence; the editor follows it inside `useEmailDraft`.
  const docIdentity = doc === null ? "none" : `${doc.revision}:${doc.contentDigest}`;
  const renderIdentity = `${docIdentity}:${contentBindingId ?? "preview"}`;
  useEffect(() => {
    const dialog = cloneDialogRef.current;
    if (dialog === null) return;
    if (cloneOpen && !dialog.open) dialog.showModal();
    if (!cloneOpen && dialog.open) dialog.close();
  }, [cloneOpen]);
  useEffect(() => {
    setTestReceipt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIdentity]);

  // Saved-version email preview (CAD-1008): the host-rendered saved
  // revision loads automatically on open, on every successful save and
  // on Refresh — never the unsaved editor bytes. The async answer is
  // dropped whenever the mounted campaign/revision or the request
  // generation moved on, so a stale render can never claim the new
  // saved revision.
  const renderLive = useRef<{ campaign: string; doc: string; seq: number }>({
    campaign: campaignId,
    doc: renderIdentity,
    seq: 0,
  });
  renderLive.current.campaign = campaignId;
  renderLive.current.doc = renderIdentity;
  useEffect(() => {
    if (doc === null) {
      setRender(null);
      setRenderPending(false);
      setRenderError(null);
      return;
    }
    const seq = ++renderLive.current.seq;
    const key = { campaign: campaignId, doc: renderIdentity };
    // The revision+digest the render is asked for — a server-side
    // concurrent save can answer with newer content even when the
    // client generation still matches, so the receipt is validated
    // against the doc it was requested for before it can claim it.
    const expected = doc === null ? null : { revision: doc.revision, digest: doc.contentDigest };
    setRender(null);
    setRenderPending(true);
    setRenderError(null);
    const controller = new AbortController();
    contentClient
      .render(scope, campaignId, {
        sampleFirstName: sampleName.trim() === "" ? undefined : sampleName.trim(),
        bindingId: contentBindingId ?? undefined,
      })
      .then((value) => {
        const live = renderLive.current;
        if (controller.signal.aborted || live.seq !== seq || live.campaign !== key.campaign || live.doc !== key.doc) return;
        const next = parseRender(value);
        if (next.bindingId !== (contentBindingId ?? "preview")) {
          setRender(null);
          setRenderError({ key: "The rendered sender selection changed while rendering — retry to refresh the preview." });
          return;
        }
        if (expected !== null && (next.revision !== expected.revision || next.contentDigest !== expected.digest)) {
          // A concurrent save moved the revision past the request:
          // surface the mismatch as a reload-needed state, never as
          // the current editor's render.
          setRender(null);
          setRenderError({
            key: "The saved campaign changed to r{rev} while the preview rendered — reload the campaign to see the current email.",
            slots: { rev: String(next.revision) },
          });
          return;
        }
        setRender(next);
      })
      .catch((err: unknown) => {
        const live = renderLive.current;
        if (controller.signal.aborted || live.seq !== seq || live.campaign !== key.campaign || live.doc !== key.doc) return;
        setRenderError(friendlyCampaignError(err));
      })
      .finally(() => {
        const live = renderLive.current;
        if (!controller.signal.aborted && live.seq === seq && live.campaign === key.campaign && live.doc === key.doc) {
          setRenderPending(false);
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.installId, scope.contextId, campaignId, docIdentity, contentBindingId, renderToken]);

  // These app-content sender rows are render metadata, not live SMTP
  // authority. Keep their binding IDs distinct from SmtpBinding.connectionId.
  useEffect(() => {
    if (!viewer.operator || scope.contextId === "") return;
    const controller = new AbortController();
    contentClient.bindingList(scope).then((value) => {
      if (controller.signal.aborted) return;
      const rows = (value as { bindings?: unknown } | null)?.bindings;
      setContentBindings(Array.isArray(rows) ? rows.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const sender = row.sender as Record<string, unknown> | null;
        return typeof row.binding_id === "string" && typeof sender?.name === "string" && typeof sender.address === "string"
          ? [{ id: row.binding_id, name: sender.name, address: sender.address }]
          : [];
      }) : []);
      setContentBindingError(null);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setContentBindingError(friendlyCampaignError(error));
    });
    return () => controller.abort();
  }, [scope.installId, scope.contextId, viewer.operator]);

  // The SMTP connection is context-global send authority. Keep it
  // separate from the preview-only app-content sender selection above.
  useEffect(() => {
    if (scope.contextId === "" || !viewer.operator) return;
    const controller = new AbortController();
    readSmtpBinding(scope)
      .then((value) => {
        if (!controller.signal.aborted) {
          setBinding(value);
          setBindingError(null);
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setBindingError(friendlySendError(e));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.installId, scope.contextId, viewer.operator, bindingToken]);


  // CAD-1016: refresh pending drafts on the agent's actual completion —
  // a new non-operator entry landing in the scoped thread (the assistant's
  // reply after the operator's ask), not merely the operator's send.
  // `useQuery` subscribes to the live thread store the SSE stream feeds.
  // CAD-1098: the selected conversation's thread, not the home thread.
  // The frame owns no thread store or assistant turn token. Refresh the
  // real stored proposals for a bounded window while this campaign is open.
  useEffect(() => {
    let ticks = 0;
    const timer = setInterval(() => {
      if (++ticks >= 60) clearInterval(timer);
      setProposalToken(count => count + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [campaignId]);
  // The campaign page opens on its own conversation; the picker still
  // switches to General. Runs per campaign, never on every render.
  useEffect(() => {
    if (scope.contextId === "" || !viewer.operator) return;
    void campaignChat.open(scope, campaignId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.installId, scope.contextId, campaignId]);

  useEffect(() => {
    if (proposalToken > 0) void proposalState.store.refresh();
  }, [proposalToken, proposalState.store]);

  // CAD-1016: no manual proposal-request mint — an ordinary scoped chat
  // message invokes the CAD-1014 assistant-draft turn, which lands an
  // inert `pending` proposal on this campaign. The drafts list below
  // refreshes to surface it; there is no request id to mint or poll.

  const dirty = emailDraft.dirty;

  const previewBody =
    doc === null ? (
      <p className="text-label text-ink-400" data-preview="unsaved">
        {t("No saved email yet. Ask the assistant in the left chat to draft this campaign's email, then Apply its verified proposal below to create revision 1.")}
      </p>
    ) : (
      <>
        <div className="crm-field-row">
          <div className="crm-field">
            <label className="text-label text-ink-300" htmlFor="cmp-sample">
              {t("Sample first name (optional)")}
            </label>
            <input
              id="cmp-sample"
              className="field"
              value={sampleName}
              onChange={(e) => setSampleName(e.target.value)}
              maxLength={40}
              autoComplete="off"
              placeholder={t("Ada")}
            />
          </div>
          <div>
            <span className="text-label text-ink-300">{t("Saved render")}</span>
            <div className="mt-1">
              <Button
                size="sm"
                loading={renderPending}
                disabled={renderPending}
                title={t("Re-render the last saved version with the current sample name")}
                onClick={() => setRenderToken((count) => count + 1)}
              >
                {t("Refresh preview")}
              </Button>
            </div>
          </div>
        </div>
        {renderError !== null && !renderPending && (
          <p className="text-label text-fail" role="alert">
            {displayUiNotice(renderError, t)}{" "}
            <button type="button" className="lnk" onClick={() => setRenderToken((count) => count + 1)}>
              {t("Retry")}
            </button>
          </p>
        )}
        {render === null && renderPending && (
          <p className="text-label text-ink-500" role="status" data-preview="loading">
            {t("Rendering the saved email…")}
          </p>
        )}
        {dirty && (
          <p className="text-micro text-ink-500" data-preview="dirty">
            {t("Preview shows the last saved version. Save changes to refresh.")}
          </p>
        )}
        {render !== null && (
          <>
            <p className="text-label text-ink-300">
              <span className="chip" title={t("Sender material is host-locked preview-only bytes")}>
                {t("preview-only")}
              </span>{" "}
              <span className="num">
                {render.sender.name} · {render.sender.address}
              </span>
            </p>
            <div className="app-outlet-tabs" role="tablist" aria-label={t("Preview format")}>
              {(
                [
                  ["visual", t("Visual")],
                  ["html", "HTML"],
                  ["text", t("Text")],
                ] as ["visual" | "html" | "text", string][]
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={previewTab === tab}
                  className="app-outlet-tab"
                  data-on={previewTab === tab || undefined}
                  onClick={() => setPreviewTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
            {previewTab === "visual" && (
              <HostPreview title={`${t("Visual email preview, saved revision")} ${formatNumber(render.revision)}`} document={render.html} mode="saved" />
            )}
            {previewTab !== "visual" && (
              <pre className="crm-preview" data-preview={previewTab}>
                {previewTab === "html" ? render.html : render.text}
              </pre>
            )}
            <SenderPanel render={render} />
          </>
        )}
      </>
    );

  const previewSection = (
    <section aria-label={t("Email preview")} className="card px-4 py-4 grid gap-3">
      <h4 className="text-cardtitle font-medium text-ink-100">
        {t("Preview")}{doc !== null ? ` — ${t("saved version")}` : ""}
      </h4>
      {previewBody}
    </section>
  );

  const contentForm = (
      <div className="card px-4 py-4 grid gap-3" aria-label={t("Email content")}>
        <h4 className="text-cardtitle font-medium text-ink-100">
          {t("Content")} {doc === null ? `— ${t("not drafted yet")}` : `— ${t("revision")} ${formatNumber(doc.revision)}`}
        </h4>
        {doc === null && (
          <p className="text-label text-ink-400" data-state="no-draft">
            {t("No email draft yet. Ask the assistant in the left chat to draft this campaign's email, then Apply its verified proposal below to create revision 1 — or use the inline editor after a draft exists.")}
          </p>
        )}
        {doc !== null && (
          <dl className="sdetail" data-content-summary>
            <div>
              <dt>{t("Subject")}</dt>
              <dd>{doc.subject}</dd>
            </div>
            <div>
              <dt>{t("Preheader")}</dt>
              <dd>{doc.preheader === "" ? "—" : doc.preheader}</dd>
            </div>
            <div>
              <dt>{t("Body")}</dt>
              <dd>
                {doc.mode === "html"
                  ? t("HTML body")
                  : `${formatNumber(doc.blocks.length)} ${t(doc.blocks.length === 1 ? "block" : "blocks")}`}{" "}
                · {doc.contentDigest.slice(0, 18)}…
              </dd>
            </div>
          </dl>
        )}
        {doc !== null && (
          <p className="text-label text-ink-400">
            {t("Edit the email on the campaign's Email tab.")}
          </p>
        )}
      </div>
  );

  const approvalSection = doc !== null && (
        <section aria-label={t("Content approval")} id={APPROVAL_ANCHOR} tabIndex={-1} className="card px-4 py-4 grid gap-2">
          <h4 className="text-cardtitle font-medium text-ink-100">{t("Approval — content-only")}</h4>
          <p className="text-label text-ink-300">
            {doc.approval.valid ? (
              <span className="chip" title={t("Content-only approval on this revision")}>
                {t("Approved")} r{doc.approval.revision === null ? "" : formatNumber(doc.approval.revision)}
              </span>
            ) : (
              t("No content approval on this revision. Any content edit invalidates approval.")
            )}{" "}
            <span className="text-ink-500">
              {t("Approval never sends — the bounded send below is a separate operator decision over exact revisions.")}
            </span>
          </p>
          {approveError && (
            <p className="text-label text-fail" role="alert">
              {t(approveError)}
            </p>
          )}
          {canWrite && !doc.approval.valid && (
            <div>
              <Button
                size="sm"
                loading={approvePending}
                disabled={approvePending}
                onClick={() => {
                  setApprovePending(true);
                  setApproveError(null);
                  void contentClient
                    .approve(scope, campaignId, doc.revision)
                    .then((value) => onDoc(parseContentDoc(value)))
                    .catch((err: unknown) => setApproveError(friendlyCampaignError(err)))
                    .finally(() => setApprovePending(false));
                }}
              >
                {t("Approve r")}{formatNumber(doc.revision)} ({t("content-only")})
              </Button>
            </div>
          )}
        </section>
  );

  const testSection = doc !== null && (
        <section aria-label={t("Test send")} id={TEST_ANCHOR} tabIndex={-1} className="card px-4 py-4 grid gap-2 crm-test">
          <h4 className="text-cardtitle font-medium text-ink-100">
            {t("Test send — one operator address")}
          </h4>
          <p className="text-label text-ink-400">
            {t("Sends the exact frozen content through the campaign sender to one operator-typed address. The receipt records acceptance or refusal only — a campaign send needs one accepted test send of this exact content and sender.")}
          </p>
          {bindingError !== null && (
            <p className="text-label text-fail" role="alert">
              {t(bindingError)}{" "}
              <button
                type="button"
                className="lnk"
                onClick={() => {
                  setBinding(undefined);
                  setBindingError(null);
                  setBindingToken((count) => count + 1);
                }}
              >
                {t("Retry")}</button>
            </p>
          )}
          {binding !== undefined && sendingFrom(binding) === null && bindingError === null && (
            <p className="text-label text-ink-500" data-testsend="disabled">
              {t("No sender is set up")} — <Link href={EMAIL_SENDING_HREF}>{t("set up sending")}</Link> {t("to send a test.")}
            </p>
          )}
          <form
            className="crm-field-row"
            onSubmit={(e) => {
              e.preventDefault();
              setTestError(null);
              setTestReceipt(null);
              setTestPending(true);
              void sendClient
                .smtpTestSend(scope, campaignId)
                .then((value) => setTestReceipt(parseTestSendReceipt(value)))
                .catch((err: unknown) => setTestError(friendlySendError(err)))
                .finally(() => setTestPending(false));
            }}
          >
            <p className="text-label text-ink-300">Enter the recipient in the host-owned test-send confirmation.</p>
            <div>
              <span className="text-label text-ink-300">{t("Send")}</span>
              <div className="mt-1">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={testPending}
                  disabled={!canWrite || testPending || sendingFrom(binding) === null}
                  title={
                    sendingFrom(binding) === null
                      ? t("No sender is set up")
                      : t("Send one test message through the campaign sender")
                  }
                >
                  {t("Send test")}
                </Button>
              </div>
            </div>
          </form>
          {testError && (
            <p className="text-label text-fail" role="alert">
              {t(testError)}
            </p>
          )}
          {testReceipt && (
            <dl className="crm-detail" aria-label={t("Test-send receipt")} data-testreceipt>
              <div>
                <dt>{t("Result")}</dt>
                <dd>
                  {testReceipt.pendingApproval ? (
                    <span className="chip crm-send-chip" data-state="pending">
                      {t(WAITING_APPROVAL_TEXT)}
                    </span>
                  ) : (
                    <>
                      <span
                        className="chip crm-send-chip"
                        data-state={testReceipt.accepted ? "accepted" : "failed"}
                      >
                        {t(testReceipt.accepted ? "Accepted" : "Refused")}
                      </span>{" "}
                      <span className="num">
                        SMTP {testReceipt.smtpCode ?? "—"} {testReceipt.smtpMessage}
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("Recipient")}</dt>
                <dd className="num">{testReceipt.to}</dd>
              </div>
              <div>
                <dt>{t("Claim")}</dt>
                <dd className="text-ink-300">
                  {testReceipt.pendingApproval
                    ? t("Nothing was sent yet. Send the same test again once the owner has approved it.")
                    : t("The sender accepted the message — this is not proof of inbox delivery.")}
                </dd>
              </div>
              <div>
                <dt>{t("Details")}</dt>
                <dd>
                  <details>
                    <summary className="cursor-pointer text-ink-400">{t("Show")}</summary>
                    <span className="num break-all">
                      r{formatNumber(testReceipt.contentRevision)} · {testReceipt.contentDigest.slice(0, 18)}…
                    </span>
                  </details>
                </dd>
              </div>
            </dl>
          )}
        </section>
  );

  const applyProposal = (next: ContentDoc) => {
    onDoc(next);
    setProposalToken((count) => count + 1);
    setRender(null);
    setTestReceipt(null);
    setProposalNote(
      `${t("Applied as revision")} ${formatNumber(next.revision)} — ${t("content approval invalidated; re-approve before any send preparation.")}`,
    );
  };
  const discardProposal = (id: string) => {
    setProposalToken((count) => count + 1);
    setProposalNote(
      doc === null
        ? `${t("Proposal")} ${id} ${t("discarded — still no saved revision.")}`
        : `${t("Proposal")} ${id} ${t("discarded — draft unchanged at r")}${formatNumber(doc.revision)} (${doc.contentDigest.slice(0, 18)}…).`,
    );
  };

  // CAD-1013: proposals stay available before revision 1 — the assistant
  // mint/apply path is the creation route now that the manual composer is
  // gone. expectedRevision is 0 for an unsaved campaign (source_revision=0).
  const proposalsSection = (
        <section aria-label={t("Assistant proposals")} className="card px-4 py-4 grid gap-3">
          <h4 className="text-cardtitle font-medium text-ink-100">{t("Proposals — Apply or Discard")}</h4>
          <p className="text-label text-ink-400">
            {t("Only Apply changes the saved version (approval invalidates); Discard is non-mutating. Nothing proposes, edits or sends silently.")}
          </p>
          {proposalsError && (
            <p className="text-label text-fail" role="alert">
              {t(proposalsError)}{" "}
              <button type="button" className="lnk" onClick={() => setProposalToken((count) => count + 1)}>
                {t("Retry")}</button>
            </p>
          )}
          {proposalError && (
            <p className="text-label text-fail" role="alert">
              {t(proposalError)}
            </p>
          )}
          {proposalNote && (
            <p className="text-label text-ok" role="status">
              {proposalNote}
            </p>
          )}
          {canWrite && (
            <p className="text-label text-ink-500" data-assistant-hint>
              {t("Ask the assistant in the left chat to draft this email — its proposal appears below for review.")}{" "}
              <button
                type="button"
                className="lnk"
                onClick={() => setProposalToken((count) => count + 1)}
              >
                {t("Refresh drafts")}
              </button>
            </p>
          )}
          {proposals.filter((row) => row.state === "pending").length === 0 ? (
            <p className="text-label text-ink-400" data-empty="proposals">
              {t("No pending proposals for this campaign.")}
            </p>
          ) : (
            <ol className="crm-history" aria-label={t("Pending proposals")}>
              {proposals
                .filter((row) => row.state === "pending")
                .map((row) => (
                  <ProposalRow
                    key={row.proposalId}
                    scope={scope}
                    proposal={row}
                    expectedRevision={doc === null ? 0 : doc.revision}
                    canWrite={canWrite}
                    onApplied={applyProposal}
                    onDiscarded={discardProposal}
                    onError={setProposalError}
                  />
                ))}
            </ol>
          )}
        </section>
  );

  const finalSend = doc !== null && freezeId !== undefined && (
    <FinalSendPanel
      scope={scope}
      viewer={viewer}
      campaignId={campaignId}
      doc={doc}
      freezeId={freezeId}
      freeze={freeze ?? null}
      binding={binding}
      testEvidence={testReceipt}
    />
  );

  const canCopyAudience = freezeId !== undefined && freeze?.valid === true;
  const canCopySender = contentBindingId !== null && render !== null && !renderPending && render.bindingId === contentBindingId && render.bindingId !== "preview";
  const cloneSavedCampaign = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite || doc === null || onCloned === undefined) return;
    const name = cloneName.trim();
    try {
      checkCampaignName(name);
    } catch (error) {
      setCloneError(friendlyCampaignError(error));
      return;
    }
    if ((cloneAudience && !canCopyAudience) || (cloneSender && !canCopySender)) {
      setCloneError("A selected starter setting is no longer available. Recheck it and try again.");
      return;
    }
    setClonePending(true);
    setCloneError(null);
    void contentClient.clone(scope, campaignId, {
      expectedRevision: doc.revision,
      name,
      ...(cloneAudience && freezeId !== undefined ? { copyAudience: { sourceFreezeId: freezeId } } : {}),
      ...(cloneSender && canCopySender && render !== null && render.bindingId !== "preview"
        ? { copySender: { sourceBindingId: render.bindingId } }
        : {}),
    }).then((result) => {
      const newId = result.content.campaign_id;
      const starterBase = result.starterSelection.audience?.base;
      const audienceBase: AudienceBaseInput | null = starterBase === undefined
        ? null
        : starterBase.mode === "all"
          ? { mode: "all" }
          : starterBase.mode === "segment"
            ? { mode: "segment", segmentId: starterBase.segment_id }
            : { mode: "custom", customerIds: starterBase.customer_ids };
      setLanding({
        campaignId: newId,
        tab: "email",
        segmentId: null,
        audienceBase,
        exclusionListId: result.starterSelection.audience?.exclusionListId ?? null,
        senderBindingId: result.starterSelection.senderBindingId,
      });
      setCloneOpen(false);
      onCloned(newId);
    }).catch((error: unknown) => setCloneError(friendlyCampaignError(error))).finally(() => setClonePending(false));
  };

  // New campaign (or a host without an audience slot): content first
  // with the always-mounted preview beside it; the audience picker
  // stays on the new page itself. Saved campaigns take the ordered
  // task layout below.
  if (audienceSlot === undefined) {
    return (
      <div className="grid gap-3">
        <div className="crm-compose">
          {contentForm}
          {previewSection}
        </div>
        {approvalSection}
        {testSection}
        {proposalsSection}
        {finalSend}
      </div>
    );
  }
  // CAD-1055 saved campaign: four tabs. Overview stays compact; the
  // revision-bound approval, test and final-send controls remain distinct
  // guarded actions. Email owns editing and assistant proposal review.
  const activeTab = tab ?? "overview";
  const setTab = onTab ?? (() => {});
  const readiness = sendReadiness({
    doc,
    freezeId: freezeId ?? "",
    freeze: freeze ?? null,
    binding,
    testEvidence: testReceipt,
  });
  const pendingProposals = proposals.filter((row) => row.state === "pending");
  const emailBadge = pendingProposals.length > 0 ? t("{count} draft").replace("{count}", () => formatNumber(pendingProposals.length)) : null;
  return (
    <>
      {onCloned !== undefined && doc !== null && (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!canWrite}
            onClick={() => {
              setCloneName(`${campaignTitle(doc)} — Copy`);
              setCloneAudience(canCopyAudience);
              setCloneSender(canCopySender);
              setCloneError(null);
              setCloneOpen(true);
            }}
          >
            {t("Clone campaign")}
          </Button>
        </div>
      )}
      <dialog
        ref={cloneDialogRef}
        className="crm-clone-dialog"
        aria-labelledby="cmp-clone-title"
        onCancel={(event) => { event.preventDefault(); setCloneOpen(false); }}
        onClose={() => setCloneOpen(false)}
      >
        <form className="grid gap-3 p-4" onSubmit={cloneSavedCampaign}>
          <h2 id="cmp-clone-title" className="text-cardtitle font-medium text-ink-100">{t("Clone campaign")}</h2>
          <p className="text-label text-ink-300">{t("Creates a new draft from this campaign's saved revision. Approval, frozen recipients, proposals, test receipts, preparation and send history are not copied. Sender selection is context-shared preview metadata only; it never rebinds SMTP or authorizes sending.")}</p>
          <label className="grid gap-1 text-label text-ink-300" htmlFor="cmp-clone-name">
            {t("New campaign name")}
            <input id="cmp-clone-name" className="field" value={cloneName} maxLength={CAMPAIGN_NAME_MAX} required disabled={clonePending} onChange={(event) => setCloneName(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-label text-ink-300">
            <input type="checkbox" checked={cloneAudience} disabled={!canCopyAudience || clonePending} onChange={(event) => setCloneAudience(event.target.checked)} />
            {t("Copy audience criteria")}{canCopyAudience ? t("from the current valid freeze") : t("(no valid source freeze)")}
          </label>
          <label className="flex items-center gap-2 text-label text-ink-300">
            <input type="checkbox" checked={cloneSender} disabled={!canCopySender || clonePending} onChange={(event) => setCloneSender(event.target.checked)} />
            {t("Copy selected sender preview")} {canCopySender ? `(${render?.sender.name})` : t("(select a non-preview sender in Email first)")}
          </label>
          {emailDraft.dirty && <p className="text-label text-warn" role="status">{t("Unsaved edits are not included. Save them first if you want to clone the changes.")}</p>}
          {cloneError !== null && <p className="text-label text-fail" role="alert">{t(cloneError)}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={clonePending} onClick={() => setCloneOpen(false)}>{t("Cancel")}</Button>
            <Button type="submit" variant="primary" loading={clonePending} disabled={clonePending || !canWrite || doc === null}>{t("Clone as new draft")}</Button>
          </div>
        </form>
      </dialog>
      <CampaignTabs
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "email", label: "Email", badge: emailBadge },
        { id: "audience", label: "Audience" },
        { id: "activity", label: "Activity" },
      ]}
      active={activeTab}
      onChange={setTab}
    >
      {activeTab === "overview" && (
        <>
          <OverviewPane
            items={readiness}
            doc={doc}
            binding={binding}
            audienceLabel={audienceLabel ?? "—"}
            onTab={setTab}
          />
          {approvalSection !== null && (
            <details className="crm-diag" data-overview-guard="content-approval">
              <summary className="text-label text-ink-300">{t("Content approval — separate decision")}</summary>
              {approvalSection}
            </details>
          )}
          {testSection !== null && (
            <details className="crm-diag" data-overview-guard="test-send">
              <summary className="text-label text-ink-300">{t("Test email — separate action")}</summary>
              {testSection}
            </details>
          )}
          {finalSend !== null && (
            <details className="crm-diag" data-overview-guard="final-send">
              <summary className="text-label text-ink-300">{t("Final send — separate operator review")}</summary>
              {finalSend}
            </details>
          )}
        </>
      )}
      {activeTab === "email" && (
        <EmailPane
          scope={scope}
          canWrite={canWrite}
          doc={doc}
          render={render}
          renderPending={renderPending}
          renderError={renderError}
          onRefresh={() => setRenderToken((count) => count + 1)}
          sampleName={sampleName}
          onSampleName={setSampleName}
          senderBindings={contentBindings}
          senderBindingId={contentBindingId}
          onSenderBindingId={(id) => { setContentBindingId(id); setRender(null); }}
          senderBindingError={contentBindingError}
          dirty={dirty}
          proposals={pendingProposals}
          proposalsError={proposalsError}
          proposalError={proposalError}
          proposalNote={proposalNote}
          onRefreshDrafts={() => setProposalToken((count) => count + 1)}
          onDiscarded={discardProposal}
          onProposalError={setProposalError}
          edit={canWrite ? emailDraft : null}
        />
      )}
      {activeTab === "audience" && audienceSlot}
      {activeTab === "activity" && (
        <ActivityPane
          campaignId={campaignId}
          contextId={scope.contextId}
          doc={doc}
          proposals={proposals}
          render={render}
          binding={binding}
          sends={activitySlot}
        />
      )}
      </CampaignTabs>
    </>
  );
}

/**
 * One pending proposal. The CAD-813 render rule is strict: only
 * `actor == "assistant"` AND a non-null `assistant_receipt` earns the
 * verified badge — an operator submission (or a receipt-less row) is
 * always labelled operator-submitted, never assistant, whatever its
 * text looks like. A pending row whose stamped source drifted behind
 * the current draft renders "Needs review (stale)" with Apply
 * disabled — the operator re-reviews instead of merging late output.
 */
