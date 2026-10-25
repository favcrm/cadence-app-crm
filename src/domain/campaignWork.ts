import { ApiError } from "@cadence/screen-ui";
import { checkCampaignId } from "../features/crm/campaignGrammar";
import type { ReadinessItem } from "../features/crm/campaign/readiness";

/**
 * App-owned campaign work metadata and the scoped `crm-campaign-work/v1`
 * read contract (CRM-12).
 *
 * The CRM source records who a campaign is assigned to, who assigned it
 * and when, its due date, its lifecycle status and a blocked reason. Those
 * are inert facts: this module records and reads them, and grants no
 * approval, send, publish or effect authority. It does not copy content,
 * proposals, test-send facts or send history — the one content value it
 * keeps is the revision the record was last written against.
 *
 * `next_decision` is deliberately *not* stored. It is derived, on demand,
 * from the campaign's existing readiness chain (`readiness.ts`) plus the
 * recorded lifecycle, so no second copy of readiness can drift. Every
 * other value a caller receives is either recorded by this source or
 * listed in `unavailable`; nothing is inferred from content authorship,
 * prose or UI state.
 *
 * The read contract is source-qualified and installation/context-scoped:
 * a response carries the source identity, the campaign identity and the
 * canonical CRM link together, so identical campaign ids in two
 * installations never collide. Forbidden callers and stale revisions get
 * a refusal with no values, never a silent retry, a synthetic row or a
 * fallback shape.
 */

/** The capability an installation advertises to become a campaign-work
 *  source. The host discovers sources by this declared contract, never by
 *  an app-name branch: `needs.requires.contracts` in `app.md` names it. */
export const WORK_APP = "crm";
export const WORK_CONTRACT = "crm-campaign-work/v1";

export const ASSIGNEE_MAX = 80;
export const BLOCKED_REASON_MAX = 200;
export const DUE_AT_LENGTH = 10;

/** Lifecycle status values the source accepts. `null` means "not
 *  recorded", which is a different fact from any status. */
export const WORK_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number]["value"];

export function isWorkStatus(value: unknown): value is WorkStatus {
  return typeof value === "string" && WORK_STATUSES.some((status) => status.value === value);
}

/** One recorded work row. `revision` is the write CAS token, never the
 *  content revision; `contentRevision` records what the write saw. */
export interface WorkRecord {
  revision: number;
  contentRevision: number | null;
  assignee: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  dueAt: string | null;
  status: WorkStatus | null;
  blockedReason: string | null;
  updatedAt: string;
}

/** A validated write patch: a present key is a requested change, an
 *  absent key is untouched. `null` clears. Never carries attribution,
 *  revisions or `next_decision` — those are recorded or derived. */
export interface WorkWritePatch {
  assignee?: string | null;
  dueAt?: string | null;
  status?: WorkStatus | null;
  blockedReason?: string | null;
}

/** Who performed a write. Recorded by the source from the authenticated
 *  caller, never from request text. */
export interface WorkAttribution {
  actor: string;
  /** ISO-8601 instant. */
  at: string;
}

