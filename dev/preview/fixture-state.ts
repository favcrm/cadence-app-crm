import { ApiError } from "@cadence/screen-ui";
import { buildCustomerProfile, formFromProfile, readCustomerContacts, type CustomerContact } from "../../src/features/crm/customerProfile";
import { readCustomerCustomFields, type CustomerCustomFields } from "../../src/features/crm/customerCustomFields";
import { checkPredicate, checkSegmentName } from "../../src/features/crm/segmentGrammar";
import { checkCampaignId, checkCampaignName, checkContent, checkContentFields, type CampaignBlock } from "../../src/features/crm/campaignGrammar";

export const fixtureDigest = `sha256:${"0".repeat(64)}`;
export const fixtureInstallId = "crm-local-fixture";
export const fixtureActions = [
  "records.list", "records.show", "records.create", "records.update", "records.aggregate", "records.batch", "records.csv.preview", "records.merge",
  "segments.list", "segments.show", "segments.save", "audience.preview",
  "content.list", "content.show", "content.save", "content.clone", "content.render", "proposals.list", "sends.list", "sends.show",
  "sender-bindings.list", "exclusions.list", "suppressions.list", "smtp.show", "origin.show", "audience.show",
  "screen.route.patch", "screen.preview.show", "screen.preview.clear",
];
type Profile = { schema: number; display_name: string; email?: string | null; phone?: string | null; customer_type?: "person" | "organization" | null; website?: string | null; contacts: CustomerContact[]; custom_fields: CustomerCustomFields; tags: string[]; source?: string | null; consent: { email: string; sms: string } };
type LocalRecord = { id: string; install_id: string; context_id: string; kind: string; revision: number; digest: string; profile: Profile; history: { revision: number; digest: string; actor: string; at: number; before: Profile | null; after: Profile }[]; consent_history: { revision: number; channel: string; state: string; actor: string; at: number; method?: string; note?: string }[] };
type Predicate = { field: string; op: string; value: string };
type Segment = { id: string; revision: number; name: string; segment_type?: "dynamic" | "static"; predicates: Predicate[]; member_ids?: string[]; digest: string };
type Content = { draft_audience_full?: unknown; campaign_id: string; name: string; revision: number; subject: string; preheader: string; blocks: CampaignBlock[]; mode: "blocks" | "html"; html: string | null; text_override: string | null; content_digest: string; approval: { revision: null; digest: null; valid: false; scope: string } };
const records: LocalRecord[] = [
  { id: "ada", name: "Ada Chen", email: "ada@example.invalid", tags: ["vip"], consent: "granted" },
  { id: "sam", name: "Sam Rivera", email: "sam@example.invalid", tags: ["member"], consent: "unknown" },
  { id: "lee", name: "Lee Wong", email: "lee@example.invalid", tags: ["vip"], consent: "denied" },
  // Long values exercise the single-line customer table in narrow canvases.
  { id: "wholesale", name: "Bartholomew Wolfeschlegelsteinhausenbergerdorff-Montgomery", email: "bartholomew.wolfeschlegelstein@wholesale-distribution.example.invalid", tags: ["wholesale", "vip", "newsletter", "events"], consent: "granted" },
].map(row => ({ id: row.id, install_id: fixtureInstallId, context_id: "", kind: "customer", revision: 1, digest: fixtureDigest, profile: { schema: 1, display_name: row.name, email: row.email, phone: null, contacts: row.id === "ada" ? [{ name: "Alex Demo", title: "Operations", email: "alex@example.invalid", phone: null }] : [], custom_fields: (row.id === "ada" ? { customer_segment: { label: "Customer segment", type: "text", value: "Local fixture" } } : {}) as CustomerCustomFields, tags: row.tags, source: "fixture", consent: { email: row.consent, sms: "unknown" } }, history: [], consent_history: [] }));
type NoteRow = {
  id: string;
  install_id: string;
  context_id: string;
  kind: string;
  table: string;
  revision: number;
  digest: string;
  profile: { customer_id: string; body: string; archived_at: string | null };
};
const noteRows: NoteRow[] = [
  {
    id: "note-ada-1",
    install_id: fixtureInstallId,
    context_id: "",
    kind: "customer",
    table: "notes",
    revision: 1,
    digest: fixtureDigest,
    profile: { customer_id: "ada", body: "Met at Hong Kong trade fair; prefers concise quarterly updates.", archived_at: null },
  },
];
type GenericTableRow = {
  id: string;
  install_id: string;
  context_id: string;
  kind: string;
  table: string;
  revision: number;
  digest: string;
  profile: Record<string, unknown>;
};
const dealRows: GenericTableRow[] = [
  {
    id: "deal-ada-1",
    install_id: fixtureInstallId,
    context_id: "",
    kind: "customer",
    table: "deals",
    revision: 1,
    digest: fixtureDigest,
    profile: { customer_id: "ada", title: "Annual Enterprise Plan", stage: "proposal", amount_cents: 2400000, currency: "HKD", expected_close_date: "2026-12-15", owner_label: "Owner", notes: null, synthetic: false },
  },
];
const taskRows: GenericTableRow[] = [
  {
    id: "task-ada-1",
    install_id: fixtureInstallId,
    context_id: "",
    kind: "customer",
    table: "tasks",
    revision: 1,
    digest: fixtureDigest,
    profile: { customer_id: "ada", deal_id: "deal-ada-1", title: "Send signed proposal", status: "open", due_at: "2026-11-30", assignee: "Owner", notes: null, synthetic: false },
  },
];
const touchpointRows: GenericTableRow[] = [
  {
    id: "tp-ada-1",
    install_id: fixtureInstallId,
    context_id: "",
    kind: "customer",
    table: "touchpoints",
    revision: 1,
    digest: fixtureDigest,
    profile: { customer_id: "ada", channel: "meeting", direction: "inbound", summary: "Reviewed annual pricing options.", occurred_at: "2026-11-22T10:00:00Z", ref_id: null, synthetic: false },
  },
];
const ownedRecordIds = new Set<string>();
const segments: Segment[] = [{ id: "vip", revision: 1, name: "VIP customers", segment_type: "dynamic", predicates: [{ field: "tag", op: "eq", value: "vip" }], digest: fixtureDigest }, { id: "selected", revision: 1, name: "Selected accounts", segment_type: "static", predicates: [], member_ids: ["ada", "sam"], digest: fixtureDigest }];
const fixtureSender = { name: "Fixture sender", address: "preview@example.invalid" };
const fixtureSmtpBinding = { connection_id: "fixture-smtp", auth_revision: 1, link_revision: 1, state: "live", digest: fixtureDigest, sender: fixtureSender, transport_kind: "smtp" };
const fixtureSenderBindings = [{ binding_id: "fixture-sender", revision: 1, digest: fixtureDigest, sender: fixtureSender, unsubscribe_base: "https://example.invalid/unsubscribe" }];
/** CRM-12 browser-memory work rows. No entry is seeded: the fixture campaign
 *  starts unassigned, so the "no recorded work" path is what the preview
 *  exercises by default. */
