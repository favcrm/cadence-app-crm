import { ApiError,Button,ConfirmDialog } from "@cadence/screen-ui";
import { useEffect,useRef,useState } from "react";
import { navigateLogical as navigate } from "../../../bridge/route";
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
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
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
      .catch((err: unknown) => setFreezeError(friendlyAudienceError(err)))
      .finally(() => setFreezePending(false));
  };

  return (
    <section aria-label="Campaign details" className="grid gap-3">
      <div>
        <h3 ref={headRef} className="text-cardtitle font-medium text-ink-100" tabIndex={-1} data-outlet-heading>
          {loading ? "Campaign details" : (doc !== null ? campaignTitle(doc) : "Campaign details")}{" "}
          {doc !== null && (
            <span className="chip align-middle" data-campaign-status>
              {doc.approval.valid && doc.approval.revision === doc.revision ? "Approved" : "Draft"}
            </span>
          )}
        </h3>
        <p className="text-label text-ink-400 mt-1">
          <button type="button" className="lnk" onClick={requestBack}>
            ← Campaigns
          </button>
        </p>
        <details className="crm-diag">
          <summary className="text-micro text-ink-500">Details</summary>
          <p className="num text-micro text-ink-500 mt-1" title="Campaign ID">
            Campaign ID {campaignId}
          </p>
        </details>
      </div>
      {loading && (
        <p className="text-secondary text-ink-400" role="status">
          Reading the campaign…
        </p>
      )}
      {error !== null && !loading && (
        <p className="card px-4 py-3 text-label text-fail border-fail/40" role="alert">
          {error}{" "}
          <button
            type="button"
            className="lnk"
            onClick={() => { void queryState.store.refresh(); void proposalState.store.refresh(); }}
          >
            Retry
          </button>
        </p>
      )}
      <span role="status"><QueryRefresh updating={queryState.updating} /></span>
      {!loading && (doc !== null || pendingOnly) && (
        <>
          {pendingOnly && doc === null && (
            <p className="card px-4 py-3 text-label text-ink-300" data-pending-only>
              This campaign exists only as a pending assistant draft — no content is saved yet.
              Review it below and Apply to save the first revision, or Discard it.
            </p>
          )}
          <CampaignWorkspace
            scope={scope}
            viewer={viewer}
            campaignId={campaignId}
            doc={doc}
            onDoc={setDoc}
            onCloned={onCloned}
            onDirtyChange={setUnsaved}
            starterSenderBindingId={starterSenderBindingId}
            freezeId={freezeId}
            freeze={freeze}
            tab={tab}
            onTab={setTab}
            audienceLabel={audienceSummary(pick, audiencePreview)}
            activitySlot={<CampaignSends scope={scope} viewer={viewer} campaignId={campaignId} />}
            audienceSlot={
              <div className="crm-cgrid">
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
                <section aria-label="Frozen audience" className="card px-4 py-4 grid gap-3">
                  <h4 className="text-cardtitle font-medium text-ink-100">Freeze</h4>
                  <p className="text-label text-ink-400">
                    A freeze snapshots exactly who receives this campaign, so later customer
                    changes cannot alter it. The audience above is the freeze — no ids to
                    handle: freeze it, and recheck whenever the audience changes.
                  </p>
                  {freezeError && (
                    <p className="text-label text-fail" role="alert">
                      {freezeError}
                    </p>
                  )}
                  <p className="text-label text-ink-100" data-freeze-state={
                    freeze === null ? "unfrozen" : freeze.valid === true ? "valid" : "drifted"
                  }>
                    {freeze === null
                      ? freezeMissing
                        ? "This audience is not frozen yet. Freezing snapshots exactly who receives the campaign, so later customer changes cannot alter it."
                        : "Checking the freeze…"
                      : freeze.valid === true
                        ? `Audience frozen · ${freeze.finalCount} recipient${freeze.finalCount === 1 ? "" : "s"} · checked just now`
                        : `Audience changed since you froze it (was ${freeze.finalCount}, now ${freeze.currentCount ?? "—"}) — refreeze to continue.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={freezePending}
                      disabled={freezePending || !canWrite || audiencePreview === null || audiencePreview.finalCount === 0}
                      onClick={freezeAudience}
                    >
                      {freeze !== null && freeze.valid === false ? "Use audience · refresh snapshot" : freeze === null ? "Use audience · create snapshot" : "Use audience · refresh snapshot"}
                    </Button>
                    {freeze !== null && (
                      <Button size="sm" loading={freezePending} disabled={freezePending} onClick={checkFreeze}>
                        Recheck
                      </Button>
                    )}
                  </div>
                  {freeze && (
                    <>
                      <dl className="crm-detail" aria-label="Freeze validity">
                        <div>
                          <dt>Frozen recipients</dt>
                          <dd className="num">{freeze.finalCount}</dd>
                        </div>
                        <div>
                          <dt>Current recount</dt>
                          <dd className="num">{freeze.currentCount ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>Validity</dt>
                          <dd>
                            <span
                              className="chip"
                              title={freeze.drift ?? "The frozen digest still matches the live audience"}
                            >
                              {freeze.valid === true ? "Valid" : freeze.valid === false ? `Invalid — ${freeze.drift}` : "Unknown"}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      <details className="crm-diag">
                        <summary className="text-micro text-ink-500">Technical details</summary>
                        <p className="num text-micro text-ink-500 mt-1" title="Freeze ID (derived from the audience)">
                          Freeze {freezeId}
                        </p>
                        <p className="num text-micro text-ink-500 mt-1" title="Frozen audience digest">
                          Digest {freeze.digest}
                        </p>
                      </details>
                    </>
                  )}
                </section>
              </div>
            }
          />
        </>
      )}
      {(confirmLeave || pendingNavigation !== null) && (
        <ConfirmDialog
          title="Leave with unsaved email changes?"
          body={<p>Your email draft has not been saved. Leave this campaign and discard those local edits?</p>}
          confirmLabel={pendingNavigation === null ? "Leave campaign" : "Leave page"}
          pending={false}
          error={null}
          onCancel={() => { setConfirmLeave(false); setPendingNavigation(null); }}
          onConfirm={() => {
            setConfirmLeave(false);
            if (pendingNavigation !== null) {
              const destination = pendingNavigation;
              setPendingNavigation(null);
              navigate(destination);
            } else onBack();
          }}
        />
      )}
    </section>
  );
}

/** Prior sends of this campaign — the same `list` read the campaigns
 *  table shows, plus each send's live counts on demand. */
