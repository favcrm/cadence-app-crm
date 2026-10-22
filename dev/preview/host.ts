import type { Route } from "../../src/bridge/scope";

// Development data only. These receipts are never installation or approval evidence.
const digest = `sha256:${"0".repeat(64)}`;
const installId = "crm-local-fixture";
const records = [
  { id: "ada", name: "Ada Chen", email: "ada@example.invalid", tags: ["vip"], consent: "granted" },
  { id: "sam", name: "Sam Rivera", email: "sam@example.invalid", tags: ["member"], consent: "unknown" },
  { id: "lee", name: "Lee Wong", email: "lee@example.invalid", tags: ["vip"], consent: "denied" },
].map(row => ({
  id: row.id, install_id: installId, context_id: "", kind: "customer", revision: 1, digest,
  profile: { schema: 1, display_name: row.name, email: row.email, tags: row.tags, source: "fixture", consent: { email: row.consent, sms: "unknown" } },
  history: [], consent_history: [],
}));
const segments = [{ id: "vip", revision: 1, name: "VIP customers", predicates: [{ field: "tag", op: "eq", value: "vip" }], digest }];
const contents = [{
  campaign_id: "welcome", name: "Welcome — fixture draft", revision: 1,
  subject: "Welcome to the community", preheader: "A synthetic local-development email.",
  blocks: [{ type: "heading", text: "Welcome" }, { type: "paragraph", text: "This is synthetic preview content. No email can be sent." }],
  content_digest: digest, approval: { revision: null, digest: null, valid: false, scope: "content-only" },
}];
const actions = [
  "records.list", "records.show", "segments.list", "segments.show", "audience.preview",
  "content.list", "content.show", "content.render", "proposals.list", "sends.list",
  "sender-bindings.list", "exclusions.list", "suppressions.list", "smtp.show", "origin.show",
  "audience.show", "screen.route.patch", "screen.preview.show", "screen.preview.clear",
];
const frame = document.querySelector<HTMLIFrameElement>("#crm-frame")!;
const status = document.querySelector<HTMLElement>("#preview-status")!;
const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
let port: MessagePort | null = null;
let route: Route = { section: "customers", view: "list", record_id: null, segment_id: null };
const sections = ["customers", "segments", "campaigns"] as const;
const previews = new Map<string, { node: HTMLIFrameElement; anchor: { x: number; y: number; w: number; h: number } }>();
function positionPreviews() {
  const outer = frame.getBoundingClientRect();
  for (const { node, anchor } of previews.values()) {
    Object.assign(node.style, { position: "fixed", left: `${outer.left + anchor.x}px`, top: `${outer.top + anchor.y}px`, width: `${anchor.w}px`, height: `${anchor.h}px`, minHeight: "0", border: "0", background: "white" });
    node.style.clipPath = `inset(${Math.max(0, -anchor.y)}px ${Math.max(0, anchor.x + anchor.w - outer.width)}px ${Math.max(0, anchor.y + anchor.h - outer.height)}px ${Math.max(0, -anchor.x)}px)`;
  }
}
function clearPreviews() {
  for (const { node } of previews.values()) node.remove();
  previews.clear();
}
function showPreview(args: Record<string, unknown>) {
  const anchor = args.anchor as { x: number; y: number; w: number; h: number };
  if (typeof args.preview_id !== "string" || typeof args.document !== "string" || !anchor || ![anchor.x, anchor.y, anchor.w, anchor.h].every(v => Number.isFinite(v) && Math.abs(v) <= 16384) || anchor.w < 0 || anchor.h < 0) throw new Error("Invalid fixture preview geometry.");
  let preview = previews.get(args.preview_id);
  if (!preview) {
    const node = document.createElement("iframe");
    node.title = "Synthetic email — inert preview";
    node.setAttribute("sandbox", "");
    document.body.append(node);
    preview = { node, anchor };
    previews.set(args.preview_id, preview);
  }
  // No scripts, forms, external resources or live links gain authority here.
  const documentText = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width, initial-scale=1">${args.document}`;
  if (preview.node.srcdoc !== documentText) preview.node.srcdoc = documentText;
  preview.anchor = anchor;
  positionPreviews();
}
window.addEventListener("scroll", positionPreviews);
window.addEventListener("resize", positionPreviews);
function readRoute(): Route {
  const query = new URLSearchParams(location.search);
  const section = query.get("section");
  const record = query.get("record");
  return { section: sections.includes(section as Route["section"]) ? section as Route["section"] : "customers", view: "list", record_id: record && /^[A-Za-z0-9_-]{1,128}$/.test(record) ? record : null, segment_id: null };
}
route = readRoute();
function push() {
  port?.postMessage({
    v: 2, op: "screen", tag: "crm", install_id: installId, digest,
    installation: { install_id: installId, name: "crm", title: "CRM fixtures", version: "development", digest, summary: "Synthetic read-only preview" },
    actions, route, presentation_locale: "en",
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.setAttribute("aria-pressed", String(button.dataset.section === route.section));
}
function navigate(patch: Partial<Route>, replace = false) {
  clearPreviews();
  route = { ...route, ...patch };
  const url = new URL(location.href);
  url.searchParams.set("section", route.section);
  if (route.record_id) url.searchParams.set("record", route.record_id);
  else url.searchParams.delete("record");
  history[replace ? "replaceState" : "pushState"](null, "", url);
  push();
}
function missing(): never { throw new Error("No matching synthetic fixture exists."); }
function read(verb: string, args: Record<string, unknown>): unknown {
  switch (verb) {
    case "records.list": {
      const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
      return { records: records.filter(r => `${r.profile.display_name} ${r.profile.email} ${r.profile.tags.join(" ")}`.toLowerCase().includes(query)), truncated: false, next_cursor: null };
    }
    case "records.show": return { record: records.find(r => r.id === args.record_id) ?? missing() };
    case "segments.list": return { segments };
    case "segments.show": return { segment: segments.find(s => s.id === args.segment_id) ?? missing() };
    case "content.list": return { contents };
    case "content.show": return { content: contents.find(c => c.campaign_id === args.campaign_id) ?? missing() };
    case "content.render": {
      if (args.campaign_id !== "welcome") missing();
      return { render: { revision: 1, content_digest: digest, html: "<h1>Welcome</h1><p>Synthetic preview only. No email can be sent.</p>", text: "Welcome. Synthetic preview only. No email can be sent.", preview_only: true, sender: { name: "Fixture sender", address: "preview@example.invalid" }, unsubscribe_url: "https://example.invalid/unsubscribe" } };
    }
    case "audience.preview": {
      const base = args.base as { mode?: string; segment_id?: string; customer_ids?: string[] };
      const members = base?.mode === "segment" ? records.filter(r => r.profile.tags.includes("vip")) : base?.mode === "custom" ? records.filter(r => base.customer_ids?.includes(r.id)) : records;
      const eligible = members.filter(r => r.profile.consent.email === "granted");
      return { base_count: members.length, exclusion_count: 0, final_count: eligible.length, final_excluded: { invalid_email: 0, no_consent: members.filter(r => r.profile.consent.email === "unknown").length, unsubscribed: members.filter(r => r.profile.consent.email === "denied").length, suppressed: 0 }, sample: eligible.map(r => ({ id: r.id, display_name: r.profile.display_name })), digest };
    }
    case "proposals.list": return { proposals: [] };
    case "sends.list": return { sends: [] };
    case "sender-bindings.list": return { bindings: [] };
    case "exclusions.list": return { exclusions: [] };
    case "suppressions.list": return { suppressions: [] };
    default: missing();
  }
}
window.addEventListener("message", event => {
  const message = event.data;
  if (event.source !== frame.contentWindow || event.origin !== location.origin || message?.v !== 1 || message.op !== "init" || message.tag !== "crm" || message.bridge_nonce !== nonce || message.generation !== 1 || event.ports.length !== 1) return;
  port?.close();
  const connection = event.ports[0];
  port = connection;
  connection.onmessage = event => {
    const request = event.data;
    if (request?.v === 1 && request.op === "ready") {
      push();
      status.textContent = "Local fixtures connected. Changes and effects are unavailable.";
      return;
    }
    if (request?.v !== 2 || !["call", "slot"].includes(request.op) || typeof request.id !== "string") return;
    const reply = (data: unknown) => connection.postMessage({ v: 2, op: "reply", id: request.id, ok: true, data });
    try {
      if (request.op !== "call" || !actions.includes(request.verb)) throw new Error("Unavailable in the read-only fixture preview; nothing was changed or sent.");
      if (request.verb === "screen.route.patch") {
        const patch = request.args;
        if ((patch.section !== undefined && !sections.includes(patch.section)) || (patch.view !== undefined && patch.view !== "list")) throw new Error("Only read-only browsing is available in this preview.");
        navigate({ ...(patch.section ? { section: patch.section } : {}), ...(patch.record_id !== undefined ? { record_id: patch.record_id } : {}), ...(patch.segment_id !== undefined ? { segment_id: patch.segment_id } : {}) }, patch.replace === true);
        reply({});
      } else if (request.verb === "screen.preview.show") {
        showPreview(request.args);
        reply({});
      } else if (request.verb === "screen.preview.clear") {
        const id = request.args.preview_id;
        previews.get(id)?.node.remove();
        previews.delete(id);
        reply({});
      } else reply(read(request.verb, request.args));
    } catch (error) {
      const refusal = { code: request.verb === "smtp.show" ? "smtp_sender_unbound" : actions.includes(request.verb) ? "not_found" : "unavailable", text: request.verb === "smtp.show" ? "No sender is connected in the synthetic preview." : error instanceof Error ? error.message : "Fixture unavailable" };
      connection.postMessage(request.op === "slot" ? { v: 2, op: "slot-state", id: request.id, state: "refused", refusal } : { v: 2, op: "reply", id: request.id, ok: false, refusal });
    }
  };
  port.start();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.addEventListener("click", () => navigate({ section: button.dataset.section as Route["section"], view: "list", record_id: null, segment_id: null }));
window.addEventListener("popstate", () => { clearPreviews(); route = readRoute(); push(); });
window.addEventListener("pagehide", () => port?.close());
frame.src = `./frame.html?nonce=${nonce}`;
if (import.meta.hot) import.meta.hot.dispose(() => port?.close());