const contents: Content[] = [{ campaign_id: "welcome", name: "Welcome — fixture draft", revision: 1, subject: "Welcome to the community", preheader: "A synthetic local-development email.", blocks: [{ type: "heading", text: "Welcome" }, { type: "paragraph", text: "This is synthetic preview content. No email can be sent." }], mode: "blocks", html: null, text_override: null, content_digest: fixtureDigest, approval: { revision: null, digest: null, valid: false, scope: "content-only" } }];

/** Preview switches, read from the preview page's own URL:
 *  `?board=audience` makes the fixture board keep an audience the way an
 *  AOS-521 board does (`draft_audience_full`); without it the fixture is an
 *  older board that cannot. `?sends=sending|sent|partial|uncertain` seeds one
 *  READ-ONLY send row so the status chip and result view can be seen. No send,
 *  approval or test is ever simulated: slots stay refused. `?access=read`
 *  or `?access=write` shows the host's per-record edit decision.
 *  `?create=uncertain` simulates a lost response after creating a fixture.
 *  `?history=truncated` reports that earlier record changes are unavailable;
 *  `?history=paged` supplies synthetic paged activity for Ada.
 *  `?history=access-changed` also refuses the earlier page and first fresh read. */
const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const historyMode = params.get("history");
const hasPagedHistory = historyMode === "paged" || historyMode === "access-changed";
let refuseNextCustomerRead = false;
if (hasPagedHistory) {
  const ada = records[0]!;
  ada.revision = 23;
  ada.history = Array.from({ length: 23 }, (_, index) => ({
    revision: index + 1, digest: fixtureDigest, actor: `Fixture ${index + 1}`, at: 1700000000 + index * 60,
    before: index === 0 ? null : structuredClone(ada.profile), after: structuredClone(ada.profile),
  }));
}
const keepsAudience = params.get("board") === "audience";
const seededSend = params.get("sends");
const recordAccess = params.get("access");
const sendCounts = { sending: { queued: 80, submitting: 3, accepted: 41, failed: 0, uncertain: 0, suppressed: 0, closed: 0 }, sent: { queued: 0, submitting: 0, accepted: 121, failed: 0, uncertain: 0, suppressed: 3, closed: 0 }, partial: { queued: 0, submitting: 0, accepted: 113, failed: 8, uncertain: 0, suppressed: 3, closed: 0 }, uncertain: { queued: 0, submitting: 0, accepted: 60, failed: 0, uncertain: 2, suppressed: 0, closed: 0 } } as const;
function seededSendRow() {
  const key = seededSend as keyof typeof sendCounts | null;
  if (!key || !(key in sendCounts)) return null;
  return { send_id: "send-fixture", campaign_id: "welcome", state: key === "sending" ? "sending" : "completed", send_digest: fixtureDigest, content_revision: 1, content_digest: fixtureDigest, audience_freeze_id: "welcome-freeze-fixture", audience_digest: fixtureDigest, connection_id: "fixture-smtp", link_revision: 1, max_recipients: 200, unsubscribe_origin: "https://example.invalid", created: 1, approved_at: 2, counts: sendCounts[key], delivery_claim: "smtp-acceptance-only" };
}
function withAudience(content: Content): Content {
  return keepsAudience ? { ...content, draft_audience_full: content.draft_audience_full ?? null } : content;
}

