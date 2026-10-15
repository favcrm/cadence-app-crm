import { useLocale } from "../locale";
import { Button } from "@cadence/screen-ui";
import { useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import {
friendlyCampaignError,
parseContentDoc,
parseProposalRender,
type ContentDoc,
type ProposalDoc,
type ProposalRenderDoc
} from "../campaignGrammar";
import { contentClient } from "../contentClient";
import "../crm-campaign.css";


import HostPreview from "../../../bridge/HostPreview";

export default function ProposalRow({
  scope,
  proposal,
  expectedRevision,
  canWrite,
  onApplied,
  onDiscarded,
  onError,
}: {
  scope: AudienceScope;
  proposal: ProposalDoc;
  expectedRevision: number;
  canWrite: boolean;
  onApplied: (doc: ContentDoc) => void;
  onDiscarded: (proposalId: string) => void;
  onError: (message: string | null) => void;
}) {
  const { t, formatNumber } = useLocale();
  const [pending, setPending] = useState<"apply" | "discard" | null>(null);
  const [showBody, setShowBody] = useState(false);
  const [bodyRender, setBodyRender] = useState<ProposalRenderDoc | null>(null);
  const [bodyPending, setBodyPending] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [bodyTab, setBodyTab] = useState<"visual" | "html" | "text">("visual");
  const verified = proposal.actor === "assistant" && proposal.assistantReceipt !== null;
  const stale = proposal.sourceRevision !== expectedRevision;
  const receipt = proposal.assistantReceipt;

  // CAD-1016: the real Visual/HTML/Text preview of the pending draft —
  // the host renders the proposal's own inert subject/preheader/blocks
  // (proposal-render); no save, no send. Falls back to the escaped
  // structured body if the host render is unavailable.
  const openBody = () => {
    setShowBody(true);
    if (bodyRender !== null || bodyPending) return;
    setBodyPending(true);
    setBodyError(null);
    contentClient
      .proposalRender(scope, proposal.proposalId)
      .then((value) => setBodyRender(parseProposalRender(value)))
      .catch((e: unknown) => setBodyError(friendlyCampaignError(e)))
      .finally(() => setBodyPending(false));
  };
  return (
    <li className="card px-3 py-3" data-proposal={proposal.proposalId}>
      <p className="text-label text-ink-200">
        <span className="num">{proposal.proposalId}</span> · {proposal.subject}
      </p>
      {verified && receipt !== null ? (
        <p className="mt-1">
          <span
            className="chip"
            data-badge="verified-assistant"
            title={t("Host-verified: the assistant produced this draft on this campaign — the browser's copy is never the authority")}
          >
            {t("Verified assistant draft")}
          </span>{" "}
          <span className="num text-micro text-ink-500">
            {receipt.agent} {t("· campaign")}{receipt.campaignId} {t("· source r")}{receipt.sourceRevision}
          </span>
        </p>
      ) : (
        <p className="mt-1">
          <span
            className="chip"
            data-badge="operator-submitted"
            title={t("Submitted through the operator proposal route — no assistant provenance")}
          >
            {t("Operator-submitted")}
          </span>{" "}
          <span className="num text-micro text-ink-500">
            {t("actor")}{proposal.actor} {t("· origin")}{proposal.origin} {t("· source r")}{formatNumber(proposal.sourceRevision)}
          </span>
        </p>
      )}
      {/* CAD-1016: the pending draft's real body previews BEFORE Apply —
          the host-rendered Visual/HTML/Text of the proposal's own inert
          subject/preheader/blocks (proposal-render), never a save or an
          unsaved-editor render. Falls back to the escaped structured
          body if the host render is unavailable. */}
      <button
        type="button"
        className="lnk text-label mt-1"
        aria-expanded={showBody}
        data-proposal-preview={proposal.proposalId}
        onClick={() => (showBody ? setShowBody(false) : openBody())}
      >
        {t(showBody ? "Hide preview" : "Preview draft")}
      </button>
      {showBody && (
        <div className="crm-proposal-body mt-2" data-proposal-body={proposal.proposalId}>
          {bodyPending && (
            <p className="text-label text-ink-500" role="status" data-preview="loading">
              {t("Rendering the draft preview…")}
            </p>
          )}
          {bodyError !== null && (
            <p className="text-label text-fail" role="alert">
              {t(bodyError)}
            </p>
          )}
          {bodyRender !== null ? (
            <>
              <p className="text-label text-ink-300">
                <span className="chip" title={t("Preview-only sender material — host-locked")}>
                  {t("preview-only")}
                </span>{" "}
                <span className="num">
                  {bodyRender.sender.name} · {bodyRender.sender.address}
                </span>
              </p>
              <div className="app-outlet-tabs" role="tablist" aria-label={t("Draft preview format")}>
                {(
                  [
                    ["visual", t("Visual")],
                    ["html", "HTML"],
                    ["text", t("Text")],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="app-outlet-tab"
                    role="tab"
                    aria-selected={bodyTab === key}
                    onClick={() => setBodyTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {bodyTab === "visual" && (
                <HostPreview title={t("Draft email preview")} document={bodyRender.html} mode="saved" />
              )}
              {bodyTab !== "visual" && (
                <pre className="crm-preview" data-preview={bodyTab}>
                  {bodyTab === "html" ? bodyRender.html : bodyRender.text}
                </pre>
              )}
            </>
          ) : (
            bodyError === null && !bodyPending ? null : (
              <>
                <p className="text-label text-ink-200">
                  <span className="text-ink-500">{t("Subject:")}</span> {proposal.subject}
                </p>
                {proposal.preheader !== "" && (
                  <p className="text-label text-ink-400">
                    <span className="text-ink-500">{t("Preheader:")}</span> {proposal.preheader}
                  </p>
                )}
                <ol className="grid gap-1 mt-1" aria-label={t("Draft body blocks")}>
                  {proposal.blocks.map((block, index) => (
                    <li key={index} className="text-label text-ink-300">
                      {block.type === "heading" ? (
                        <strong className="text-ink-100">{block.text}</strong>
                      ) : block.type === "button" ? (
                        <span className="chip" data-block="button">
                          {t("Button:")} {block.label}
                        </span>
                      ) : (
                        block.text
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )
          )}
        </div>
      )}
      {stale && proposal.state === "pending" && (
        <p className="text-label text-warn mt-1" data-state="stale">
          {t("Needs review (stale) — drafted against revision")} {formatNumber(proposal.sourceRevision)}, {t("the saved version is now revision")} {formatNumber(expectedRevision)}. {t("Re-review its text before asking the assistant to draft again.")}
        </p>
      )}
      {canWrite && (
        <div className="crm-toolbar mt-2">
          <Button
            size="sm"
            variant="primary"
            loading={pending === "apply"}
            disabled={pending !== null || stale}
            title={
              stale
                ? t("Apply is disabled: the proposal's stamped source revision is behind the current draft")
                : `${t("Apply as a new revision (expects the draft at revision")} ${formatNumber(expectedRevision)})`
            }
            onClick={() => {
              onError(null);
              setPending("apply");
              // CAD-1013: an unsaved campaign applies a source_revision=0
              // proposal to CREATE revision 1 — there is no revision to pin,
              // so omit expected_revision entirely (the daemon treats the
              // absent check as the create path, exactly like the content
              // save CAS). Sending expected_revision:0 would be a stale
              // pin on a doc that does not exist yet.
              void contentClient
                .proposalApply(
                  scope,
                  proposal.proposalId,
                  expectedRevision === 0 ? undefined : expectedRevision,
                )
                .then((value) => onApplied(parseContentDoc(value)))
                .catch((err: unknown) => onError(friendlyCampaignError(err)))
                .finally(() => setPending(null));
            }}
          >
            {t("Apply (new revision)")}
          </Button>
          <Button
            size="sm"
            loading={pending === "discard"}
            disabled={pending !== null}
            onClick={() => {
              onError(null);
              setPending("discard");
              void contentClient
                .proposalDiscard(scope, proposal.proposalId)
                .then(() => onDiscarded(proposal.proposalId))
                .catch((err: unknown) => onError(friendlyCampaignError(err)))
                .finally(() => setPending(null));
            }}
          >
            {t("Discard")}
          </Button>
        </div>
      )}
    </li>
  );
}
