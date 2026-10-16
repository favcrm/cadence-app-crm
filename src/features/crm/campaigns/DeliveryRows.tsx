import { useLocale } from "../locale";
import { Button,DataTable,ErrorNotice } from "@cadence/screen-ui";
import { useState } from "react";
import type { AudienceScope } from "../audienceClient";
import { friendlySendError,sendClient,type DeliveryRow,type SendView } from "../sendClient";
import { WAITING_APPROVAL_TEXT,waitingApproval } from "../sendingView";
import type { Viewer } from "../viewer";
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
    <DataTable<DeliveryRow> label={t("Delivery rows — scroll horizontally to reach every column")} wrapClassName="crm-table-wrap" tableClassName="crm-table" rowKey={r => r.customerId} rows={view.deliveries} columns={[
      { key: "recipient", header: t("Recipient"), cell: r => r.email },
      { key: "state", header: t("State"), cell: r => <><span className="chip crm-send-chip" data-state={waitingApproval(r) ? "pending" : r.state}>{waitingApproval(r) ? t(WAITING_APPROVAL_TEXT) : t(r.state)}</span>{r.resolvedBy && <span> · {t("by")} {r.resolvedBy}</span>}</> },
      { key: "attempts", header: t("Attempts"), cell: r => formatNumber(r.attempts) },
      { key: "smtp", header: "SMTP", cell: r => r.smtpCode ?? "—" },
      { key: "reason", header: t("Reason"), cell: r => waitingApproval(r) ? "—" : r.reason ?? "—" },
      { key: "resolve", header: <span className="sr-only">Reconcile</span>, cell: r => viewer.operator && !viewer.readOnly && r.state === "uncertain" ? <Button size="sm" loading={pending} disabled={pending} onClick={() => reconcile(r.customerId)}>Reconcile on host…</Button> : null },
    ]} />
  </>;
}