function requireId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ApiError("A valid local record ID is required.", 400, { code: "invalid_body" });
}
function requireRevision(existing: { revision: number } | undefined, expected: unknown) {
  if (existing ? expected !== existing.revision : expected !== undefined) throw new ApiError("This local record changed. Reload it before saving again.", 409, { code: "conflict" });
}
function missing(): never { throw new ApiError("No matching local fixture exists.", 404, { code: "not_found" }); }
function changed(message: string) {
  window.dispatchEvent(new CustomEvent("preview-action", { detail: `${message} Reload or reset to discard this browser-memory change.` }));
}
function matches(record: LocalRecord, predicates: Predicate[]) {
  return predicates.every(rule => {
    const profile = record.profile;
    const value = rule.field === "source" ? profile.source : rule.field === "consent_email" ? profile.consent.email : rule.field === "email_domain" ? profile.email?.split("@")[1]?.toLowerCase() : undefined;
    const equal = rule.field === "tag" ? profile.tags.includes(rule.value) : value === rule.value;
    return rule.op === "eq" ? equal : !equal;
  });
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
export function inertHtml(raw: string) {
  const template = document.createElement("template");
  template.innerHTML = raw;
  const allowed: Record<string, true> = { H1: true, H2: true, H3: true, H4: true, P: true, BR: true, STRONG: true, EM: true, B: true, I: true, U: true, S: true, A: true, DIV: true, SPAN: true, TABLE: true, TBODY: true, THEAD: true, TFOOT: true, TR: true, TD: true, TH: true, UL: true, OL: true, LI: true, BLOCKQUOTE: true, HR: true };
  for (const element of template.content.querySelectorAll("*")) {
    if (element.tagName === "PICTURE") {
      element.replaceWith(...element.childNodes);
      continue;
    }
    if (element.tagName === "IMG") {
      element.replaceWith(element.getAttribute("alt") ?? "");
      continue;
    }
    if (!allowed[element.tagName]) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) if (!["style", "title", "colspan", "rowspan"].includes(attribute.name)) element.removeAttribute(attribute.name);
  }
  return template.innerHTML;
}
function pagedHistory<T extends LocalRecord>(record: T, cursor: unknown) {
  const ordered = [...record.history].reverse();
  const anchor = typeof cursor === "string" ? parseInt(cursor, 16) : null;
  if (anchor !== null && !ordered.some((entry) => entry.revision === anchor)) {
    throw new ApiError("That local history cursor is not available.", 400, { code: "invalid_cursor" });
  }
  const older = anchor === null ? ordered : ordered.filter((entry) => entry.revision < anchor);
  const history = older.slice(0, 20);
  const truncated = older.length > history.length;
  return { ...record, history, history_truncated: truncated,
    ...(truncated ? { history_next_cursor: history.at(-1)!.revision.toString(16).padStart(32, "0") } : {}) };
}

/** The same contract shape the paired host serves: recorded facts only.
 *  `next_decision` is never serialized — the app derives it. */
