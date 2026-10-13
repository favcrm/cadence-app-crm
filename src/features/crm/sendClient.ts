import { ApiError } from "@cadence/screen-ui";
import { serviceCall,serviceSlot } from "../../bridge/services";
import { type HostScope } from "./hostActions";
import { hostErrorText } from "./hostErrors";

/**
 * Typed host action client for the CRM send routes (CAD-786 UI over
 * the CAD-785 sender binding and the CAD-786 approved bounded send).
 *
 * Unlike the record/content clients these routes are flat
 * `/api/crm-smtp/*` and `/api/crm-send/*` endpoints, so
 * `install_id`/`context_id` travel inside the POST body or the read
 * query — but only ever the trusted route scope's values, never a
 * form field, chat message or stored draft. Bodies carry exactly the
 * peer's allowlisted grammar (the Rust handlers are
 * `deny_unknown_fields`); anything else throws client-side before a
 * byte is sent. No actor claims, receipt-shaped fields, secrets or
 * project links ever enter this client. `unsubscribe_origin` is the
 * sole non-string body field and is either a string or JSON null.
 *
 * Honest copy: every send receipt carries `delivery_claim:
 * "smtp-acceptance-only"` — SMTP acceptance is an operational
 * result, never proof of inbox delivery or reading.
 */

export type SendScope = HostScope;

/** The label every acceptance receipt wears — never "delivered". */
export const DELIVERY_CLAIM = "smtp-acceptance-only";

/** One live SMTP sender binding as the host reports it. */
export interface SmtpBinding {
  connectionId: string;
  authRevision: number;
  linkRevision: number;
  state: string;
  digest: string;
  sender: { name: string; address: string };
  /** CAD-1063: "agenticos" when the platform sends, else "smtp". */
  transportKind: string;
}

/** `null` where the host reports no live binding (its refusal is
 *  scoped to the binding state, not an HTTP failure). */
export function parseSmtpBinding(value: unknown): SmtpBinding {
  const binding = (value as { binding?: unknown } | null)?.binding;
  if (!binding || typeof binding !== "object") {
    throw new ApiError("The server returned an invalid sender receipt", 502);
  }
  const row = binding as Record<string, unknown>;
  const sender = (row.sender as Record<string, unknown> | null) ?? {};
  if (
    typeof row.connection_id !== "string" ||
    typeof row.auth_revision !== "number" ||
    typeof row.link_revision !== "number" ||
    typeof row.state !== "string" ||
    typeof row.digest !== "string" ||
    typeof sender.name !== "string" ||
    typeof sender.address !== "string"
  ) {
    throw new ApiError("The server returned an invalid sender receipt", 502);
  }
  return {
    connectionId: row.connection_id,
    authRevision: row.auth_revision,
    linkRevision: row.link_revision,
    state: row.state,
    digest: row.digest,
    sender: { name: sender.name, address: sender.address },
    transportKind: typeof row.transport_kind === "string" ? row.transport_kind : "smtp",
  };
}

/** The one-recipient test-send receipt — SMTP acceptance only. */
export interface TestSendReceipt {
  accepted: boolean;
  /** CAD-1063: hosted send parked until the owner approves it in
   *  AgenticOS — not accepted, not an error. */
  pendingApproval: boolean;
  smtpCode: number | null;
  smtpMessage: string;
  to: string;
  contentRevision: number;
  contentDigest: string;
  linkDigest: string;
  deliveryClaim: string;
}

