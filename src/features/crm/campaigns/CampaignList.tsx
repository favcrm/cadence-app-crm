import { Button,ErrorNotice } from "@cadence/screen-ui";
import { useEffect,useState } from "react";
import {
type AudienceScope
} from "../audienceClient";
import {
campaignTitle,
parseContentList,
parseProposalList,
} from "../campaignGrammar";
import { QueryRefresh,useCrmQuery } from "../resources";
import "../crm-campaign.css";
import {
parseSendList,
sendClient,
type SendListEntry
} from "../sendClient";
import type { Viewer } from "../viewer";



export default function CampaignList({
  scope,
  viewer,
  onSelect,
  onNew,
}: {
  scope: AudienceScope;
  viewer: Viewer;
  onSelect: (campaignId: string) => void;
  onNew: () => void;
}) {
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const queryState = useCrmQuery(scope, "content.list", {}, parseContentList);
  const proposalState = useCrmQuery(scope, "proposals.list", {}, parseProposalList);
  const campaigns = queryState.data ?? [];
  const pendingDrafts = proposalState.data?.filter(row => row.state === "pending") ?? [];
  const { loading, error } = queryState;
  const [sends, setSends] = useState<SendListEntry[]>([]);

  const reloadToken = `${scope.installId}:${scope.contextId}`;
  // Pending-only assistant drafts share the same real proposal resource as
  // the workspace; send summaries stay fresh and are never display-cached.

  // Latest send per campaign — the same operator read the detail
  // page polls; its failure never blocks the content list.
  useEffect(() => {
    if (scope.contextId === "" || !viewer.operator) return;
    const controller = new AbortController();
    sendClient
      .sendList(scope)
      .then((value) => {
        if (!controller.signal.aborted) setSends(parseSendList(value));
      })
      .catch(() => {
        if (!controller.signal.aborted) setSends([]);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  // The newest send the host recorded per campaign — the list's
  // `created` order is the daemon's insertion order.
  const latestSendByCampaign = (() => {
    const map = new Map<string, SendListEntry>();
    for (const row of sends) map.set(row.campaignId, row);
    return map;
  })();

  return (
    <section aria-label="Campaigns list" className="crm-list">
      <h3 className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
        Campaigns
      </h3>
      <div className="crm-toolbar mb-4">
        <p className="crm-toolbar-lede text-secondary text-ink-300">
          Versioned email content with content-only approval. Audience freezes and test-send
          receipts live on each campaign's page.
        </p>
        {canWrite && (
          <Button variant="primary" size="sm" onClick={onNew}>
            New campaign
          </Button>
        )}
      </div>
      {viewer.operator === null && (
        viewer.access === "unavailable" ? (
          // CAD-1193: a completed unanswered check is unavailable, not
          // still checking — the retry re-runs the real access probe.
          <p className="card px-4 py-3 text-label text-ink-400" data-state="access-unavailable">
            Access could not be confirmed — the board's access check did
            not answer, so campaigns stay closed.{" "}
            {viewer.onRetryAccess && (
              <button type="button" className="lnk" onClick={viewer.onRetryAccess}>
                Retry access check
              </button>
            )}
          </p>
        ) : (
          <p className="card px-4 py-3 text-label text-ink-400" role="status">
            Checking whether this session may inspect campaigns…
          </p>
        )
      )}
      {viewer.operator === false && (
        <p className="card px-4 py-3 text-label text-ink-400">
          Sign in as the operator to inspect campaigns.
        </p>
      )}
      {viewer.operator && viewer.readOnly && (
        <p className="card px-4 py-3 text-label text-ink-400" data-state="read-only">
          Read-only view. Campaign creation and edits are unavailable.
        </p>
      )}
      {scope.contextId === "" && viewer.operator && (
        <p className="card px-4 py-3 text-label text-ink-400">
          Administrator CRM setup is required before campaigns open.
        </p>
      )}
      {scope.contextId !== "" && viewer.operator && loading && (
        <p className="text-secondary text-ink-400" role="status">
          Reading campaigns…
        </p>
      )}
      {scope.contextId !== "" && viewer.operator && error !== null && !loading && (
        <ErrorNotice onRetry={() => { void queryState.store.refresh(); void proposalState.store.refresh(); }}>{error}</ErrorNotice>
      )}
      {scope.contextId !== "" && viewer.operator && error === null && !loading && campaigns.length === 0 && (
        <div className="card px-4 py-5 text-secondary text-ink-400" data-empty="campaigns" role="status">
          <p className="font-medium text-ink-200">No campaigns yet</p>
          <p className="mt-1">
            Create the first campaign with New campaign — audience, editor, preview and test-send
            all live there, never on this list. Only real server rows appear here.
          </p>
        </div>
      )}
      <span role="status"><QueryRefresh updating={queryState.updating} /></span>
      {scope.contextId !== "" && viewer.operator && campaigns.length > 0 && (
        <div
          className="crm-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Campaigns table — scroll horizontally to reach every column"
        >
          <table className="crm-table">
            <thead>
              <tr>
                <th scope="col">Campaign</th>
                <th scope="col">Content</th>
                <th scope="col">Latest send</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.campaignId}>
                  <td className="text-ink-100">
                    <span title={campaign.campaignId}>{campaignTitle(campaign)}</span>
                    {campaign.name !== null && campaign.name !== campaign.subject && (
                      <span className="text-micro text-ink-500"> · {campaign.subject}</span>
                    )}
                  </td>
                  <td>
                    <span
                      className="chip"
                      title={
                        campaign.approval.valid
                          ? `The saved content is approved${campaign.approval.revision !== campaign.revision ? " on an earlier saved version" : ""}`
                          : "The saved content is not approved yet"
                      }
                    >
                      {campaign.approval.valid
                        ? campaign.approval.revision === campaign.revision
                          ? "Approved"
                          : "Needs review — edited since approval"
                        : "Draft"}
                    </span>
                  </td>
                  <td className="num text-ink-300" data-send-state>
                    {(() => {
                      const send = latestSendByCampaign.get(campaign.campaignId);
                      if (send === undefined) {
                        return <span className="text-ink-500">—</span>;
                      }
                      if (send.state === "prepared") {
                        return (
                          <span
                            className="chip crm-send-chip"
                            data-state={send.state}
                            title="Prepared but not yet approved — nothing was sent"
                          >
                            Pending send
                          </span>
                        );
                      }
                      const total =
                        send.counts.queued +
                        send.counts.submitting +
                        send.counts.accepted +
                        send.counts.failed +
                        send.counts.uncertain +
                        send.counts.suppressed +
                        send.counts.closed;
                      return (
                        <span
                          className="chip crm-send-chip"
                          data-state={send.state}
                          title="SMTP acceptance only — not proof of inbox delivery"
                        >
                          {send.state} · {send.counts.accepted}/{total} accepted
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <button type="button" className="lnk" onClick={() => onSelect(campaign.campaignId)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(() => {
        // Campaigns that exist only as a pending assistant draft — no
        // saved content yet. Opening one shows the proposal and its
        // Visual/HTML/Text preview before Apply (source_revision 0
        // creates revision 1); the missing saved-content 404 is the
        // expected pending-only state, not an error.
        const savedIds = new Set(campaigns.map((row) => row.campaignId));
        const draftOnly = pendingDrafts.filter((row) => !savedIds.has(row.campaignId));
        if (scope.contextId === "" || !viewer.operator || error !== null || draftOnly.length === 0) {
          return null;
        }
        return (
          <div className="card px-4 py-4 mt-4" data-pending-drafts>
            <h4 className="text-cardtitle font-medium text-ink-100">
              Assistant drafts awaiting review
            </h4>
            <p className="text-secondary text-ink-400">
              The assistant drafted these emails from your chat. Nothing is saved until you
              open one and Apply.
            </p>
            <ul className="grid gap-2 mt-2">
              {draftOnly.map((proposal) => (
                <li key={proposal.proposalId} className="flex items-center gap-3">
                  <span className="text-ink-100 flex-1">
                    {proposal.subject !== "" ? proposal.subject : <em>Untitled draft</em>}
                    <span className="num text-micro text-ink-500"> · {proposal.campaignId}</span>
                  </span>
                  <button
                    type="button"
                    className="lnk"
                    onClick={() => onSelect(proposal.campaignId)}
                  >
                    Review draft
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Audience: exactly one base mode plus a saved exclusion list.        */
/* ------------------------------------------------------------------ */
