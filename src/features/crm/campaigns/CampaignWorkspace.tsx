import { useLocale } from "../locale";
import { Button } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import { campaignChat } from "../../../bridge/chat";
import {
type AudienceBaseInput,
type AudienceScope
} from "../audienceClient";
import ActivityPane from "../campaign/ActivityPane";
import CampaignTabs from "../campaign/CampaignTabs";
import EmailPane from "../campaign/EmailPane";
import { setLanding } from "../campaign/landing";
import {
type AudienceState,
type CampaignTab
} from "../campaign/readiness";
import { type UiNotice, useEmailDraft } from "../campaign/useEmailDraft";
import {
CAMPAIGN_NAME_MAX,
campaignTitle,
checkCampaignName,
friendlyCampaignError,
parseProposalList,
parseRender,
type ContentDoc,
type ContentRender,
} from "../campaignGrammar";
import { contentClient } from "../contentClient";
import "../crm-campaign.css";
import {
friendlySendError,
readSmtpBinding,
type SendListEntry,
type SendSelection,
type SmtpBinding,
type TestSendReceipt
} from "../sendClient";
import type { Viewer } from "../viewer";
import { useCrmQuery } from "../resources";


import FinalSendPanel from "./FinalSendPanel";

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
  selection,
  audience,
  audienceTitle,
  sends,
  onSendsChanged,
  audienceSlot,
  activitySlot,
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
  /** The audience's derived snapshot id (null = no audience chosen) and its
   *  last validity check; clone reads both. */
  freezeId: string | null;
  freeze: { valid: boolean | null; finalCount?: number } | null;
  /** CAD-1836: the audience the send freezes with its one approval. */
  selection: SendSelection | null;
  audience: AudienceState;
  audienceTitle: string | null;
  sends: SendListEntry[] | null;
  onSendsChanged: () => void;
  audienceSlot: React.ReactNode;
  activitySlot: React.ReactNode;
  tab: CampaignTab;
  onTab: (tab: CampaignTab) => void;
}) {
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const emailDraft = useEmailDraft(scope, campaignId, doc, onDoc);
  // A starter sender carried from a clone only picks which saved sender the
  // preview borrows; the real sender is the connected one below.
  const [contentBindingId] = useState<string | null>(starterSenderBindingId ?? null);
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
  const [sampleName, setSampleName] = useState("");
  // Debounce the sample name so typing does not issue one host render per
  // keystroke; the render effect's sequence guard still drops stale answers.
  const [renderSample, setRenderSample] = useState(sampleName);
  useEffect(() => {
    const timer = setTimeout(() => setRenderSample(sampleName), 300);
    return () => clearTimeout(timer);
  }, [sampleName]);
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
        sampleFirstName: renderSample.trim() === "" ? undefined : renderSample.trim(),
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
  }, [scope.installId, campaignId, docIdentity, contentBindingId, renderToken, renderSample]);

  // The SMTP connection is context-global send authority. Keep it
  // separate from the preview-only app-content sender selection above.
  useEffect(() => {
    if (!viewer.operator) return;
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
  }, [scope.installId, viewer.operator, bindingToken]);

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
    if (!viewer.operator) return;
    void campaignChat.open(scope, campaignId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.installId, campaignId]);

  useEffect(() => {
    if (proposalToken > 0) void proposalState.store.refresh();
  }, [proposalToken, proposalState.store]);

  const discardProposal = (id: string) => {
    setProposalToken((count) => count + 1);
    setProposalNote(
      doc === null
        ? `${t("Proposal")} ${id} ${t("discarded — still no saved revision.")}`
        : `${t("Proposal")} ${id} ${t("discarded — draft unchanged at r")}${formatNumber(doc.revision)} (${doc.contentDigest.slice(0, 18)}…).`,
    );
  };

  const canCopyAudience = freezeId !== null && freeze?.valid === true;
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
      ...(cloneAudience && freezeId !== null ? { copyAudience: { sourceFreezeId: freezeId } } : {}),
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

  const pendingProposals = proposals.filter((row) => row.state === "pending");
  const emailBadge = pendingProposals.length > 0 ? t("{count} draft").replace("{count}", () => formatNumber(pendingProposals.length)) : null;
  return (
    <>
      <dialog
        ref={cloneDialogRef}
        className="crm-clone-dialog"
        aria-labelledby="cmp-clone-title"
        onCancel={(event) => { event.preventDefault(); setCloneOpen(false); }}
        onClose={() => setCloneOpen(false)}
      >
        <form className="grid gap-3 p-4" onSubmit={cloneSavedCampaign}>
          <h2 id="cmp-clone-title" className="text-cardtitle font-medium text-ink-100">{t("Clone campaign")}</h2>
          <p className="text-label text-ink-300">{t("Creates a new draft from this campaign's saved email. Recipients, tests, assistant drafts and send history aren't copied.")}</p>
          <label className="grid gap-1 text-label text-ink-300" htmlFor="cmp-clone-name">
            {t("New campaign name")}
            <input id="cmp-clone-name" className="field" value={cloneName} maxLength={CAMPAIGN_NAME_MAX} required disabled={clonePending} onChange={(event) => setCloneName(event.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-label text-ink-300">
            <input type="checkbox" checked={cloneAudience} disabled={!canCopyAudience || clonePending} onChange={(event) => setCloneAudience(event.target.checked)} />
            {t("Copy the audience")}{canCopyAudience ? "" : ` ${t("(none chosen yet)")}`}
          </label>
          {canCopySender && (
            <label className="flex items-center gap-2 text-label text-ink-300">
              <input type="checkbox" checked={cloneSender} disabled={clonePending} onChange={(event) => setCloneSender(event.target.checked)} />
              {t("Copy the sender preview")} ({render?.sender.name})
            </label>
          )}
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
        { id: "email", label: "Email", badge: emailBadge },
        { id: "audience", label: "Audience" },
        { id: "review", label: "Review and send" },
        { id: "activity", label: "Activity" },
      ]}
      active={tab}
      onChange={onTab}
      actions={onCloned !== undefined && doc !== null ? (
        <Button
          size="sm"
          disabled={!canWrite}
          title={t("Copy this campaign's saved version into a new draft")}
          onClick={() => {
            setCloneName(`${campaignTitle(doc)} — Copy`);
            setCloneAudience(canCopyAudience);
            setCloneSender(canCopySender);
            setCloneError(null);
            setCloneOpen(true);
          }}
        >
          {t("Clone")}
        </Button>
      ) : undefined}
    >
      {tab === "email" && (
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
          binding={binding}
          bindingError={bindingError}
          onRetryBinding={() => { setBinding(undefined); setBindingError(null); setBindingToken((count) => count + 1); }}
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
      {tab === "audience" && audienceSlot}
      {tab === "review" && (doc === null ? (
        <p className="card px-4 py-4 text-label text-ink-400" data-state="no-draft">
          {t("There's no saved email yet. Ask the assistant to draft one, then apply it on the Email tab.")}
        </p>
      ) : (
        <>
          {bindingError !== null && (
            <p className="text-label text-fail" role="alert">
              {t(bindingError)}{" "}
              <button type="button" className="lnk" onClick={() => { setBinding(undefined); setBindingError(null); setBindingToken((count) => count + 1); }}>
                {t("Retry")}
              </button>
            </p>
          )}
          <FinalSendPanel
            scope={scope}
            viewer={viewer}
            campaignId={campaignId}
            doc={doc}
            freezeId={freezeId}
            selection={selection}
            binding={binding}
            testEvidence={testReceipt}
            onTestEvidence={setTestReceipt}
            audience={audience}
            audienceTitle={audienceTitle}
            sends={sends}
            onSendsChanged={onSendsChanged}
            onTab={onTab}
            onDoc={onDoc}
          />
        </>
      ))}
      {tab === "activity" && (
        <ActivityPane
          campaignId={campaignId}
          doc={doc}
          proposals={proposals}
          render={render}
          binding={binding}
          testEvidence={testReceipt}
          sends={sends}
          sendsSlot={activitySlot}
        />
      )}
      </CampaignTabs>
    </>
  );
}
