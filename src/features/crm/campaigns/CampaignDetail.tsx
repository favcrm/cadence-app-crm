import { useLocale } from "../locale";
import { ApiError,ConfirmDialog } from "@cadence/screen-ui";
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from "react";
import { channel } from "../../../bridge/channel";
import {
audienceClient,
type AudienceScope
} from "../audienceClient";
import { clearLanding,peekLanding } from "../campaign/landing";
import {
type AudienceState,
type CampaignTab
} from "../campaign/readiness";
import { blockingReason } from "../campaign/EligibilityFunnel";
import { chainKey,publishCurrent,useChain } from "../campaign/sendChainStore";
import { campaignStatus } from "../campaign/sendStatus";
import { useAudiencePreview } from "../campaign/useAudiencePreview";
import {
campaignTitle,
parseContentDoc,
parseProposalList,
} from "../campaignGrammar";
import { QueryRefresh,useCrmQuery } from "../resources";
import "../crm-campaign.css";
import { parseSegmentList } from "../segments/Segments";
import type { Viewer } from "../viewer";


import AudienceSection from "./AudienceSection";
import CampaignSends from "./CampaignSends";
import CampaignWorkspace from "./CampaignWorkspace";
import { audienceFreezeId,sendCeiling,type AudiencePick } from "./audienceModel";
import { useCampaignSends } from "./useCampaignSends";
import { useDraftAudience } from "./useDraftAudience";