export function parseTestSendReceipt(value: unknown): TestSendReceipt {
  const receipt = (value as { receipt?: unknown } | null)?.receipt;
  if (!receipt || typeof receipt !== "object") {
    throw new ApiError("The server returned an invalid test-send receipt", 502);
  }
  const row = receipt as Record<string, unknown>;
  if (typeof row.accepted !== "boolean" || typeof row.content_digest !== "string") {
    throw new ApiError("The server returned an invalid test-send receipt", 502);
  }
  return {
    accepted: row.accepted,
    pendingApproval: row.pending_approval === true,
    smtpCode: typeof row.smtp_code === "number" ? row.smtp_code : null,
    smtpMessage: typeof row.smtp_message === "string" ? row.smtp_message : "",
    to: typeof row.to_email === "string" ? row.to_email : "",
    contentRevision: typeof row.content_revision === "number" ? row.content_revision : -1,
    contentDigest: row.content_digest,
    linkDigest: typeof row.link_digest === "string" ? row.link_digest : "",
    deliveryClaim: typeof row.delivery_claim === "string" ? row.delivery_claim : DELIVERY_CLAIM,
  };
}

/** The frozen send row every prepare/show/approve returns. */
export interface SendRow {
  sendId: string;
  campaignId: string;
  state: string;
  sendDigest: string;
  contentRevision: number;
  contentDigest: string;
  audienceFreezeId: string;
  audienceDigest: string;
  connectionId: string;
  linkRevision: number;
  maxRecipients: number;
  unsubscribeOrigin: string;
  closeReason: string | null;
  created: number;
  approvedAt: number | null;
}

export function parseSendRow(value: unknown): SendRow {
  const send = (value as { send?: unknown } | null)?.send ?? value;
  if (!send || typeof send !== "object") {
    throw new ApiError("The server returned an invalid send receipt", 502);
  }
  const row = send as Record<string, unknown>;
  if (
    typeof row.send_id !== "string" ||
    typeof row.campaign_id !== "string" ||
    typeof row.state !== "string" ||
    typeof row.send_digest !== "string"
  ) {
    throw new ApiError("The server returned an invalid send receipt", 502);
  }
  return {
    sendId: row.send_id,
    campaignId: row.campaign_id,
    state: row.state,
    sendDigest: row.send_digest,
    contentRevision: typeof row.content_revision === "number" ? row.content_revision : -1,
    contentDigest: typeof row.content_digest === "string" ? row.content_digest : "",
    audienceFreezeId: typeof row.audience_freeze_id === "string" ? row.audience_freeze_id : "",
    audienceDigest: typeof row.audience_digest === "string" ? row.audience_digest : "",
    connectionId: typeof row.connection_id === "string" ? row.connection_id : "",
    linkRevision: typeof row.link_revision === "number" ? row.link_revision : -1,
    maxRecipients: typeof row.max_recipients === "number" ? row.max_recipients : -1,
    unsubscribeOrigin: typeof row.unsubscribe_origin === "string" ? row.unsubscribe_origin : "",
    closeReason: typeof row.close_reason === "string" ? row.close_reason : null,
    created: typeof row.created === "number" ? row.created : 0,
    approvedAt: typeof row.approved_at === "number" ? row.approved_at : null,
  };
}

/** `prepare` plus its counts and bounded masked sample. */
export interface PreparedSend {
  send: SendRow;
  counts: {
    included: number;
    excluded: number;
    suppressedNow: number;
    final: number;
    maxRecipients: number;
  };
  sample: { customerId: string; email: string }[];
  sendDigest: string;
}

export function parsePreparedSend(value: unknown): PreparedSend {
  const row = (value as Record<string, unknown> | null) ?? {};
  const counts = (row.counts as Record<string, unknown> | null) ?? {};
  const sample = Array.isArray(row.sample) ? row.sample : [];
  if (typeof row.send_digest !== "string" || row.send === undefined) {
    throw new ApiError("The server returned an invalid send receipt", 502);
  }
  return {
    send: parseSendRow(row.send),
    counts: {
      included: typeof counts.included === "number" ? counts.included : -1,
      excluded: typeof counts.excluded === "number" ? counts.excluded : -1,
      suppressedNow: typeof counts.suppressed_now === "number" ? counts.suppressed_now : -1,
      final: typeof counts.final === "number" ? counts.final : -1,
      maxRecipients: typeof counts.max_recipients === "number" ? counts.max_recipients : -1,
    },
    sample: sample.flatMap((entry) => {
      const item = (entry as Record<string, unknown> | null) ?? {};
      return typeof item.customer_id === "string" && typeof item.email === "string"
        ? [{ customerId: item.customer_id, email: item.email }]
        : [];
    }),
    sendDigest: row.send_digest,
  };
}

