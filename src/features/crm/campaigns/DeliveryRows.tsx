import { useLocale } from "../locale";
import { Button,DataTable,ErrorNotice } from "@cadence/screen-ui";
import { useState } from "react";
import type { AudienceScope } from "../audienceClient";
import { friendlySendError,sendClient,type DeliveryRow,type SendView } from "../sendClient";
import { WAITING_APPROVAL_TEXT,waitingApproval } from "../sendingView";
import type { Viewer } from "../viewer";

/** One word per recipient state, in the owner's terms. */
const RESULT: Record<string, string> = {
  accepted: "Accepted",
  failed: "Failed",
  uncertain: "Unconfirmed",
  queued: "Waiting",
  submitting: "Sending",
  suppressed: "Skipped",
  closed: "Not sent",
};

export default function DeliveryRows({ scope, viewer, view, onResolved }: { scope: AudienceScope; viewer: Viewer; view: SendView; onResolved: () => void }) {
  const { t, formatNumber } = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconcile = (customerId: string) => {
    setPending(true); setError(null);
    // Resolution choice is entered on the authoritative host card, never
    // inferred from an app-painted button or retried as another SMTP send.
    void sendClient.sendResolve(scope, view.send.sendId, customerId).then(onResolved).catch(e => setError(friendlySendError(e))).finally(() => setPending(false));
  };
  return <>
    {error && <ErrorNotice bare>{t(error)}</ErrorNotice>}
    <DataTable<DeliveryRow> label={t("Recipients — scroll horizontally to reach every column")} wrapClassName="crm-table-wrap" tableClassName="crm-table" rowKey={r => r.customerId} rows={view.deliveries} columns={[
      { key: "recipient", header: t("Recipient"), cell: r => <span className="num">{r.email}</span> },
      { key: "state", header: t("Result"), cell: r => waitingApproval(r)
        ? <span className="chip crm-send-chip" data-state="pending">{t(WAITING_APPROVAL_TEXT)}</span>
        : <span title={`${t("Attempts")} ${formatNumber(r.attempts)}${r.smtpCode === null ? "" : ` · SMTP ${r.smtpCode}`}`}>
            {t(RESULT[r.state] ?? "Check result")}
            {r.reason !== null && r.state !== "accepted" ? ` · ${r.reason}` : ""}
            {r.resolvedBy ? ` · ${t("by")} ${r.resolvedBy}` : ""}
          </span> },
      { key: "resolve", header: <span className="sr-only">{t("Resolve")}</span>, cell: r => viewer.operator && !viewer.readOnly && r.state === "uncertain" ? <Button size="sm" loading={pending} disabled={pending} onClick={() => reconcile(r.customerId)}>{t("Check…")}</Button> : null },
    ]} />
  </>;
}
