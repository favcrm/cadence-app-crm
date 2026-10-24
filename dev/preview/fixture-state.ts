import { ApiError } from "@cadence/screen-ui";
import { buildCustomerProfile, formFromProfile } from "../../src/features/crm/customerProfile";
import { checkPredicate, checkSegmentName } from "../../src/features/crm/segmentGrammar";
import { checkCampaignId, checkCampaignName, checkContent, checkContentFields, type CampaignBlock } from "../../src/features/crm/campaignGrammar";

export const fixtureDigest = `sha256:${"0".repeat(64)}`;
export const fixtureInstallId = "crm-local-fixture";
export const fixtureActions = [
  "records.list", "records.show", "records.create", "records.update", "segments.list", "segments.show", "segments.save", "audience.preview",
  "content.list", "content.show", "content.save", "content.clone", "content.render", "proposals.list", "sends.list",
  "sender-bindings.list", "exclusions.list", "suppressions.list", "smtp.show", "origin.show", "audience.show",
  "screen.route.patch", "screen.preview.show", "screen.preview.clear",
];
type Profile = { schema: number; display_name: string; email?: string; phone?: string; tags: string[]; source?: string; consent: { email: string; sms: string } };
type LocalRecord = { id: string; install_id: string; context_id: string; kind: string; revision: number; digest: string; profile: Profile; history: { revision: number; digest: string; actor: string; at: number }[]; consent_history: { revision: number; channel: string; state: string; actor: string; at: number; method?: string; note?: string }[] };
type Predicate = { field: string; op: string; value: string };
type Segment = { id: string; revision: number; name: string; predicates: Predicate[]; digest: string };
type Content = { campaign_id: string; name: string; revision: number; subject: string; preheader: string; blocks: CampaignBlock[]; mode: "blocks" | "html"; html: string | null; text_override: string | null; content_digest: string; approval: { revision: null; digest: null; valid: false; scope: string } };
const records: LocalRecord[] = [
  { id: "ada", name: "Ada Chen", email: "ada@example.invalid", tags: ["vip"], consent: "granted" },
  { id: "sam", name: "Sam Rivera", email: "sam@example.invalid", tags: ["member"], consent: "unknown" },
  { id: "lee", name: "Lee Wong", email: "lee@example.invalid", tags: ["vip"], consent: "denied" },
].map(row => ({ id: row.id, install_id: fixtureInstallId, context_id: "", kind: "customer", revision: 1, digest: fixtureDigest, profile: { schema: 1, display_name: row.name, email: row.email, tags: row.tags, source: "fixture", consent: { email: row.consent, sms: "unknown" } }, history: [], consent_history: [] }));
const segments: Segment[] = [{ id: "vip", revision: 1, name: "VIP customers", predicates: [{ field: "tag", op: "eq", value: "vip" }], digest: fixtureDigest }];
const fixtureSender = { name: "Fixture sender", address: "preview@example.invalid" };
const fixtureSmtpBinding = { connection_id: "fixture-smtp", auth_revision: 1, link_revision: 1, state: "live", digest: fixtureDigest, sender: fixtureSender, transport_kind: "smtp" };
const fixtureSenderBindings = [{ binding_id: "fixture-sender", revision: 1, digest: fixtureDigest, sender: fixtureSender, unsubscribe_base: "https://example.invalid/unsubscribe" }];
const contents: Content[] = [{ campaign_id: "welcome", name: "Welcome — fixture draft", revision: 1, subject: "Welcome to the community", preheader: "A synthetic local-development email.", blocks: [{ type: "heading", text: "Welcome" }, { type: "paragraph", text: "This is synthetic preview content. No email can be sent." }], mode: "blocks", html: null, text_override: null, content_digest: fixtureDigest, approval: { revision: null, digest: null, valid: false, scope: "content-only" } }];

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
    if (!allowed[element.tagName]) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) if (!["style", "title", "colspan", "rowspan"].includes(attribute.name)) element.removeAttribute(attribute.name);
  }
  return template.innerHTML;
}
export function fixtureCall(verb: string, args: Record<string, unknown>): unknown {
  switch (verb) {
    case "records.list": {
      const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
      const rows = records.filter(r => `${r.profile.display_name} ${r.profile.email ?? ""} ${r.profile.tags.join(" ")}`.toLowerCase().includes(query));
      const start = args.cursor === undefined ? 0 : rows.findIndex(row => row.id === args.cursor) + 1;
      if (args.cursor !== undefined && start === 0) missing();
      const limit = typeof args.limit === "number" ? Math.max(1, Math.min(100, args.limit)) : 20;
      const page = rows.slice(start, start + limit);
      const truncated = start + page.length < rows.length;
      return { records: page, total: rows.length, truncated, next_cursor: truncated ? page.at(-1)!.id : null };
    }
    case "records.show": return { record: records.find(r => r.id === args.record_id) ?? missing() };
    case "records.create":
    case "records.update": {
      requireId(args.record_id);
      const existing = records.find(r => r.id === args.record_id);
      if (verb === "records.create" && existing) throw new ApiError("That local customer already exists.", 409, { code: "conflict" });
      if (verb === "records.update" && !existing) missing();
      requireRevision(existing, args.expected_revision);
      const profile = buildCustomerProfile(formFromProfile(args.profile)) as Profile;
      const revision = (existing?.revision ?? 0) + 1;
      const at = Math.floor(Date.now() / 1000);
      const history = [...(existing?.history ?? []), { revision, digest: fixtureDigest, actor: "local-preview", at }];
      const consent_history = [...(existing?.consent_history ?? [])];
      const provenance = args.consent_provenance as { method?: string; note?: string } | undefined;
      for (const channel of ["email", "sms"] as const) if (profile.consent[channel] !== existing?.profile.consent[channel]) consent_history.push({ revision, channel, state: profile.consent[channel], actor: "local-preview", at, ...(typeof provenance?.method === "string" ? { method: provenance.method } : {}), ...(typeof provenance?.note === "string" ? { note: provenance.note } : {}) });
      const record = { id: args.record_id, install_id: fixtureInstallId, context_id: "", kind: "customer", revision, digest: fixtureDigest, profile, history, consent_history };
      if (existing) records.splice(records.indexOf(existing), 1, record); else records.push(record);
      changed(existing ? "Customer updated locally." : "Customer created locally.");
      return { record };
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
      if (base?.mode === "segment") members = records.filter(r => matches(r, (segments.find(s => s.id === base.segment_id) ?? missing()).predicates));
      else if (base?.mode === "custom") members = records.filter(r => base.customer_ids?.includes(r.id));
      else if (base?.mode !== "all") throw new ApiError("Select a local audience.", 400);
      const invalid = members.filter(r => !r.profile.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.profile.email));
      const valid = members.filter(r => !invalid.includes(r));
      const eligible = valid.filter(r => r.profile.consent.email === "granted");
      return { base_count: members.length, exclusion_count: 0, final_count: eligible.length, final_excluded: { invalid_email: invalid.length, no_consent: valid.filter(r => r.profile.consent.email === "unknown").length, unsubscribed: valid.filter(r => r.profile.consent.email === "denied").length, suppressed: 0 }, sample: eligible.slice(0, 20).map(r => ({ id: r.id, display_name: r.profile.display_name })), digest: fixtureDigest };
    }
    case "content.list": return { contents };
    case "content.show": return { content: contents.find(c => c.campaign_id === args.campaign_id) ?? missing() };
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
      }
      const content: Content = { campaign_id: args.campaign_id, name, revision: (existing?.revision ?? 0) + 1, subject: args.subject, preheader, blocks: blocks ?? [], mode: blocks ? "blocks" : "html", html: typeof args.html === "string" ? inertHtml(args.html) : null, text_override: typeof args.text === "string" ? args.text : null, content_digest: fixtureDigest, approval: { revision: null, digest: null, valid: false, scope: "content-only" } };
      if (existing) contents.splice(contents.indexOf(existing), 1, content); else contents.push(content);
      changed(existing ? "Campaign draft updated locally." : "Campaign draft created locally.");
      return { content };
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
      if (args.binding_id !== undefined && !fixtureSenderBindings.some(binding => binding.binding_id === args.binding_id)) throw new ApiError("No matching local sender preview exists.", 404, { code: "not_found" });
      const html = content.mode === "html" ? content.html! : content.blocks.map(block => block.type === "button" ? `<p><strong>${escapeHtml(block.label)}</strong></p>` : `<${block.type === "heading" ? "h1" : "p"}>${escapeHtml(block.text)}</${block.type === "heading" ? "h1" : "p"}>`).join("");
      const rendered = html.replace(/\{\{first_name\|([^}]+)\}\}/g, (_match, fallback: string) => escapeHtml(typeof args.sample_first_name === "string" && args.sample_first_name ? args.sample_first_name : fallback));
      const template = document.createElement("template"); template.innerHTML = rendered;
      return { render: { revision: content.revision, content_digest: content.content_digest, html: rendered, text: content.text_override ?? template.content.textContent ?? "", preview_only: true, sender: fixtureSender, unsubscribe_url: "https://example.invalid/unsubscribe", binding: typeof args.binding_id === "string" ? { binding_id: args.binding_id } : undefined } };
    }
    case "proposals.list": return { proposals: [] };
    case "sends.list": return { sends: [] };
    case "sender-bindings.list": return { bindings: fixtureSenderBindings };
    case "exclusions.list": return { exclusions: [] };
    case "suppressions.list": return { suppressions: [] };
    case "smtp.show": return { binding: fixtureSmtpBinding };
    case "audience.show": missing();
    default: throw new ApiError("This action needs a live Cadence host. Nothing was sent or approved.", 503, { code: "unavailable" });
  }
}