const PLAIN_LINE = /[<>`{}\u0000-\u001f\u007f]/;

/** A plain single-line claim: trimmed, bounded, no markup or control
 *  characters. The same shape the campaign name uses. */
function checkPlainLine(value: string, max: number, what: string): void {
  if (value.length < 1 || value.length > max || value.trim() !== value || PLAIN_LINE.test(value)) {
    throw new ApiError(`${what} must be plain text of 1–${max} characters.`, 400);
  }
}

export function checkAssignee(value: string): void {
  checkPlainLine(value, ASSIGNEE_MAX, "An assignee");
}

/** A due date is a calendar day, not an instant: `YYYY-MM-DD` that names a
 *  real day. Refusing an impossible day keeps "2026-02-30" from becoming a
 *  silent roll-over in some other timezone. */
export function checkDueAt(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const valid = match !== null && (() => {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= days;
  })();
  if (!valid) throw new ApiError("A due date is a real calendar day written YYYY-MM-DD.", 400);
}

export function checkBlockedReason(value: string): void {
  checkPlainLine(value, BLOCKED_REASON_MAX, "A blocked reason");
}

export function checkWorkStatus(value: unknown): WorkStatus {
  if (!isWorkStatus(value)) {
    throw new ApiError("A work status is planned, in_progress, blocked, done or cancelled.", 400);
  }
  return value;
}

/** ISO-8601 UTC instants are the only timestamps the source records. */
export function isInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const closed = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));
const revisionValue = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const nullableText = (value: unknown, max: number): value is string | null =>
  value === null || (typeof value === "string" && value.length >= 1 && value.length <= max && value.trim() === value && !PLAIN_LINE.test(value));

export const WORK_RECORD_KEYS = [
  "revision",
  "content_revision",
  "assignee",
  "assigned_by",
  "assigned_at",
  "due_at",
  "status",
  "blocked_reason",
  "updated_at",
] as const;
export const WORK_VIEW_KEYS = ["contract", "source", "campaign_id", "work", "content"] as const;
const WORK_SOURCE_KEYS = ["app", "install_id", "context_id"] as const;
const WORK_CONTENT_KEYS = ["revision", "digest"] as const;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A host reply that does not match the closed shape. One message: the
 *  caller cannot act on the difference between malformed fields. */
function invalid(): never {
  throw new ApiError("The campaign work reply is invalid.", 502);
}

/** One work row exactly as the source stores it. Closed keys and bounded
 *  values: a host reply that grew an authority-shaped field (an actor, a
 *  revision claim, a link) is refused rather than half-read. */
export function parseWorkRecord(value: unknown): WorkRecord {
  if (!obj(value) || !closed(value, WORK_RECORD_KEYS)) invalid();
  if (!revisionValue(value.revision) || value.revision < 1) invalid();
  if (!revisionValue(value.content_revision) && value.content_revision !== null) invalid();
  if (!nullableText(value.assignee, ASSIGNEE_MAX)) invalid();
  if (!nullableText(value.assigned_by, ASSIGNEE_MAX)) invalid();
  if (!isInstant(value.assigned_at) && value.assigned_at !== null) invalid();
  if (value.due_at !== null) {
    if (typeof value.due_at !== "string") invalid();
    checkDueAt(value.due_at);
  }
  if (!isWorkStatus(value.status) && value.status !== null) invalid();
  if (!nullableText(value.blocked_reason, BLOCKED_REASON_MAX)) invalid();
  if (!isInstant(value.updated_at)) invalid();
  return {
    revision: value.revision,
    contentRevision: value.content_revision,
    assignee: value.assignee,
    assignedBy: value.assigned_by,
    assignedAt: value.assigned_at,
    dueAt: value.due_at,
    status: value.status,
    blockedReason: value.blocked_reason,
    updatedAt: value.updated_at,
  };
}

/** The facts the source returns for one campaign: its recorded work row
 *  (or none) and the content revision it references. */
export interface CampaignWorkFacts {
  contract: string;
  source: { app: string; installId: string; contextId: string | null };
  campaignId: string;
  work: WorkRecord | null;
  content: { revision: number; digest: string } | null;
}

export function parseWorkView(value: unknown): CampaignWorkFacts {
  if (!obj(value) || !closed(value, WORK_VIEW_KEYS) || value.contract !== WORK_CONTRACT) {
    invalid();
  }
  if (!obj(value.source) || !closed(value.source, WORK_SOURCE_KEYS) || value.source.app !== WORK_APP) {
    invalid();
  }
  if (typeof value.source.install_id !== "string" || !ID.test(value.source.install_id)) invalid();
  if (value.source.context_id !== null && (typeof value.source.context_id !== "string" || !ID.test(value.source.context_id))) invalid();
  if (typeof value.campaign_id !== "string") invalid();
  checkCampaignId(value.campaign_id);
  const work = value.work === null ? null : parseWorkRecord(value.work);
  let content: { revision: number; digest: string } | null = null;
  if (value.content !== null) {
    if (!obj(value.content) || !closed(value.content, WORK_CONTENT_KEYS) || !revisionValue(value.content.revision) || value.content.revision < 1 || typeof value.content.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.content.digest)) {
      invalid();
    }
    content = { revision: value.content.revision, digest: value.content.digest };
  }
  return {
    contract: value.contract,
    source: { app: value.source.app, installId: value.source.install_id, contextId: value.source.context_id },
    campaignId: value.campaign_id,
    work,
    content,
  };
}

/** The write CAS token: the current row's revision, or 0 when the
 *  campaign has no work row yet. A caller that sends anything else is
 *  stale and is refused instead of overwriting a newer decision. */
export function workRevision(work: WorkRecord | null): number {
  return work === null ? 0 : work.revision;
}

export function isStaleRevision(work: WorkRecord | null, expected: number): boolean {
  return !Number.isSafeInteger(expected) || expected < 0 || expected !== workRevision(work);
}

export function assertWorkRevision(work: WorkRecord | null, expected: number): void {
  if (isStaleRevision(work, expected)) {
    throw new ApiError("These campaign work details changed. Reload them before saving again.", 409, {
      code: "stale_revision",
    });
  }
}

/** Apply one validated patch. Pure: the store's transaction wraps it.
 *  - every write increments `revision` and stamps `updated_at`;
 *  - a changed assignee (including clearing it) records who did it and
 *    when, so provenance always names the last assignment decision;
 *  - leaving `status` out of `blocked` clears the blocked reason, so a
 *    resumption never keeps a stale block text;
 *  - `contentRevision` re-binds the row to what the write saw. */
export function applyWorkWrite(
  current: WorkRecord | null,
  patch: WorkWritePatch,
  attribution: WorkAttribution,
  contentRevision: number | null,
): WorkRecord {
  for (const key of Object.keys(patch)) {
    if (!["assignee", "dueAt", "status", "blockedReason"].includes(key)) {
      throw new ApiError(`Campaign work write carries a forbidden field: ${key}`, 400);
    }
  }
  checkPlainLine(attribution.actor, ASSIGNEE_MAX, "The writing actor");
  if (!isInstant(attribution.at)) throw new ApiError("The write time is not an instant.", 400);
  if (contentRevision !== null && (!Number.isSafeInteger(contentRevision) || contentRevision < 1)) {
    throw new ApiError("The content revision is invalid.", 400);
  }
  const next: WorkRecord = current === null
    ? {
        revision: 0,
        contentRevision,
        assignee: null,
        assignedBy: null,
        assignedAt: null,
        dueAt: null,
        status: null,
        blockedReason: null,
        updatedAt: attribution.at,
      }
    : { ...current, contentRevision: contentRevision ?? current.contentRevision };
  if (patch.assignee !== undefined) {
    const assignee = patch.assignee;
    if (assignee !== null) checkAssignee(assignee);
    if (assignee !== next.assignee) {
      next.assignee = assignee;
      next.assignedBy = attribution.actor;
      next.assignedAt = attribution.at;
    }
  }
  if (patch.dueAt !== undefined) {
    if (patch.dueAt !== null) checkDueAt(patch.dueAt);
    next.dueAt = patch.dueAt;
  }
  if (patch.status !== undefined) {
    if (patch.status !== null) checkWorkStatus(patch.status);
    next.status = patch.status;
    if (patch.status !== "blocked") next.blockedReason = null;
  }
  if (patch.blockedReason !== undefined) {
    if (patch.blockedReason !== null) checkBlockedReason(patch.blockedReason);
    if (patch.blockedReason !== null && next.status !== "blocked") {
      throw new ApiError("A blocked reason needs the blocked status.", 400);
    }
    next.blockedReason = patch.blockedReason;
  }
  next.revision += 1;
  next.updatedAt = attribution.at;
  return next;
}

/** The form's strings, as the panel holds them. */
export interface WorkEdit {
  assignee: string;
  dueAt: string;
  status: string;
  blockedReason: string;
}

/** Only what changed, derived from the form. An empty string clears a value.
 *  A reason-only edit on a blocked row carries the blocked status too: a
 *  blocked reason is only ever valid with it. Structural only — the client
 *  owns the value grammar and refuses before any request is built. */
export function workPatch(loaded: WorkRecord | null, edit: WorkEdit): WorkWritePatch {
  const patch: WorkWritePatch = {};
  const assignee = edit.assignee.trim();
  if (assignee !== (loaded?.assignee ?? "")) patch.assignee = assignee === "" ? null : assignee;
  const dueAt = edit.dueAt.trim();
  if (dueAt !== (loaded?.dueAt ?? "")) patch.dueAt = dueAt === "" ? null : dueAt;
  const status = edit.status === "" ? null : checkWorkStatus(edit.status);
  if (status !== (loaded?.status ?? null)) patch.status = status;
  if (status === "blocked") {
    const reason = edit.blockedReason.trim();
    if (reason !== (loaded?.blockedReason ?? "")) {
      patch.status = "blocked";
      patch.blockedReason = reason === "" ? null : reason;
    }
  }
  return patch;
}

/** What the app can prove about send readiness, as four recorded facts.
 *  These are the inputs to `next_decision`; they are read from the same
 *  chain the Overview checklist renders, never re-derived from prose. */
export interface WorkReadinessFacts {
  draft: boolean | null;
  audience_valid: boolean | null;
  sender_live: boolean | null;
  test_accepted: boolean | null;
}

export interface NextDecision {
  key: "closed" | "unblock" | "draft" | "audience" | "sender" | "test" | "send" | "unknown";
  label: string;
  /** The recorded block text, when the decision is to unblock. */
  reason: string | null;
}

/** Map the existing readiness items to contract facts. A key the chain
 *  did not report stays `null` ("not recorded") rather than pretending
 *  the check failed. */
export function readinessFacts(items: readonly ReadinessItem[]): WorkReadinessFacts {
  const fact = (key: ReadinessItem["key"]): boolean | null => {
    const item = items.find((row) => row.key === key);
    return item === undefined ? null : item.done;
  };
  return {
    draft: fact("draft"),
    audience_valid: fact("freeze"),
    sender_live: fact("sender"),
    test_accepted: fact("test"),
  };
}

/** The one next-decision algorithm. The stored lifecycle wins first; then
 *  the existing readiness chain decides in task order. Readiness logic is
 *  not restated here — the caller supplies the chain's answers. */
export function nextDecision(work: WorkRecord | null, facts: WorkReadinessFacts): NextDecision {
  if (work !== null && (work.status === "done" || work.status === "cancelled")) {
    return { key: "closed", label: "Closed — no further work", reason: null };
  }
  if (work !== null && (work.status === "blocked" || work.blockedReason !== null)) {
    return {
      key: "unblock",
      label: work.blockedReason === null ? "Unblock this campaign" : `Unblock: ${work.blockedReason}`,
      reason: work.blockedReason,
    };
  }
  if (facts.draft === null || facts.audience_valid === null || facts.sender_live === null || facts.test_accepted === null) {
    return { key: "unknown", label: "Campaign readiness is not recorded", reason: null };
  }
  if (!facts.draft) return { key: "draft", label: "Draft the campaign email", reason: null };
  if (!facts.audience_valid) return { key: "audience", label: "Freeze and recheck the audience", reason: null };
  if (!facts.sender_live) return { key: "sender", label: "Connect a live email sender", reason: null };
  if (!facts.test_accepted) return { key: "test", label: "Send an accepted test email", reason: null };
  return { key: "send", label: "Prepare and send the campaign", reason: null };
}

/** The canonical CRM link. It is only an address: it names nothing
 *  without the source identity beside it. */
export function workLink(campaignId: string): string {
  checkCampaignId(campaignId);
  return `crm:campaigns/${campaignId}`;
}

/** `app:install:context:campaign` — the source-qualified identity. Two
 *  installations may hold the same campaign id; this key never collides. */
export function workIdentity(source: { app: string; installId: string; contextId: string | null }, campaignId: string): string {
  return `${source.app}:${source.installId}:${source.contextId ?? "-"}:${campaignId}`;
}

export interface WorkSource {
  app: string;
  installId: string;
  contextId: string | null;
}

export interface CampaignWorkReadInput {
  source: WorkSource;
  campaignId: string;
  work: WorkRecord | null;
  content: { revision: number; digest: string } | null;
  /** `null` when the source could not read the readiness chain: the
   *  response then labels `next_decision` unavailable instead of guessing. */
  readiness: WorkReadinessFacts | null;
  access: "authorized" | "forbidden";
  /** The caller's last-read work revision. A mismatch refuses the read. */
  expectedRevision?: number;
}

export type WorkReadState = "ok" | "unavailable" | "partial" | "forbidden" | "stale";

export interface CampaignWorkRead {
  contract: string;
  state: WorkReadState;
  source: { app: string; install_id: string; context_id: string | null };
  identity: string;
  campaign: { id: string; link: string };
  revision: number | null;
  content_revision: number | null;
  content: { revision: number; digest: string } | null;
  assignment: { assignee: string | null; assigned_by: string | null; assigned_at: string | null } | null;
  due_at: string | null;
  lifecycle: { status: WorkStatus | null; blocked_reason: string | null; updated_at: string } | null;
  next_decision: NextDecision | null;
  /** Recorded values this response could not provide. Never a fallback. */
  unavailable: string[];
  refusal: { code: "forbidden" | "stale_revision"; text: string } | null;
}

const UNRECORDED = ["assignee", "assigned_by", "assigned_at", "due_at", "status", "blocked_reason"];

/** Project recorded facts into the scoped read contract. State order:
 *  forbidden → stale → unavailable/partial/ok. Only an authorized,
 *  revision-current read returns values. */
export function campaignWorkRead(input: CampaignWorkReadInput): CampaignWorkRead {
  const { source, campaignId, work, content, readiness, access, expectedRevision } = input;
  const base = {
    contract: WORK_CONTRACT,
    source: { app: source.app, install_id: source.installId, context_id: source.contextId },
    identity: workIdentity(source, campaignId),
    campaign: { id: campaignId, link: workLink(campaignId) },
  };
  /** Nothing recorded: no revision, no content facts, no decision. */
  const noValues = {
    revision: null,
    content_revision: null,
    content: null,
    assignment: null,
    due_at: null,
    lifecycle: null,
    next_decision: null,
    unavailable: [] as string[],
  };
  /** Authorized content facts are the caller's to see; forbidden/stale are not. */
  const contentFacts = { content, content_revision: content?.revision ?? null };
  if (access !== "authorized") {
    return {
      ...base,
      ...noValues,
      state: "forbidden",
      unavailable: [...UNRECORDED, "next_decision"],
      refusal: { code: "forbidden", text: "This caller is not authorized for this campaign work source." },
    };
  }
  if (expectedRevision !== undefined && isStaleRevision(work, expectedRevision)) {
    return {
      ...base,
      ...noValues,
      // Revision tokens only: enough to retry against the current row, with
      // no content facts and no recorded work values.
      revision: workRevision(work),
      content_revision: work?.contentRevision ?? null,
      state: "stale",
      unavailable: [...UNRECORDED, "next_decision"],
      refusal: {
        code: "stale_revision",
        text: "These campaign work details changed. Re-read before using them.",
      },
    };
  }
  const unavailable: string[] = [];
  const decision = readiness === null ? null : nextDecision(work, readiness);
  if (decision === null) unavailable.push("next_decision");
  if (work === null) {
    unavailable.push(...UNRECORDED);
    return {
      ...base,
      ...noValues,
      ...contentFacts,
      state: "unavailable",
      next_decision: decision,
      unavailable,
      refusal: null,
    };
  }
  if (work.assignee === null) unavailable.push("assignee");
  if (work.assignedBy === null) unavailable.push("assigned_by");
  if (work.assignedAt === null) unavailable.push("assigned_at");
  if (work.dueAt === null) unavailable.push("due_at");
  if (work.status === null) unavailable.push("status");
  if (work.status === "blocked" && work.blockedReason === null) unavailable.push("blocked_reason");
  return {
    ...base,
    state: decision === null ? "partial" : "ok",
    revision: work.revision,
    content_revision: work.contentRevision,
    content,
    assignment: { assignee: work.assignee, assigned_by: work.assignedBy, assigned_at: work.assignedAt },
    due_at: work.dueAt,
    lifecycle: { status: work.status, blocked_reason: work.blockedReason, updated_at: work.updatedAt },
    next_decision: decision,
    unavailable,
    refusal: null,
  };
}