/** Per-recipient outcome counts as the host reports them. */
export interface SendCounts {
  queued: number;
  submitting: number;
  accepted: number;
  failed: number;
  uncertain: number;
  suppressed: number;
  closed: number;
}

function parseCounts(value: unknown): SendCounts {
  const row = (value as Record<string, unknown> | null) ?? {};
  const n = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : 0);
  return {
    queued: n("queued"),
    submitting: n("submitting"),
    accepted: n("accepted"),
    failed: n("failed"),
    uncertain: n("uncertain"),
    suppressed: n("suppressed"),
    closed: n("closed"),
  };
}

/** One masked delivery row — the show/list wire never carries a
 *  full address. */
export interface DeliveryRow {
  sendId: string;
  customerId: string;
  email: string;
  state: string;
  attempts: number;
  smtpCode: number | null;
  reason: string | null;
  resolvedBy: string | null;
}

function parseDelivery(value: unknown): DeliveryRow {
  const row = (value as Record<string, unknown> | null) ?? {};
  return {
    sendId: typeof row.send_id === "string" ? row.send_id : "",
    customerId: typeof row.customer_id === "string" ? row.customer_id : "",
    email: typeof row.email === "string" ? row.email : "",
    state: typeof row.state === "string" ? row.state : "",
    attempts: typeof row.attempts === "number" ? row.attempts : 0,
    smtpCode: typeof row.smtp_code === "number" ? row.smtp_code : null,
    reason: typeof row.reason === "string" ? row.reason : null,
    resolvedBy: typeof row.resolved_by === "string" ? row.resolved_by : null,
  };
}

/** `show`/`approve` — the send, live counts and masked deliveries. */
export interface SendView {
  send: SendRow;
  counts: SendCounts;
  deliveries: DeliveryRow[];
  deliveryClaim: string;
}

export function parseSendView(value: unknown): SendView {
  const row = (value as Record<string, unknown> | null) ?? {};
  if (row.send === undefined) {
    throw new ApiError("The server returned an invalid send receipt", 502);
  }
  return {
    send: parseSendRow(row.send),
    counts: parseCounts(row.counts),
    deliveries: Array.isArray(row.deliveries) ? row.deliveries.map(parseDelivery) : [],
    deliveryClaim: typeof row.delivery_claim === "string" ? row.delivery_claim : DELIVERY_CLAIM,
  };
}

/** One `list` row — the send plus its counts, no deliveries. */
export interface SendListEntry {
  sendId: string;
  campaignId: string;
  state: string;
  sendDigest: string;
  created: number;
  approvedAt: number | null;
  counts: SendCounts;
  deliveryClaim: string;
}

export function parseSendList(value: unknown): SendListEntry[] {
  const rows = (value as { sends?: unknown } | null)?.sends;
  if (!Array.isArray(rows)) {
    throw new ApiError("The server returned an invalid send receipt", 502);
  }
  return rows.map((entry) => {
    const row = (entry as Record<string, unknown> | null) ?? {};
    return {
      sendId: typeof row.send_id === "string" ? row.send_id : "",
      campaignId: typeof row.campaign_id === "string" ? row.campaign_id : "",
      state: typeof row.state === "string" ? row.state : "",
      sendDigest: typeof row.send_digest === "string" ? row.send_digest : "",
      created: typeof row.created === "number" ? row.created : 0,
      approvedAt: typeof row.approved_at === "number" ? row.approved_at : null,
      counts: parseCounts(row.counts),
      deliveryClaim: typeof row.delivery_claim === "string" ? row.delivery_claim : DELIVERY_CLAIM,
    };
  });
}