export function fixtureCall(verb: string, args: Record<string, unknown>): unknown {
  // `?owner=required` answers every owner-only table read the way the host answers a member (CRM-28).
  if (params.get("owner") === "required" && /^(segments|exclusions|suppressions|content|proposals|sender-bindings|sends|smtp|origin)\.(list|show)$/.test(verb)) {
    throw new ApiError("Only an owner may read this table's records.", 403, { code: "owner_required" });
  }
  switch (verb) {
    case "records.list": {
      if (args.table === "notes") {
        const filters = Array.isArray(args.filters) ? (args.filters as Array<{ field?: unknown; op?: unknown; value?: unknown }>) : [];
        const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
        let rows = noteRows.filter((row) => row.profile.body.toLowerCase().includes(query));
        for (const f of filters) {
          if (f.field === "customer_id" && f.op === "eq") rows = rows.filter((r) => r.profile.customer_id === f.value);
          if (f.field === "archived_at" && f.op === "eq") rows = rows.filter((r) => r.profile.archived_at === f.value);
        }
        const limit = typeof args.limit === "number" ? Math.max(1, Math.min(100, args.limit)) : 20;
        return { records: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit, next_cursor: rows.length > limit ? rows[limit - 1]!.id : null };
      }
      if (args.table === "deals" || args.table === "tasks" || args.table === "touchpoints") {
        const store = args.table === "deals" ? dealRows : args.table === "tasks" ? taskRows : touchpointRows;
        const filters = Array.isArray(args.filters) ? (args.filters as Array<{ field?: unknown; op?: unknown; value?: unknown }>) : [];
        const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
        let rows = store.filter((row) => JSON.stringify(row.profile).toLowerCase().includes(query));
        for (const f of filters) {
          if (typeof f.field === "string" && f.op === "eq") {
            const key = f.field;
            rows = rows.filter((r) => r.profile[key] === f.value);
          }
        }
        const limit = typeof args.limit === "number" ? Math.max(1, Math.min(100, args.limit)) : 20;
        const start = args.cursor === undefined ? 0 : rows.findIndex(row => row.id === args.cursor) + 1;
        if (args.cursor !== undefined && start === 0) missing();
        const page = rows.slice(start, start + limit);
        const truncated = start + page.length < rows.length;
        return { records: page, total: rows.length, truncated, next_cursor: truncated ? page.at(-1)!.id : null };
      }
      const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
      const rows = records.filter(r => `${r.profile.display_name} ${r.profile.email ?? ""} ${r.profile.tags.join(" ")}`.toLowerCase().includes(query));
      const start = args.cursor === undefined ? 0 : rows.findIndex(row => row.id === args.cursor) + 1;
      if (args.cursor !== undefined && start === 0) missing();
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(100, args.limit)) : 20;
      const page = rows.slice(start, start + limit);
      const truncated = start + page.length < rows.length;
      return { records: page, total: rows.length, truncated, next_cursor: truncated ? page.at(-1)!.id : null,
        ...(recordAccess === "read" || recordAccess === "write" ? { record_access: { create_id: "host" } } : {}) };
    }
    case "records.show": {
      if (args.table === "notes") {
        return { record: noteRows.find((r) => r.id === args.record_id) ?? missing() };
      }
      if (args.table === "deals" || args.table === "tasks" || args.table === "touchpoints") {
        const store = args.table === "deals" ? dealRows : args.table === "tasks" ? taskRows : touchpointRows;
        return { record: store.find((r) => r.id === args.record_id) ?? missing() };
      }
      const record = records.find(r => r.id === args.record_id) ?? missing();
      const visible = recordAccess === "read" || recordAccess === "write"
        ? { ...record, record_access: { can_write: recordAccess === "write" || ownedRecordIds.has(record.id) } } : record;
      if (hasPagedHistory && record.id === "ada") {
        if (historyMode === "access-changed" && typeof args.history_cursor === "string") {
          refuseNextCustomerRead = true;
          throw new ApiError("This fixture customer's access changed.", 409, { code: "conflict" });
        }
        if (refuseNextCustomerRead) {
          refuseNextCustomerRead = false;
          throw new ApiError("This fixture customer's access is unavailable.", 503, { code: "unavailable" });
        }
        return { record: pagedHistory(visible, args.history_cursor) };
      }
      return { record: params.get("history") === "truncated" ? { ...visible, history_truncated: true } : visible };
    }
    case "records.create":
    case "records.update": {
      if (args.table === "notes") {
        const noteId = args.record_id;
        requireId(noteId);
        const existing = noteRows.find((r) => r.id === noteId);
        if (verb === "records.create" && existing) throw new ApiError("That local note already exists.", 409, { code: "conflict" });
        if (verb === "records.update" && !existing) missing();
        requireRevision(existing, args.expected_revision);
        const patch = args.profile !== null && typeof args.profile === "object" && !Array.isArray(args.profile)
          ? (args.profile as { customer_id?: unknown; body?: unknown; archived_at?: unknown })
          : {};
        const customerId = existing ? existing.profile.customer_id : patch.customer_id;
        const body = Object.hasOwn(patch, "body") ? patch.body : existing?.profile.body;
        const archivedAt = Object.hasOwn(patch, "archived_at") ? patch.archived_at : existing?.profile.archived_at ?? null;
        if (typeof customerId !== "string" || typeof body !== "string" || body.trim().length === 0 || (archivedAt !== null && typeof archivedAt !== "string")) {
          throw new ApiError("Invalid fixture note.", 400, { code: "validation_failed" });
        }
        const row: NoteRow = {
          id: noteId,
          install_id: fixtureInstallId,
          context_id: "",
          kind: "customer",
          table: "notes",
          revision: (existing?.revision ?? 0) + 1,
          digest: fixtureDigest,
          profile: { customer_id: customerId, body: body.trim(), archived_at: archivedAt },
        };
        if (existing) noteRows.splice(noteRows.indexOf(existing), 1, row); else noteRows.push(row);
        return { record: row };
      }
      if (args.table === "deals" || args.table === "tasks" || args.table === "touchpoints") {
        const store = args.table === "deals" ? dealRows : args.table === "tasks" ? taskRows : touchpointRows;
        const rowId = args.record_id;
        requireId(rowId);
        const existing = store.find((r) => r.id === rowId);
        if (verb === "records.create" && existing) throw new ApiError("That local record already exists.", 409, { code: "conflict" });
        if (verb === "records.update" && !existing) missing();
        requireRevision(existing, args.expected_revision);
        const patch = args.profile !== null && typeof args.profile === "object" && !Array.isArray(args.profile) ? (args.profile as Record<string, unknown>) : {};
        const row: GenericTableRow = {
          id: rowId,
          install_id: fixtureInstallId,
          context_id: "",
          kind: "customer",
          table: args.table,
          revision: (existing?.revision ?? 0) + 1,
          digest: fixtureDigest,
          profile: { ...(existing?.profile ?? {}), ...patch },
        };
        if (existing) store.splice(store.indexOf(existing), 1, row); else store.push(row);
        return { record: row };
      }
      if (verb === "records.update" && recordAccess === "read" && (typeof args.record_id !== "string" || !ownedRecordIds.has(args.record_id))) throw new ApiError("This fixture customer is read-only.", 403, { code: "forbidden" });
      const hostAssigned = verb === "records.create" && (recordAccess === "read" || recordAccess === "write");
      if (hostAssigned && args.record_id !== undefined) throw new ApiError("The host assigns this customer ID.", 400, { code: "invalid_body" });
      const recordId = hostAssigned ? `mem_${crypto.randomUUID().replaceAll("-", "")}` : args.record_id;
      requireId(recordId);
      const existing = records.find(r => r.id === recordId);
      if (verb === "records.create" && existing) throw new ApiError("That local customer already exists.", 409, { code: "conflict" });
      if (verb === "records.update" && !existing) missing();
      requireRevision(existing, args.expected_revision);
      const patch = args.profile !== null && typeof args.profile === "object" && !Array.isArray(args.profile)
        ? args.profile as Partial<Profile>
        : {};
      const source = Object.hasOwn(patch, "source") ? patch.source : existing?.profile.source;
      const contacts = readCustomerContacts({ contacts: Object.hasOwn(patch, "contacts") ? patch.contacts : existing?.profile.contacts ?? [] });
      if (contacts === null) throw new ApiError("Invalid fixture contacts.", 400, { code: "validation_failed" });
      const customFields = readCustomerCustomFields({ custom_fields: Object.hasOwn(patch, "custom_fields") ? patch.custom_fields : existing?.profile.custom_fields ?? {} });
      if (customFields === null) throw new ApiError("Invalid fixture custom fields.", 400, { code: "validation_failed" });
      const profile = {
        ...buildCustomerProfile(formFromProfile({ ...existing?.profile, ...patch })),
        contacts,
        custom_fields: customFields,
        ...(source === undefined ? {} : { source }),
      } as Profile;
      const revision = (existing?.revision ?? 0) + 1;
      const at = Math.floor(Date.now() / 1000);
      const history = [...(existing?.history ?? []), { revision, digest: fixtureDigest, actor: "local-preview", at, before: existing ? structuredClone(existing.profile) : null, after: structuredClone(profile) }];
      const consent_history = [...(existing?.consent_history ?? [])];
      const provenance = args.consent_provenance as { method?: string; note?: string } | undefined;
      for (const channel of ["email", "sms"] as const) if (profile.consent[channel] !== existing?.profile.consent[channel]) consent_history.push({ revision, channel, state: profile.consent[channel], actor: "local-preview", at, ...(typeof provenance?.method === "string" ? { method: provenance.method } : {}), ...(typeof provenance?.note === "string" ? { note: provenance.note } : {}) });
      const record = { id: recordId, install_id: fixtureInstallId, context_id: "", kind: "customer", revision, digest: fixtureDigest, profile, history, consent_history };
      if (existing) records.splice(records.indexOf(existing), 1, record); else records.push(record);
      if (hostAssigned) ownedRecordIds.add(recordId);
      changed(existing ? "Customer updated locally." : "Customer created locally.");
      if (verb === "records.create" && params.get("create") === "uncertain") throw new ApiError("The local create response was lost.", 503, { code: "outcome_uncertain" });
      const visible = recordAccess === "read" || recordAccess === "write"
        ? { ...record, record_access: { can_write: recordAccess === "write" || ownedRecordIds.has(record.id) } } : record;
      return { record: hasPagedHistory && record.id === "ada" ? pagedHistory(visible, undefined) : visible };
    }
    case "segments.list": return { segments };
    case "segments.show": return { segment: segments.find(s => s.id === args.segment_id) ?? missing() };
    case "segments.save": {
      requireId(args.segment_id);
      const existing = segments.find(s => s.id === args.segment_id);
      requireRevision(existing, args.expected_revision);
      if (typeof args.name !== "string") throw new ApiError("A segment name is required.", 400);
      checkSegmentName(args.name);
      if (!Array.isArray(args.predicates) || args.predicates.length < 1 || args.predicates.length > 8) throw new ApiError("A segment needs 1 to 8 rules.", 400);
      const predicates = args.predicates.map((raw: Predicate) => {
        checkPredicate(raw.field, raw.op, raw.value);
        return { field: raw.field, op: raw.op, value: raw.value };
      });
      const segment = { id: args.segment_id, name: args.name, revision: (existing?.revision ?? 0) + 1, predicates, digest: fixtureDigest };
      if (existing) segments.splice(segments.indexOf(existing), 1, segment); else segments.push(segment);
      changed(existing ? "Segment updated locally." : "Segment created locally.");
      return { segment };
    }
    case "audience.preview": {
      const base = args.base as { mode?: string; segment_id?: string; customer_ids?: string[] };
      let members = records;
      if (base?.mode === "segment") { const segment = segments.find(s => s.id === base.segment_id) ?? missing(); members = segment.segment_type === "static" ? records.filter(r => (segment.member_ids ?? []).includes(r.id)) : records.filter(r => matches(r, segment.predicates)); }
      else if (base?.mode === "custom") members = records.filter(r => base.customer_ids?.includes(r.id));
      else if (base?.mode !== "all") throw new ApiError("Select a local audience.", 400);
      const invalid = members.filter(r => !r.profile.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.profile.email));
      const valid = members.filter(r => !invalid.includes(r));
      const eligible = valid.filter(r => r.profile.consent.email === "granted");
      return { base_count: members.length, exclusion_count: 0, final_count: eligible.length, final_excluded: { invalid_email: invalid.length, no_consent: valid.filter(r => r.profile.consent.email === "unknown").length, unsubscribed: valid.filter(r => r.profile.consent.email === "denied").length, suppressed: 0 }, sample: eligible.slice(0, 20).map(r => ({ id: r.id, display_name: r.profile.display_name })), digest: fixtureDigest };
    }
    case "content.list": return { contents: contents.map(withAudience) };
    case "content.show": return { content: withAudience(contents.find(c => c.campaign_id === args.campaign_id) ?? missing()) };
    case "content.save": {
      if (typeof args.campaign_id !== "string" || typeof args.subject !== "string") throw new ApiError("A campaign ID and subject are required.", 400);
      checkCampaignId(args.campaign_id);
      const existing = contents.find(c => c.campaign_id === args.campaign_id);
      requireRevision(existing, args.expected_revision);
      const name = typeof args.name === "string" ? args.name : existing?.name ?? args.subject;
      checkCampaignName(name);
      const preheader = typeof args.preheader === "string" ? args.preheader : "";
      const blocks = args.blocks as CampaignBlock[] | undefined;
      if ((blocks === undefined) === (args.html === undefined)) throw new ApiError("Choose blocks or HTML, not both.", 400);
      if (blocks) checkContent(args.subject, preheader, blocks);
      else {
        checkContentFields(args.subject, preheader);
        if (typeof args.html !== "string" || !args.html.trim()) throw new ApiError("Valid email HTML is required.", 400);
        if (params.get("board") === "blocks") throw new ApiError("Cadence refused this request. Inspect fresh status before retrying an effect.", 400, { code: "failed" });
      }
      if ("draft_audience" in args && !keepsAudience) throw new ApiError("Unknown field draft_audience.", 400, { code: "validation_failed" });
      const content: Content = { draft_audience_full: "draft_audience" in args ? args.draft_audience : existing?.draft_audience_full ?? null, campaign_id: args.campaign_id, name, revision: (existing?.revision ?? 0) + 1, subject: args.subject, preheader, blocks: blocks ?? [], mode: blocks ? "blocks" : "html", html: typeof args.html === "string" ? inertHtml(args.html) : null, text_override: typeof args.text === "string" ? args.text : null, content_digest: fixtureDigest, approval: { revision: null, digest: null, valid: false, scope: "content-only" } };
      // An audience-only save (same content) keeps the revision, as AOS-521 does.
      const unchanged = existing && existing.subject === content.subject && existing.preheader === content.preheader &&
        existing.mode === content.mode && existing.html === content.html && existing.text_override === content.text_override &&
        JSON.stringify(existing.blocks) === JSON.stringify(content.blocks);
      if (unchanged) content.revision = existing.revision;
      if (existing) contents.splice(contents.indexOf(existing), 1, content); else contents.push(content);
      changed(existing ? "Campaign draft updated locally." : "Campaign draft created locally.");
      return { content: withAudience(content) };
    }
    case "content.clone": {
      const original = contents.find(c => c.campaign_id === args.campaign_id) ?? missing();
      requireRevision(original, args.expected_revision);
      if (args.copy_audience || args.copy_sender) throw new ApiError("Live audience freezes and sender bindings cannot be copied offline.", 503, { code: "unavailable" });
      if (typeof args.name !== "string") throw new ApiError("A clone name is required.", 400);
      checkCampaignName(args.name);
      const content: Content = { ...structuredClone(original), campaign_id: `cmp-${crypto.randomUUID()}`, name: args.name, revision: 1, approval: { revision: null, digest: null, valid: false, scope: "content-only" } };
      contents.push(content);
      changed("Campaign cloned locally.");
      return { content, starter_selection: { audience: null, sender_binding_id: null } };
    }
    case "content.render": {
      const content = contents.find(c => c.campaign_id === args.campaign_id) ?? missing();
      if (args.revision !== undefined && args.revision !== content.revision) throw new ApiError("The saved campaign moved; reload it to preview.", 409, { code: "revision_conflict" });
      if (args.binding_id !== undefined && !fixtureSenderBindings.some(binding => binding.binding_id === args.binding_id)) throw new ApiError("No matching local sender preview exists.", 404, { code: "not_found" });
      const html = content.mode === "html" ? content.html! : content.blocks.map(block => block.type === "button" ? `<p><strong>${escapeHtml(block.label)}</strong></p>` : `<${block.type === "heading" ? "h1" : "p"}>${escapeHtml(block.text)}</${block.type === "heading" ? "h1" : "p"}>`).join("");
      const rendered = html.replace(/\{\{first_name\|([^}]+)\}\}/g, (_match, fallback: string) => escapeHtml(typeof args.sample_first_name === "string" && args.sample_first_name ? args.sample_first_name : fallback));
      const template = document.createElement("template"); template.innerHTML = rendered;
      return { render: { revision: content.revision, content_digest: content.content_digest, preview_source: { campaign_id: content.campaign_id, revision: content.revision, sample_first_name: args.sample_first_name }, html: rendered, text: content.text_override ?? template.content.textContent ?? "", preview_only: true, sender: fixtureSender, unsubscribe_url: "https://example.invalid/unsubscribe", binding: typeof args.binding_id === "string" ? { binding_id: args.binding_id } : undefined } };
    }
    case "proposals.list": return { proposals: [] };
    case "sends.list": { const row = seededSendRow(); return { sends: row ? [row] : [] }; }
    case "sends.show": { const row = seededSendRow(); if (!row) missing(); return { send: row, counts: row.counts, deliveries: [{ send_id: row.send_id, customer_id: "ada", email: "a***@example.invalid", state: "accepted", attempts: 1, smtp_code: 250 }, { send_id: row.send_id, customer_id: "lee", email: "l***@example.invalid", state: "suppressed", attempts: 0, reason: "unsubscribed" }, ...(params.get("sends") === "partial" ? [{ send_id: row.send_id, customer_id: "kim", email: "k***@example.invalid", state: "failed", attempts: 1, smtp_code: 550, reason: "Mailbox not found" }] : [])], delivery_claim: "smtp-acceptance-only" }; }
    case "sender-bindings.list": return { bindings: fixtureSenderBindings };
    case "exclusions.list": return { exclusions: [] };
    case "suppressions.list": return { suppressions: [] };
    case "smtp.show": return { binding: fixtureSmtpBinding };
    case "audience.show": missing();
    case "records.aggregate": {
      if (args.table === "deals") {
        const groups = new Map<string, { count: number; amount_cents: number }>();
        for (const d of dealRows) {
          const st = typeof d.profile.stage === "string" ? d.profile.stage : "lead";
          const cur = groups.get(st) ?? { count: 0, amount_cents: 0 };
          cur.count += 1;
          cur.amount_cents += typeof d.profile.amount_cents === "number" ? d.profile.amount_cents : 0;
          groups.set(st, cur);
        }
        return {
          groups: [...groups.entries()].map(([stage, v]) => ({ key: { stage }, count: v.count, sums: { amount_cents: v.amount_cents } })),
          total_groups: groups.size,
          truncated: false,
        };
      }
      const source = args.table === "notes" ? noteRows.map((n) => n.profile) : records.map((r) => r.profile);
      return { groups: [{ key: {}, count: source.length, sums: {} }], total_groups: 1, truncated: false };
    }
    case "records.merge": {
      const source = records.find((r) => r.id === args.source_id) ?? missing();
      const target = records.find((r) => r.id === args.target_id) ?? missing();
      if (source.id === target.id) throw new ApiError("Choose two different customers.", 400);
      for (const list of [noteRows, dealRows, taskRows, touchpointRows]) {
        for (const item of list) {
          if ((item.profile as { customer_id?: unknown }).customer_id === source.id) {
            (item.profile as { customer_id: string }).customer_id = target.id;
            item.revision += 1;
          }
        }
      }
      const overrides = (args.overrides && typeof args.overrides === "object" ? args.overrides : {}) as Record<string, unknown>;
      target.profile = {
        ...target.profile,
        ...(typeof overrides.display_name === "string" ? { display_name: overrides.display_name } : {}),
        ...(overrides.email !== undefined ? { email: overrides.email as string | null } : { email: target.profile.email ?? source.profile.email }),
        ...(overrides.phone !== undefined ? { phone: overrides.phone as string | null } : { phone: target.profile.phone ?? source.profile.phone }),
        tags: [...new Set([...target.profile.tags, ...source.profile.tags])].slice(0, 16),
      };
      target.revision += 1;
      records.splice(records.indexOf(source), 1);
      return { record: target, merged_source_id: source.id, reparented: { notes: 0, deals: 0, tasks: 0, touchpoints: 0 } };
    }
    case "records.csv.preview": {
      const csvText = typeof args.csv_text === "string" ? args.csv_text : "";
      if (!csvText.trim()) throw new ApiError("CSV content cannot be empty.", 400, { code: "validation_failed" });
      if (new TextEncoder().encode(csvText).byteLength > 120 * 1024) {
        throw new ApiError("CSV exceeds the 120 KB limit.", 413, { code: "payload_too_large" });
      }
      const parseLine = (line: string): string[] => {
        const out: string[] = [];
        let cur = "";
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i]!;
          if (quoted) {
            if (ch === '"' && line[i + 1] === '"') {
              cur += '"';
              i += 1;
            } else if (ch === '"') quoted = false;
            else cur += ch;
          } else if (ch === '"') quoted = true;
          else if (ch === ",") {
            out.push(cur);
            cur = "";
          } else cur += ch;
        }
        out.push(cur);
        return out;
      };
      const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
      const headers = lines[0] ? parseLine(lines[0]).map((h) => h.trim()) : [];
      const aliases: Record<string, string> = {
        display_name: "display_name", name: "display_name", full_name: "display_name", customer_name: "display_name",
        email: "email", email_address: "email", e_mail: "email",
        phone: "phone", phone_number: "phone", mobile: "phone", telephone: "phone", tel: "phone",
        tags: "tags", tag: "tags", labels: "tags", label: "tags",
        source: "source", lead_source: "source", origin: "source",
        customer_type: "customer_type", type: "customer_type",
        website: "website", url: "website", homepage: "website",
      };
      const consentHeaders = new Set(["consent", "email_consent", "consent_email", "sms_consent", "consent_sms", "opt_in", "marketing_consent"]);
      const mapped_headers: string[] = [];
      const unmapped_headers: string[] = [];
      const colFields = headers.map((h) => {
        const key = h.toLowerCase().replace(/[\s-]+/g, "_");
        const canonical = aliases[key];
        if (canonical) { mapped_headers.push(canonical); return canonical; }
        unmapped_headers.push(h);
        return null;
      });
      const warnings: string[] = [];
      if (headers.some((h) => consentHeaders.has(h.toLowerCase().replace(/[\s-]+/g, "_")))) {
        warnings.push("Consent columns were ignored; imported customers default to email: unknown, sms: unknown.");
      }
      const existingByEmail = new Map<string, { id: string; revision: number }>();
      for (const r of records) {
        if (typeof r.profile.email === "string" && r.profile.email.trim()) {
          existingByEmail.set(r.profile.email.trim().toLowerCase(), { id: r.id, revision: r.revision });
        }
      }
      const seenInCsv = new Map<string, number>();
      const rows: Array<Record<string, unknown>> = [];
      const batch_items: Array<{ record_id: string; profile: Record<string, unknown> }> = [];
      let dupExisting = 0; let dupInCsv = 0; let invalid = 0;
      for (let i = 1; i < Math.min(lines.length, 201); i += 1) {
        const cells = parseLine(lines[i]!);
        const rec: Record<string, string> = {};
        colFields.forEach((field, idx) => {
          if (field && rec[field] === undefined) rec[field] = (cells[idx] ?? "").trim();
        });
        const displayName = rec.display_name || null;
        const email = rec.email ? rec.email.toLowerCase() : null;
        const errors: string[] = [];
        if (!displayName) errors.push("display_name is required.");
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("email must be a valid email address.");
        if (errors.length > 0) {
          invalid += 1;
          rows.push({ row_number: i, status: "invalid", display_name: displayName, email, errors });
          continue;
        }
        const match = email ? existingByEmail.get(email) : undefined;
        if (match) {
          dupExisting += 1;
          rows.push({ row_number: i, status: "duplicate_existing", existing_record_id: match.id, existing_revision: match.revision, display_name: displayName, email, errors: [] });
          continue;
        }
        if (email && seenInCsv.has(email)) {
          dupInCsv += 1;
          rows.push({ row_number: i, status: "duplicate_in_csv", duplicate_of_row: seenInCsv.get(email), display_name: displayName, email, errors: [] });
          continue;
        }
        if (email) seenInCsv.set(email, i);
        const tags = (rec.tags ?? "").split(/[;,]/).map((t) => t.trim()).filter(Boolean);
        const profile = {
          schema: 1,
          display_name: displayName!,
          email,
          phone: rec.phone || null,
          source: rec.source || null,
          customer_type: rec.customer_type === "person" || rec.customer_type === "organization" ? rec.customer_type : null,
          website: rec.website || null,
          tags,
          consent: { email: "unknown", sms: "unknown" },
        };
        const record_id = `imp-fixture-r${i}`;
        batch_items.push({ record_id, profile });
        rows.push({ row_number: i, status: "valid", record_id, display_name: displayName, email, profile, errors: [] });
      }
      return {
        preview_token: "fixture-csv-preview",
        headers,
        mapped_headers,
        unmapped_headers,
        warnings,
        summary: {
          total_rows: rows.length,
          valid_new: batch_items.length,
          duplicate_existing: dupExisting,
          duplicate_in_csv: dupInCsv,
          invalid,
          max_rows: 200,
        },
        rows,
        batch_items,
      };
    }
    case "records.batch": {
      const items = Array.isArray(args.items) ? (args.items as Array<{ record_id: string; profile: unknown; table?: string }>) : [];
      for (const item of items) {
        fixtureCall("records.create", {
          record_id: item.record_id,
          profile: item.profile,
          ...(item.table ? { table: item.table } : {}),
        });
      }
      return { created: items.length };
    }
    default: throw new ApiError("This action needs a live Cadence host. Nothing was sent or approved.", 503, { code: "unavailable" });
  }
}