export default function CampaignDetail({
  scope,
  viewer,
  campaignId,
  onBack,
  onCloned,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  campaignId: string;
  onBack: () => void;
  onCloned: (campaignId: string) => void;
}) {
  const { t } = useLocale();
  const headRef = useRef<HTMLHeadingElement | null>(null);
  const queryState = useCrmQuery(scope, "content.show", { campaign_id: campaignId }, parseContentDoc);
  const proposalState = useCrmQuery(scope, "proposals.list", {}, parseProposalList);
  const doc = queryState.data;
  const missing = queryState.failure instanceof ApiError && queryState.failure.status === 404;
  const pendingOnly = missing && (proposalState.data?.some(row => row.campaignId === campaignId && row.state === "pending") ?? false);
  const loading = queryState.loading || (missing && proposalState.loading);
  const error = pendingOnly ? null : queryState.error;
  const setDoc = (next: NonNullable<typeof doc>) => queryState.store.write(() => next);
  const [unsaved, setUnsaved] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Keep callbacks and cleanup bound to this editor, even if a later editor
  // on the same port has already acquired its own warning publisher.
  const leaveState = useMemo(() => ({ active: false, publisher: null as ReturnType<typeof channel.ownCampaignLeaveState> }),
    [scope.installId, campaignId]);
  useLayoutEffect(() => {
    leaveState.active = true;
    leaveState.publisher = channel.ownCampaignLeaveState();
    leaveState.publisher?.publish(false);
    return () => {
      leaveState.active = false;
      leaveState.publisher?.release();
      leaveState.publisher = null;
    };
  }, [leaveState]);
  const onDirtyChange = useCallback((dirty: boolean) => {
    if (!leaveState.active) return;
    setUnsaved(dirty);
    leaveState.publisher?.publish(dirty);
  }, [leaveState]);
  // CAD-1058: a campaign just created from the dialog lands on its Email
  // tab, with the segment the operator picked there (if any). Peeked on
  // mount and cleared in an effect, so the hand-off is one-shot.
  const [landingSegmentId] = useState(() => peekLanding(campaignId)?.segmentId ?? null);
  const [starterSenderBindingId] = useState(() => peekLanding(campaignId)?.senderBindingId ?? null);
  // A landing audience (new campaign, clone) counts as an explicit pick: the
  // saved audience must never replace what the operator chose to start with.
  const pickEdited = useRef(
    peekLanding(campaignId)?.audienceBase != null || peekLanding(campaignId)?.segmentId != null,
  );
  // Nothing is chosen until the owner chooses (or the board gives one back).
  const [pick, setPick] = useState<AudiencePick>(() => {
    const landing = peekLanding(campaignId);
    return {
      base:
        landing?.audienceBase ??
        (landingSegmentId !== null ? { mode: "segment", segmentId: landingSegmentId } : null),
      exclusionListId: landing?.exclusionListId ?? null,
    };
  });
  const segmentState = useCrmQuery(scope, "segments.list", {}, parseSegmentList);
  const segments = segmentState.data ?? [];
  // Exclusions are not saved with the campaign, so an active one is named on
  // the Review row: the owner sees exactly who is being left out.
  const exclusionState = useCrmQuery(scope, "exclusions.list", {}, (value): { id: string; name: string }[] => {
    const rows = (value as { exclusions?: unknown } | null)?.exclusions;
    return Array.isArray(rows) ? rows.flatMap((row: { id?: unknown; name?: unknown }) => typeof row?.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name }] : []) : [];
  });
  const count = useAudiencePreview(scope, viewer, pick);
  const sendsState = useCampaignSends(scope, viewer.operator === true, campaignId);
  const listedStatus = campaignStatus(sendsState.sends);
  const [tab, setTab] = useState<CampaignTab>(() => peekLanding(campaignId)?.tab ?? "review");
  const ceiling = count.preview !== null && count.preview.finalCount > 0 ? sendCeiling(count.preview.finalCount) : null;
  const freezeId = audienceFreezeId(campaignId, pick, ceiling);
  const [freeze, setFreeze] = useState<{
    finalCount: number;
    digest: string;
    valid: boolean | null;
    drift: string | null;
    currentCount: number | null;
  } | null>(null);

  // The running send lives in a module-level store keyed by campaign, not in
  // this component: this page remounts on a route change or back/forward
  // while the host card stays alive, and the lock must come back with it.
  const chainId = chainKey(scope.installId, campaignId);
  const chain = useChain(chainId);
  const sendPhase = chain.phase;
  // A card may have been confirmed that the list does not show yet: never
  // read that as Draft.
  const status =
    chain.phase === null && (listedStatus === null || listedStatus.key === "draft") && chain.approvedSendId !== null ? { key: "sending" as const, label: "Sending", chip: "running" as const }
    : chain.phase === null && (listedStatus === null || listedStatus.key === "draft") && chain.pendingSendId !== null ? { key: "uncertain" as const, label: "Check result", chip: "uncertain" as const }
    : listedStatus;
  // A chain that ended (maybe while this page was gone) means the host's
  // send list has moved; a stale count means the button must recount.
  const refreshSends = sendsState.refresh;
  useEffect(() => { if (chain.ended > 0) refreshSends(); }, [chain.ended, refreshSends]);
  const recount = count.recount;
  useEffect(() => { if (chain.recount > 0) recount(); }, [chain.recount, recount]);
  const requestBack = () => {
    if (sendPhase !== null) return;
    if (unsaved) setConfirmLeave(true);
    else onBack();
  };

  useEffect(() => {
    headRef.current?.focus();
    clearLanding(campaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reopen on the audience the board kept — before the first paint, so the
  // page never flashes "Not chosen". An older board's segment hint still
  // restores a segment, read-only.
  const [hydrated, setHydrated] = useState(pickEdited.current);
  const kept = doc?.draftAudience;
  const legacySegment = doc?.legacySegmentId ?? null;
  useLayoutEffect(() => {
    if (doc === null) return;
    if (pickEdited.current) { setHydrated(true); return; }
    setHydrated(true);
    const restored = kept ?? (kept === undefined && legacySegment !== null ? { mode: "segment" as const, segmentId: legacySegment } : null);
    if (restored !== null) setPick((current) => ({ ...current, base: restored }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.campaignId, JSON.stringify(kept), legacySegment]);

  const [typingIds, setTypingIds] = useState(false);
  const draftAudience = useDraftAudience(scope, campaignId, doc, setDoc, pick, unsaved, typingIds);

  // Every check carries a generation: an older lookup resolving after a
  // newer one (audience changed mid-flight) can never paint its row.
  const freezeGeneration = useRef(0);

  const checkFreeze = () => {
    const generation = (freezeGeneration.current += 1);
    if (freezeId === null) {
      setFreeze(null);
      return;
    }
    void audienceClient
      .freezeShow(scope, freezeId)
      .then((value) => {
        if (generation !== freezeGeneration.current) return;
        const root = (value as Record<string, unknown> | null) ?? {};
        const row = (root.freeze as Record<string, unknown> | null) ?? {};
        setFreeze({
          finalCount: typeof row.final_count === "number" ? row.final_count : -1,
          digest: typeof row.digest === "string" ? row.digest : "",
          valid: typeof root.valid === "boolean" ? root.valid : null,
          drift: typeof root.drift === "string" ? root.drift : null,
          currentCount: typeof root.current_final_count === "number" ? root.current_final_count : null,
        });
      })
      .catch((err: unknown) => {
        if (generation !== freezeGeneration.current) return;
        // CAD-1178: a missing freeze is the normal "not frozen yet" state,
        // not an error the operator has to decode (the board maps it to 404).
        if (err instanceof ApiError && err.status === 404) {
          setFreeze(null);
          return;
        }
      });
  };

  // Used only to offer "copy the audience" when cloning.
  useEffect(() => {
    checkFreeze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freezeId]);

  // CAD-1836: the send freezes its audience. The ceiling rides with the
  // selection so the approved prepare owns the whole snapshot; there is no
  // separate freeze action to click. No chosen audience, no selection.
  const preview = count.preview;
  const sendSelection =
    pick.base !== null && preview !== null && preview.finalCount > 0
      ? {
          base: pick.base,
          exclusionListId: pick.exclusionListId,
          maxRecipients: sendCeiling(preview.finalCount),
        }
      : null;
  // Publish what this page shows, so a running chain compares against the
  // current audience, not a closure. Withdrawn when the page goes away.
  const countNow = preview !== null ? preview.finalCount : null;
  useEffect(() => {
    if (!hydrated) return;
    publishCurrent(chainId, { freezeId, count: countNow });
    return () => publishCurrent(chainId, undefined);
  }, [chainId, hydrated, freezeId, countNow]);
  const audienceState: AudienceState =
    pick.base === null || (pick.base.mode === "custom" && pick.base.customerIds.length === 0) ? { state: "unchosen" }
    : draftAudience.keeping === "waiting" ? { state: "email-unsaved" }
    : draftAudience.keeping === "saving" || draftAudience.keeping === "typing" ? { state: "saving" }
    : draftAudience.keeping === "failed" || draftAudience.keeping === "mismatch" ? { state: "unsaved" }
    : count.error !== null ? { state: "error" }
    : preview === null ? { state: "counting" }
    : preview.finalCount === 0 ? { state: "empty", reason: blockingReason(preview, t) }
    : { state: "ready", count: preview.finalCount };
  const segmentName = pick.base?.mode === "segment" ? (segments.find((row) => row.id === (pick.base as { segmentId: string }).segmentId)?.name ?? null) : null;
  const exclusionName = pick.exclusionListId === null ? null : (exclusionState.data?.find((row) => row.id === pick.exclusionListId)?.name ?? pick.exclusionListId);
  const baseTitle =
    pick.base === null ? null
    : pick.base.mode === "all" ? t("Everyone who can be emailed")
    : pick.base.mode === "segment" ? (segmentName ?? t("Saved segment"))
    : t("{count} chosen customers").replace("{count}", String(pick.base.customerIds.length));
  const audienceTitle = baseTitle === null || exclusionName === null ? baseTitle : `${baseTitle} ${t("excluding {name}").replace("{name}", exclusionName)}`;

  return (
    <section aria-label={t("Campaign details")} className="grid gap-3">
      <div className="crm-chead">
        <button type="button" className="lnk crm-chead-back" disabled={sendPhase !== null} onClick={requestBack}>
          ← {t("Campaigns")}
        </button>
        <h3 ref={headRef} className="text-cardtitle font-medium text-ink-100" tabIndex={-1} data-outlet-heading>
          {loading ? t("Campaign details") : (doc !== null ? campaignTitle(doc) : t("Campaign details"))}{" "}
          {doc !== null && status !== null && (
            <span
              className={`chip align-middle${status.chip === null ? "" : " crm-send-chip"}`}
              data-state={status.chip ?? undefined}
              data-campaign-status={status.key}
            >
              {t(status.label)}
            </span>
          )}
        </h3>
      </div>
      {loading && (
        <p className="text-secondary text-ink-400" role="status">
          {t("Reading the campaign…")}
        </p>
      )}
      {error !== null && !loading && (
        <p className="card px-4 py-3 text-label text-fail border-fail/40" role="alert">
          {t(error)}{" "}
          <button
            type="button"
            className="lnk"
            onClick={() => { void queryState.store.refresh(); void proposalState.store.refresh(); }}
          >
            {t("Retry")}
          </button>
        </p>
      )}
      <span role="status"><QueryRefresh updating={queryState.updating} /></span>
      {!loading && (doc !== null || pendingOnly) && (
        <>
          {pendingOnly && doc === null && (
            <p className="card px-4 py-3 text-label text-ink-300" data-pending-only>
              {t("This campaign exists only as a pending assistant draft — no content is saved yet. Review it below and Apply to save the first revision, or Discard it.")}
            </p>
          )}
          <CampaignWorkspace
            scope={scope}
            viewer={viewer}
            campaignId={campaignId}
            doc={doc}
            onDoc={setDoc}
            onCloned={onCloned}
            onDirtyChange={onDirtyChange}
            starterSenderBindingId={starterSenderBindingId}
            freezeId={freezeId}
            freeze={freeze}
            selection={sendSelection}
            audience={audienceState}
            audienceTitle={audienceTitle}
            sends={sendsState.sends}
            sendsError={sendsState.error}
            onSendsChanged={sendsState.refresh}
            chain={chain}
            chainId={chainId}
            tab={tab}
            onTab={setTab}
            activitySlot={<CampaignSends scope={scope} viewer={viewer} sends={sendsState.sends} error={sendsState.error} onChanged={sendsState.refresh} />}
            audienceSlot={
              <AudienceSection
                scope={scope}
                viewer={viewer}
                pick={pick}
                onPick={(next) => {
                  pickEdited.current = true;
                  setPick(next);
                }}
                segments={segments}
                count={count}
                keeping={draftAudience.keeping}
                onRetrySave={draftAudience.retry}
                onTyping={setTypingIds}
                locked={sendPhase !== null}
              />
            }
          />
        </>
      )}
      {confirmLeave && (
        <ConfirmDialog
          title={t("Leave with unsaved email changes?")}
          body={<p>{t("Your email draft has not been saved. Leave this campaign and discard those local edits?")}</p>}
          confirmLabel={t("Leave campaign")}
          pending={false}
          error={null}
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false);
            onBack();
          }}
        />
      )}
    </section>
  );
}
