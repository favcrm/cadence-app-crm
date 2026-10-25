import { useLocale } from "../locale";
import { ApiError,ConfirmDialog } from "@cadence/screen-ui";
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from "react";
import { channel } from "../../../bridge/channel";
import {
audienceClient,
type AudienceScope
} from "../audienceClient";
import { audienceSummary } from "../campaign/audienceSummary";
import { clearLanding,peekLanding } from "../campaign/landing";
import {
type CampaignTab
} from "../campaign/readiness";
import {
campaignTitle,
parseContentDoc,
parseProposalList,
} from "../campaignGrammar";
import { QueryRefresh,useCrmQuery } from "../resources";
import "../crm-campaign.css";
import { isApprovalRequired } from "../hostErrors";
import { friendlyAudienceError } from "../segmentGrammar";
import { type AudiencePreview } from "../segments/Segments";
import type { Viewer } from "../viewer";


import AudienceSection from "./AudienceSection";
import CampaignSends from "./CampaignSends";
import CampaignWorkspace from "./CampaignWorkspace";
import { audienceFreezeId,type AudiencePick } from "./audienceModel";

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
  const canWrite = viewer.operator === true && !viewer.readOnly;
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
  // A clone starter audience counts as an explicit pick: the saved draft
  // audience must never replace what the operator chose to copy.
  const pickEdited = useRef(peekLanding(campaignId)?.audienceBase != null);
  const [pick, setPick] = useState<AudiencePick>(() => {
    const landing = peekLanding(campaignId);
    return {
      base:
        landing?.audienceBase ??
        (landingSegmentId !== null ? { mode: "segment", segmentId: landingSegmentId } : { mode: "all" }),
      exclusionListId: landing?.exclusionListId ?? null,
    };
  });
  const [audiencePreviewState, setAudiencePreviewState] = useState<{ key: string; preview: AudiencePreview } | null>(null);
  const audiencePickKey = JSON.stringify({ base: pick.base, exclusion: pick.exclusionListId });
  const audiencePreview = audiencePreviewState?.key === audiencePickKey ? audiencePreviewState.preview : null;
  const recordAudiencePreview = (preview: AudiencePreview | null) => {
    setAudiencePreviewState(preview === null ? null : { key: audiencePickKey, preview });
  };
  const [tab, setTab] = useState<CampaignTab>(() => peekLanding(campaignId)?.tab ?? "overview");
  // CAD-1178: derived, never typed — the operator's audience choice *is*
  // the freeze identity. A changed audience is a new id, so the status line
  // reads "not frozen yet" until the operator freezes it.
  const freezeId = audienceFreezeId(campaignId, pick);
  const [freeze, setFreeze] = useState<{
    finalCount: number;
    digest: string;
    valid: boolean | null;
    drift: string | null;
    currentCount: number | null;
  } | null>(null);
  const [freezePending, setFreezePending] = useState(false);
  const [freezeError, setFreezeError] = useState<string | null>(null);
  // No freeze row for this derived id yet — the honest "not frozen" state,
  // distinct from an error.
  const [freezeMissing, setFreezeMissing] = useState(false);
  const [freezeWaiting, setFreezeWaiting] = useState(false);

  const requestBack = () => {
    if (unsaved) setConfirmLeave(true);
    else onBack();
  };

  useEffect(() => {
    headRef.current?.focus();
    clearLanding(campaignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const draftAudience = doc?.draftAudience;
    if (landingSegmentId === null && !pickEdited.current && draftAudience?.mode === "segment") {
      setPick(current => pickEdited.current ? current : { ...current, base: { mode: "segment", segmentId: draftAudience.segmentId } });
    }
  }, [doc, landingSegmentId]);

  // Every check carries a generation: an older lookup resolving after a
  // newer one (audience changed mid-flight) can never paint its row.
  const freezeGeneration = useRef(0);

  const checkFreeze = () => {
    const generation = (freezeGeneration.current += 1);
    setFreezePending(true);
    setFreezeError(null);
    void audienceClient
      .freezeShow(scope, freezeId)
      .then((value) => {
        if (generation !== freezeGeneration.current) return;
        const root = (value as Record<string, unknown> | null) ?? {};
        const row = (root.freeze as Record<string, unknown> | null) ?? {};
        setFreezeMissing(false);
        setFreezeWaiting(false);
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
          setFreezeMissing(true);
          return;
        }
        setFreezeError(friendlyAudienceError(err));
      })
      .finally(() => setFreezePending(false));
  };

  // Auto-recheck on load and whenever the derived id changes (the audience
  // base, the exclusions, or the campaign itself): the status line is always
  // the current truth, never a stale click's memory.
  useEffect(() => {
    checkFreeze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freezeId]);

  const freezeAudience = () => {
    if (!canWrite || audiencePreview === null || audiencePreview.finalCount === 0) return;
    setFreezePending(true);
    setFreezeError(null);
    // The ceiling is derived from the previewed size with headroom, never
    // typed: it bounds an unexpected growth spurt without constraining the
    // audience the operator just previewed.
    const ceiling = Math.max(10, Math.ceil(audiencePreview.finalCount * 1.25) + 10);
    void audienceClient
      .prepare(scope, {
        freezeId,
        base: pick.base,
        exclusionListId: pick.exclusionListId ?? undefined,
        maxRecipients: ceiling,
      })
      .then(() => checkFreeze())
      .catch((err: unknown) => {
        if (isApprovalRequired(err)) {
          setFreezeWaiting(true);
          setFreezeError(null);
          return;
        }
        setFreezeError(friendlyAudienceError(err));
      })
      .finally(() => setFreezePending(false));
  };

  return (
    <section aria-label={t("Campaign details")} className="grid gap-3">
      <div className="crm-chead">
        <button type="button" className="lnk crm-chead-back" onClick={requestBack}>
          ← {t("Campaigns")}
        </button>
        <h3 ref={headRef} className="text-cardtitle font-medium text-ink-100" tabIndex={-1} data-outlet-heading>
          {loading ? t("Campaign details") : (doc !== null ? campaignTitle(doc) : t("Campaign details"))}{" "}
          {doc !== null && (
            <span className="chip align-middle" data-campaign-status>
              {t("Draft")}
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
            freezeMissing={freezeMissing}
            freezePending={freezePending}
            freezeError={freezeError}
            freezeWaiting={freezeWaiting}
            onFreeze={freezeAudience}
            tab={tab}
            onTab={setTab}
            audienceLabel={audienceSummary(pick, audiencePreview)}
            activitySlot={<CampaignSends scope={scope} viewer={viewer} campaignId={campaignId} />}
            audienceSlot={
              <AudienceSection
                scope={scope}
                viewer={viewer}
                pick={pick}
                onPick={(next) => {
                  pickEdited.current = true;
                  setPick(next);
                  setAudiencePreviewState(null);
                }}
                onPreview={recordAudiencePreview}
                layout="detail"
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

/** Prior sends of this campaign — the same `list` read the campaigns
 *  table shows, plus each send's live counts on demand. */
