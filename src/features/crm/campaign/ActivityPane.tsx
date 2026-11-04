import { useLocale } from "../locale";
import type { ReactNode } from "react";
import type { ContentDoc,ContentRender,ProposalDoc } from "../campaignGrammar";
import type { SendListEntry,SmtpBinding,TestSendReceipt } from "../sendClient";
import { sendStatus } from "./sendStatus";

/**
 * Activity tab: a plain-language timeline built from what the host
 * reported, the sends history, and every id, digest, binding and
 * unsubscribe-origin detail behind one Technical details disclosure. The
 * host wire carries no timestamps for these rows, so the timeline is
 * ordered by state, newest first, never by an invented time.
 */
export default function ActivityPane({
  campaignId,
  doc,
  proposals,
  render,
  binding,
  testEvidence,
  sends,
  sendsSlot,
}: {
  campaignId: string;
  doc: ContentDoc | null;
  proposals: ProposalDoc[];
  render: ContentRender | null;
  binding: SmtpBinding | null | undefined;
  testEvidence: TestSendReceipt | null;
  sends: SendListEntry[] | null;
  /** The sends-history panel. */
  sendsSlot: ReactNode;
}) {
  const { t, formatNumber } = useLocale();
  const pending = proposals.filter((row) => row.state === "pending");
  const decided = proposals.filter((row) => row.state !== "pending");
  const who = (row: ProposalDoc) =>
    row.actor === "assistant" && row.assistantReceipt !== null ? t("Assistant") : t("An operator");
  const sent = (sends ?? []).filter((row) => row.state !== "prepared").slice().reverse();
  const empty = doc === null && pending.length === 0 && decided.length === 0 && sent.length === 0;
  return (
    <>
      <section aria-label={t("Campaign timeline")} className="card px-4 py-4 grid gap-3">
        <h4 className="text-cardtitle font-medium text-ink-100">{t("Timeline")}</h4>
        <ol className="crm-timeline" data-timeline>
          {sent.map((row) => {
            const total = row.counts.queued + row.counts.submitting + row.counts.accepted + row.counts.failed + row.counts.uncertain + row.counts.suppressed + row.counts.closed;
            return (
              <li key={row.sendId} data-event="send">
                <span className="crm-dot" aria-hidden="true" />
                <span>{t("Send to {count} people").replace("{count}", formatNumber(total))}: {t(sendStatus(row).label)}</span>
              </li>
            );
          })}
          {testEvidence !== null && (
            <li data-event="test">
              <span className="crm-dot" aria-hidden="true" />
              <span>
                {testEvidence.pendingApproval
                  ? t("Test email waiting for approval in AgenticOS")
                  : testEvidence.accepted
                    ? `${t("Test accepted for")} ${testEvidence.to}`
                    : `${t("Test not accepted for")} ${testEvidence.to}`}
              </span>
            </li>
          )}
          {pending.map((row) => (
            <li key={row.proposalId} data-event="proposal-pending" data-accent>
              <span className="crm-dot" aria-hidden="true" />
              <span>
                {who(row)} {t("drafted “")}{row.subject}{t("” — waiting for your review")}
              </span>
            </li>
          ))}
          {doc !== null && (
            <li data-event="revision">
              <span className="crm-dot" aria-hidden="true" />
              <span>
                {t("Email saved as version")} {formatNumber(doc.revision)}: “{doc.subject}”
              </span>
            </li>
          )}
          {decided.map((row) => (
            <li key={row.proposalId} data-event={`proposal-${row.state}`}>
              <span className="crm-dot" aria-hidden="true" />
              <span>
                {who(row)}{t("'s draft “")}{row.subject}{t("” was")}{" "}{t(row.state)}
              </span>
            </li>
          ))}
          {empty && (
            <li data-event="empty">
              <span className="crm-dot" aria-hidden="true" />
              <span>{t("No versions or drafts yet.")}</span>
            </li>
          )}
        </ol>
        <details className="crm-diag" data-technical>
          <summary className="text-micro text-ink-500">{t("Technical details")}</summary>
          <dl className="sdetail mt-1">
            <div>
              <dt>{t("Campaign id")}</dt>
              <dd className="num">{campaignId}</dd>
            </div>
            {doc !== null && (
              <div>
                <dt>{t("Version")}</dt>
                <dd className="num">
                  r{doc.revision} · {doc.contentDigest}
                </dd>
              </div>
            )}
            {render !== null && (
              <>
                <div>
                  <dt>{t("Preview binding")}</dt>
                  <dd className="num">
                    {render.bindingId} {t("· preview-only")}
                    {render.previewOnly ? "" : ` ${t("(unexpected — reported)")}`}
                  </dd>
                </div>
                <div>
                  <dt>{t("Unsubscribe link")}</dt>
                  <dd className="num">{render.unsubscribeUrl}</dd>
                </div>
              </>
            )}
            {binding != null && (
              <div>
                <dt>{t("Sender link")}</dt>
                <dd className="num">
                  {binding.connectionId} {t("· link r")}{binding.linkRevision} · {binding.digest}
                </dd>
              </div>
            )}
            {proposals.map((row) => (
              <div key={row.proposalId}>
                <dt>{t("Draft")}</dt>
                <dd className="num">
                  {row.proposalId} · {t(row.state)} · {t("actor")} {row.actor} · {t("origin")} {row.origin} · {t("source r")}
                  {row.sourceRevision}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
      {sendsSlot}
    </>
  );
}