/** `GET /api/crm-send/origin` — the effective unsubscribe origin
 *  plus whether it is an operator-stored override. */
export interface OriginReceipt {
  unsubscribeOrigin: string | null;
  stored: boolean;
}

export function parseOriginReceipt(value: unknown): OriginReceipt {
  const row = (value as Record<string, unknown> | null) ?? {};
  return {
    unsubscribeOrigin: typeof row.unsubscribe_origin === "string" ? row.unsubscribe_origin : null,
    stored: row.stored === true,
  };
}

/** The terminal states a send reaches — the progress poll stops on
 *  any of these (and on unmount, and at its own bound). */
export function sendTerminal(state: string): boolean {
  return state === "completed" || state === "closed";
}

export const sendClient = {
  DELIVERY_CLAIM, sendTerminal,
  smtpShow: (scope: SendScope): Promise<unknown> => serviceCall(scope, "smtp.show", {}),
  smtpManage: (scope: SendScope): Promise<unknown> => serviceSlot(scope, "smtp.manage", {}),
  smtpBind: (scope: SendScope): Promise<unknown> => serviceSlot(scope, "smtp.bind", {}),
  smtpRebind: (scope: SendScope): Promise<unknown> => serviceSlot(scope, "smtp.rebind", {}),
  smtpRevoke: (scope: SendScope): Promise<unknown> => serviceSlot(scope, "smtp.revoke", {}),
  smtpTestSend: (scope: SendScope, campaignId: string): Promise<unknown> => serviceSlot(scope, "smtp.test-send", { campaign_id: campaignId }),
  sendPrepare: (scope: SendScope, campaignId: string, audienceFreezeId: string, requestId: string): Promise<unknown> => serviceCall(scope, "sends.prepare", { campaign_id: campaignId, audience_freeze_id: audienceFreezeId, request_id: requestId }),
  sendApprove: (scope: SendScope, sendId: string): Promise<unknown> => serviceSlot(scope, "sends.approve", { send_id: sendId }).then(() => serviceCall(scope, "sends.show", { send_id: sendId })),
  sendResolve: (scope: SendScope, sendId: string, customerId: string): Promise<unknown> => serviceSlot(scope, "sends.resolve", { send_id: sendId, customer_id: customerId }),
  sendShow: (scope: SendScope, sendId: string): Promise<unknown> => serviceCall(scope, "sends.show", { send_id: sendId }),
  sendList: (scope: SendScope, campaignId?: string): Promise<unknown> => serviceCall(scope, "sends.list", { campaign_id: campaignId }),
  sendOriginShow: (scope: SendScope): Promise<unknown> => serviceCall(scope, "origin.show", {}),
  sendOriginManage: (scope: SendScope): Promise<unknown> => serviceSlot(scope, "origin.manage", {}),
};

/** Server refusals stay verbatim; transport failures name the retry. */
export function friendlySendError(error: unknown): string {
  return hostErrorText(error, "The send request was refused — retry.");
}

/** `smtpShow`'s "none bound" refusal is the host's report of an
 *  empty state, not a transport failure — callers map it to null. */
export function isNoSenderBound(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.message.includes("no SMTP sender is bound") ||
      error.message.includes("sender binding is revoked") ||
      error.message.includes("sender refused or unavailable"))
  );
}

/** `smtpShow` read as a binding; the none-bound refusal is `null`
 *  (an empty state), every other refusal is thrown verbatim. */
export function readSmtpBinding(scope: SendScope): Promise<SmtpBinding | null> {
  return sendClient.smtpShow(scope).then(parseSmtpBinding, (error: unknown) => {
    if (isNoSenderBound(error)) return null;
    throw error;
  });
}
