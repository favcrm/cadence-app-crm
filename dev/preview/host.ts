import { ApiError } from "@cadence/screen-ui";
import { fixtureCall, inertHtml, fixtureDigest as digest, fixtureInstallId as installId, fixtureActions } from "./fixture-state";
import "./shell";
import type { Route } from "../../src/bridge/scope";

const sections = ["customers", "segments", "campaigns"] as const;
const unavailable = () => new ApiError("Unavailable offline. No live data was changed, sent or approved.", 503, { code: "unavailable" });

const frame = document.querySelector<HTMLIFrameElement>("#crm-frame")!;
const status = document.querySelector<HTMLElement>("#preview-status")!;
const previews = new Map<string, { node: HTMLIFrameElement; anchor: { x: number; y: number; w: number; h: number } }>();

/**
 * The one CRM frame proves its own MessagePort bridge nonce. No
 * parent_action_token or native parent proof is simulated here — this is a
 * local presentation harness, not an authorization authority.
 */
interface Conn {
  nonce: string;
  frame: HTMLIFrameElement;
  port: MessagePort | null;
}
let route: Route = { section: "customers", view: "list", record_id: null, segment_id: null };

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sendProjection(conn: Conn) {
  conn.port?.postMessage({
    v: 2, op: "screen", tag: "crm", install_id: installId, digest,
    installation: { install_id: installId, name: "crm", title: "CRM fixtures", version: "development", digest, summary: "Local browser-memory fixtures" },
    actions: fixtureActions, route, presentation_locale: "en",
  });
}

function syncChrome() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.setAttribute("aria-pressed", String(button.dataset.section === route.section));
  window.dispatchEvent(new CustomEvent("preview-route", { detail: route.section }));
}

function pushAll() {
  sendProjection(primary);
  syncChrome();
}

const primary: Conn = { nonce: randomNonce(), frame, port: null };

function positionPreviews() {
  const outer = frame.getBoundingClientRect();
  for (const { node, anchor } of previews.values()) {
    node.hidden = frame.getClientRects().length === 0;
    Object.assign(node.style, { position: "fixed", left: `${outer.left + anchor.x}px`, top: `${outer.top + anchor.y}px`, width: `${anchor.w}px`, height: `${anchor.h}px`, minHeight: "0", border: "0", background: "white", zIndex: "1" });
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
  const documentText = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width, initial-scale=1">${inertHtml(args.document)}`;
  if (preview.node.srcdoc !== documentText) preview.node.srcdoc = documentText;
  preview.anchor = anchor;
  positionPreviews();
}
window.addEventListener("scroll", positionPreviews);
window.addEventListener("resize", positionPreviews);
window.addEventListener("preview-layout", positionPreviews);
const frameResize = new ResizeObserver(positionPreviews);
frameResize.observe(frame);

function readRoute(): Route {
  const query = new URLSearchParams(location.search);
  const section = query.get("section");
  const record = query.get("record");
  const segment = query.get("segment");
  return { section: sections.includes(section as Route["section"]) ? section as Route["section"] : "customers", view: query.get("view") === "new" ? "new" : "list", record_id: record && /^[A-Za-z0-9_-]{1,128}$/.test(record) ? record : null, segment_id: segment && /^[A-Za-z0-9_-]{1,128}$/.test(segment) ? segment : null };
}
route = readRoute();
syncChrome();

function navigate(patch: Partial<Route>, replace = false) {
  clearPreviews();
  route = { ...route, ...patch };
  const url = new URL(location.href);
  url.searchParams.set("section", route.section);
  if (route.view === "new") url.searchParams.set("view", "new");
  else url.searchParams.delete("view");
  if (route.segment_id) url.searchParams.set("segment", route.segment_id);
  else url.searchParams.delete("segment");
  if (route.record_id) url.searchParams.set("record", route.record_id);
  else url.searchParams.delete("record");
  history[replace ? "replaceState" : "pushState"](null, "", url);
  pushAll();
}

function reply(conn: Conn, request: { op: string; id: string }, data: unknown) {
  conn.port?.postMessage(request.op === "slot"
    ? { v: 2, op: "slot-state", id: request.id, state: "done", data }
    : { v: 2, op: "reply", id: request.id, ok: true, data });
}

function handle(conn: Conn, request: Record<string, unknown>) {
  if (request?.v === 1 && request.op === "ready") {
    sendProjection(conn);
    status.textContent = "Local fixture data · editing enabled";
    return;
  }
  if (request?.v !== 2 || !["call", "slot"].includes(request.op as string) || typeof request.id !== "string") return;
  const call = request as { op: "call" | "slot"; id: string; verb: string; args: Record<string, unknown> };
  try {
    if (call.op !== "call") throw unavailable();
    if (!fixtureActions.includes(call.verb)) throw unavailable();
    if (call.verb === "screen.route.patch") {
      const patch = call.args;
      if ((patch.section !== undefined && !sections.includes(patch.section as Route["section"])) || (patch.view !== undefined && !["list", "new"].includes(patch.view as string)) || ["record_id", "segment_id"].some(key => patch[key] !== undefined && patch[key] !== null && (typeof patch[key] !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(patch[key] as string)))) throw new ApiError("Invalid local route.", 400);
      navigate({ ...(patch.section ? { section: patch.section as Route["section"] } : {}), ...(patch.view ? { view: patch.view as Route["view"] } : {}), ...(patch.record_id !== undefined ? { record_id: patch.record_id as string | null } : {}), ...(patch.segment_id !== undefined ? { segment_id: patch.segment_id as string | null } : {}) }, patch.replace === true);
      reply(conn, call, {});
    } else if (call.verb === "screen.preview.show") {
      showPreview(call.args);
      reply(conn, call, {});
    } else if (call.verb === "screen.preview.clear") {
      const id = call.args.preview_id;
      if (typeof id === "string") {
        previews.get(id)?.node.remove();
        previews.delete(id);
      }
      reply(conn, call, {});
    } else reply(conn, call, fixtureCall(call.verb, call.args));
  } catch (error) {
    const refusal = { code: error instanceof ApiError ? error.code ?? "invalid_body" : "invalid_body", text: error instanceof Error ? error.message : "Local fixture action refused." };
    conn.port?.postMessage(call.op === "slot" ? { v: 2, op: "slot-state", id: call.id, state: "refused", refusal } : { v: 2, op: "reply", id: call.id, ok: false, refusal });
  }
}

window.addEventListener("message", event => {
  if (event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.v !== 1 || message.op !== "init" || message.tag !== "crm" || typeof message.bridge_nonce !== "string" || message.generation !== 1 || event.ports.length !== 1) return;
  const conn = primary;
  if (event.source !== frame.contentWindow || message.bridge_nonce !== conn.nonce) return;
  const connection = event.ports[0];
  conn.port?.close();
  conn.port = connection;
  connection.onmessage = e => {
    try { handle(conn, e.data); }
    catch {
      // A malformed message retires the frame's bridge.
      conn.port?.close();
      conn.port = null;
    }
  };
  connection.start();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.addEventListener("click", () => navigate({ section: button.dataset.section as Route["section"], view: "list", record_id: null, segment_id: null }));
window.addEventListener("popstate", () => {
  clearPreviews();
  route = readRoute();
  pushAll();
});
window.addEventListener("pagehide", () => { primary.port?.close(); });
frame.src = `./frame.html?nonce=${primary.nonce}`;
if (import.meta.hot) import.meta.hot.dispose(() => { frameResize.disconnect(); primary.port?.close(); });
