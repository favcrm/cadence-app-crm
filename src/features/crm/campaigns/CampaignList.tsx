import { useLocale } from "../locale";
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
import { useListMemory } from "../listMemory";
import ListPager, { LIST_PAGE_SIZE } from "../ListPager";
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
  const { t, formatNumber } = useLocale();
  const canWrite = viewer.operator === true && !viewer.readOnly;
  const queryState = useCrmQuery(scope, "content.list", {}, parseContentList);
  const proposalState = useCrmQuery(scope, "proposals.list", {}, parseProposalList);
  const campaigns = queryState.data ?? [];
  const pendingDrafts = proposalState.data?.filter(row => row.state === "pending") ?? [];
  const { loading, error } = queryState;
  const listRef = useListMemory(scope, "campaigns", viewer.operator === true && queryState.data !== null, queryState.failure);
  const [sends, setSends] = useState<SendListEntry[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const search = query.trim().toLocaleLowerCase();
  const filtered = campaigns.filter(campaign => `${campaignTitle(campaign)} ${campaign.subject} ${campaign.campaignId}`.toLocaleLowerCase().includes(search));
  const pageCount = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * LIST_PAGE_SIZE, (currentPage + 1) * LIST_PAGE_SIZE);

  const reloadToken = scope.installId;
  // Pending-only assistant drafts share the same real proposal resource as
  // the workspace; send summaries stay fresh and are never display-cached.

  // Latest send per campaign — the same operator read the detail
  // page polls; its failure never blocks the content list.
  useEffect(() => {
    if (!viewer.operator) return;
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
    <section ref={listRef} aria-label={t("Campaigns list")} className="crm-list crm-list-controls">
      <h3 className="text-cardtitle font-medium text-ink-100" data-outlet-heading>
        {t("Campaigns")}
      </h3>
      <div className="crm-toolbar crm-list-toolbar">
        <div className="crm-search">
          <label className="sr-only" htmlFor="crm-campaign-search">{t("Search campaigns")}</label>
          <input
            id="crm-campaign-search"
            className="field crm-search-input"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            maxLength={120}
            autoComplete="off"
            placeholder={t("Search campaigns…")}
            title={t("Search by campaign name, subject or ID")}
          />
        </div>
        {canWrite && (
          <Button variant="primary" className="crm-list-create" onClick={onNew}>
            {t("New campaign")}
          </Button>
        )}
      </div>
      {viewer.operator === null && (
        viewer.access === "unavailable" ? (
          // CAD-1193: a completed unanswered check is unavailable, not
          // still checking — the retry re-runs the real access probe.
          <p className="card px-4 py-3 text-label text-ink-400" data-state="access-unavailable">
            {t("Access could not be confirmed — the board's access check did not answer, so campaigns stay closed.")}{" "}
            {viewer.onRetryAccess && (
              <button type="button" className="lnk" onClick={viewer.onRetryAccess}>
                {t("Retry access check")}
              </button>
            )}
          </p>
        ) : (
          <p className="card px-4 py-3 text-label text-ink-400" role="status">
            {t("Checking whether this session may inspect campaigns…")}
          </p>
        )
      )}
      {viewer.operator === false && (
        <p className="card px-4 py-3 text-label text-ink-400">
          {t("Sign in as the operator to inspect campaigns.")}
        </p>
      )}
      {viewer.operator && viewer.readOnly && (
        <p className="card px-4 py-3 text-label text-ink-400" data-state="read-only">
          {t("Read-only view. Campaign creation and edits are unavailable.")}
        </p>
      )}
      {viewer.operator && loading && (
        <p className="text-secondary text-ink-400" role="status">
          {t("Reading campaigns…")}
        </p>
      )}
      {viewer.operator && error !== null && !loading && (
        <ErrorNotice onRetry={() => { void queryState.store.refresh(); void proposalState.store.refresh(); }} retryLabel={t("Retry")}>{t(error)}</ErrorNotice>
      )}
      {viewer.operator && error === null && !loading && campaigns.length === 0 && (
        <div className="card px-4 py-5 text-secondary text-ink-400" data-empty="campaigns" role="status">
          <p className="font-medium text-ink-200">{t("No campaigns yet")}</p>
          <p className="mt-1">
            {t("Create the first campaign with New campaign. Only real server rows appear here.")}
          </p>
        </div>
      )}
      <span role="status"><QueryRefresh updating={queryState.updating} /></span>
      {viewer.operator && shown.length > 0 && (
        <div
          className="crm-table-wrap"
          tabIndex={0}
          role="region"
          aria-label={t("Campaigns table — scroll horizontally to reach every column")}
        >
          <table className="crm-table">
            <thead>
              <tr>
                <th scope="col">{t("Campaign")}</th>
                <th scope="col">{t("Content")}</th>
                <th scope="col">{t("Latest send")}</th>
                <th scope="col">
                  <span className="sr-only">{t("Open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((campaign) => (
                <tr key={campaign.campaignId}>
                  <td className="text-ink-100">
                    <span title={campaign.campaignId}>{campaignTitle(campaign)}</span>
                    {campaign.name !== null && campaign.name !== campaign.subject && (
                      <span className="text-micro text-ink-500"> · {campaign.subject}</span>
                    )}
                  </td>
                  <td>
                    <span className="chip">{t("Draft")}</span>
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
                            title={t("Prepared but not yet approved — nothing was sent")}
                          >
                            {t("Pending send")}
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
                          title={t("SMTP acceptance only — not proof of inbox delivery")}
                        >
                          {t(send.state)} · {formatNumber(send.counts.accepted)}/{formatNumber(total)} {t("accepted")}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <button type="button" className="lnk" onClick={() => onSelect(campaign.campaignId)}>
                      {t("Open")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewer.operator && !loading && error === null && campaigns.length > 0 && (
        <>
          {filtered.length === 0 && <p role="status" className="text-label text-ink-400">{t("No saved campaigns match this search")}</p>}
          <ListPager
            page={currentPage}
            pageCount={pageCount}
            summary={t(pageCount > 1 ? "{shown} of {count} campaigns" : filtered.length === 1 ? "{count} campaign" : "{count} campaigns").replace("{shown}", formatNumber(shown.length)).replace("{count}", formatNumber(filtered.length))}
            onPage={setPage}
            hasNext={currentPage + 1 < pageCount}
            busy={queryState.updating}
            label={t("Campaign page")}
          />
        </>
      )}
      {(() => {
        // Campaigns that exist only as a pending assistant draft — no
        // saved content yet. Opening one shows the proposal and its
        // Visual/HTML/Text preview before Apply (source_revision 0
        // creates revision 1); the missing saved-content 404 is the
        // expected pending-only state, not an error.
        const savedIds = new Set(campaigns.map((row) => row.campaignId));
        const draftOnly = pendingDrafts.filter((row) => !savedIds.has(row.campaignId) && `${row.subject} ${row.campaignId}`.toLocaleLowerCase().includes(search));
        if (!viewer.operator || error !== null || draftOnly.length === 0) {
          return null;
        }
        return (
          <div className="card px-4 py-4 mt-4" data-pending-drafts>
            <h4 className="text-cardtitle font-medium text-ink-100">
              {t("Assistant drafts awaiting review")}
            </h4>
            <p className="text-secondary text-ink-400">
              {t("The assistant drafted these emails from your chat. Nothing is saved until you open one and Apply.")}
            </p>
            <ul className="grid gap-2 mt-2">
              {draftOnly.map((proposal) => (
                <li key={proposal.proposalId} className="flex items-center gap-3">
                  <span className="text-ink-100 flex-1">
                    {proposal.subject !== "" ? proposal.subject : <em>{t("Untitled draft")}</em>}
                    <span className="num text-micro text-ink-500"> · {proposal.campaignId}</span>
                  </span>
                  <button
                    type="button"
                    className="lnk"
                    onClick={() => onSelect(proposal.campaignId)}
                  >
                    {t("Review draft")}
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
