import { ApiError } from "@cadence/screen-ui";
import { fixtureCall, inertHtml, fixtureDigest as digest, fixtureInstallId as installId, fixtureActions } from "./fixture-state";
import "./shell";
import type { Route } from "../../src/bridge/scope";

const DRAWER_OPEN = "screen.drawer.open";
const DRAWER_CLOSE = "screen.drawer.close";
const SURFACES_V1 = "screen-surfaces.v1";
const SURFACE = /^[a-z0-9_-]{1,64}$/;
const sections = ["customers", "segments", "campaigns"] as const;
const unavailable = () => new ApiError("Unavailable offline. No live data was changed, sent or approved.", 503, { code: "unavailable" });

const frame = document.querySelector<HTMLIFrameElement>("#crm-frame")!;
const status = document.querySelector<HTMLElement>("#preview-status")!;
const board = document.querySelector<HTMLElement>("#preview-board")!;
const drawer = document.querySelector<HTMLElement>("#screen-drawer")!;
const drawerSlot = document.querySelector<HTMLElement>("#screen-drawer-slot")!;
const drawerClose = document.querySelector<HTMLButtonElement>("#screen-drawer-close")!;
const scrim = document.querySelector<HTMLButtonElement>("#screen-scrim")!;
const previews = new Map<string, { node: HTMLIFrameElement; anchor: { x: number; y: number; w: number; h: number } }>();

type Role = "primary" | "drawer";

/**
 * Each frame has its own MessagePort bridge nonce and its own role. The
 * synthetic host never forwards a request between them: both talk to the one
 * shared browser-memory fixture store, and both are told the same verified
 * route. No parent_action_token or native parent proof is simulated here —
 * this is a local presentation harness, not an authorization authority.
 */
interface Conn {
  role: Role;
  nonce: string;
  frame: HTMLIFrameElement;
  port: MessagePort | null;
  optedIn: boolean;
}
const connections = new Map<Window, Conn>();
let route: Route = { section: "customers", view: "list", record_id: null, segment_id: null };
let drawerOpen = false;
let drawerReturnFocus: HTMLElement | null = null;

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The verbs one connection may use: fixture records operations, plus host
 *  UI verbs only for a peer that opted into `screen-surfaces.v1`. A drawer
 *  child is told only close; it can never open another overlay. */
function actionsFor(conn: Conn): string[] {
  if (!conn.optedIn) return fixtureActions;
  return conn.role === "primary" ? [...fixtureActions, DRAWER_OPEN, DRAWER_CLOSE] : [...fixtureActions, DRAWER_CLOSE];
}

function sendSurface(conn: Conn, modal: boolean) {
  if (!conn.optedIn) return;
  conn.port?.postMessage({ v: 1, op: "surface", role: conn.role, modal });
}

function sendProjection(conn: Conn) {
  conn.port?.postMessage({
    v: 2, op: "screen", tag: "crm", install_id: installId, digest,
    installation: { install_id: installId, name: "crm", title: "CRM fixtures", version: "development", digest, summary: "Local browser-memory fixtures" },
    actions: actionsFor(conn), route, presentation_locale: "en",
  });
}

function syncChrome() {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.setAttribute("aria-pressed", String(button.dataset.section === route.section));
  window.dispatchEvent(new CustomEvent("preview-route", { detail: route.section }));
}

function pushAll() {
  sendProjection(primary);
  if (child) sendProjection(child);
  syncChrome();
}

const primary: Conn = { role: "primary", nonce: randomNonce(), frame, port: null, optedIn: false };
connections.set(frame.contentWindow!, primary);
let child: Conn | null = null;

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

/** Open the one independent child overlay. The primary frame is never
 *  reparented, resized, hidden or reloaded: only this separate fixed panel
 *  and its child frame appear. The child is mounted once per open and stays
 *  mounted across detail-to-detail route updates until close. */
function openDrawerSurface() {
  if (drawerOpen) return;
  drawerOpen = true;
  const nonce = randomNonce();
  const node = document.createElement("iframe");
  node.id = "crm-drawer-frame";
  node.name = "crm-drawer-frame";
  node.title = "CRM detail — local fixtures";
  drawerSlot.append(node);
  const conn: Conn = { role: "drawer", nonce, frame: node, port: null, optedIn: false };
  child = conn;
  connections.set(node.contentWindow!, conn);
  node.src = `./frame.html?nonce=${nonce}`;
  drawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : frame;
  drawer.hidden = false;
  scrim.hidden = false;
  board.inert = true;
  // Initial role state precedes the child's first projection: a drawer never
  // flashes list content, and the primary knows its overlay is modal.
  sendSurface(primary, true);
  drawerClose.focus();
  window.dispatchEvent(new Event("preview-layout"));
}

/** Close releases the child frame and its port only. The primary frame keeps
 *  running throughout; the trusted close works even if the child never
 *  finishes booting or its frame fails. */
function closeDrawerSurface() {
  if (!drawerOpen) return;
  drawerOpen = false;
  drawer.hidden = true;
  scrim.hidden = true;
  board.inert = false;
  const back = drawerReturnFocus && drawerReturnFocus.isConnected ? drawerReturnFocus : frame;
  drawerReturnFocus = null;
  if (child) {
    const leaving = child;
    child = null;
    leaving.port?.close();
    const win = leaving.frame.contentWindow;
    if (win) connections.delete(win);
    leaving.frame.remove();
  }
  // Restore host focus to the primary frame/opener even when the click that
  // closed the overlay is the scrim or the trusted close itself.
  back.focus();
  sendSurface(primary, false);
  window.dispatchEvent(new Event("preview-layout"));
}

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
  // Leaving a presentable detail retires the host overlay with the route it
  // belonged to; another Customer/Segment detail keeps the child frame open.
  // The projection is posted first so the app never mistakes this for a
  // host-driven dismissal of the destination detail.
  if (route.record_id === null || route.section === "campaigns") closeDrawerSurface();
}

function reply(conn: Conn, request: { op: string; id: string }, data: unknown) {
  conn.port?.postMessage(request.op === "slot"
    ? { v: 2, op: "slot-state", id: request.id, state: "done", data }
    : { v: 2, op: "reply", id: request.id, ok: true, data });
}

function handle(conn: Conn, request: Record<string, unknown>) {
  if (request?.v === 1 && request.op === "ready") {
    conn.optedIn = Array.isArray(request.accepts) && request.accepts.includes(SURFACES_V1);
    if (conn.role === "drawer" && !conn.optedIn) { closeDrawerSurface(); return; }
    // Role state precedes the first projection.
    sendSurface(conn, conn.role === "primary" ? drawerOpen : false);
    sendProjection(conn);
    if (conn.role === "primary") status.textContent = "Local fixture data · editing enabled";
    return;
  }
  if (request?.v !== 2 || !["call", "slot"].includes(request.op as string) || typeof request.id !== "string") return;
  const call = request as { op: "call" | "slot"; id: string; verb: string; args: Record<string, unknown> };
  try {
    if (call.op !== "call") throw unavailable();
    if (call.verb === DRAWER_OPEN || call.verb === DRAWER_CLOSE) {
      // Host-local presentation UI, never a fixture or production operation.
      if (!conn.optedIn) throw new ApiError("This preview was not negotiated for the host overlay.", 403, { code: "forbidden" });
      const args = call.args;
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new ApiError("Invalid local drawer request.", 400, { code: "bad_args" });
      if (call.verb === DRAWER_OPEN) {
        if (conn.role !== "primary") throw new ApiError("A detail frame cannot open another overlay.", 403, { code: "forbidden" });
        if (Object.keys(args).length !== 1 || typeof args.surface !== "string" || !SURFACE.test(args.surface)) throw new ApiError("Invalid local drawer surface.", 400, { code: "bad_args" });
        if (route.record_id === null || route.section === "campaigns") throw new ApiError("No local detail is selected.", 400, { code: "bad_args" });
        openDrawerSurface();
        reply(conn, call, { mode: "drawer", surface: args.surface });
      } else {
        if (Object.keys(args).length !== 0) throw new ApiError("Invalid local drawer close.", 400, { code: "bad_args" });
        reply(conn, call, { mode: "outlet" });
        closeDrawerSurface();
      }
      return;
    }
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
  const conn = connections.get(event.source as Window);
  // Each frame proves its own nonce: a child can never speak as the primary.
  if (!conn || message.bridge_nonce !== conn.nonce) return;
  const connection = event.ports[0];
  conn.port?.close();
  conn.port = connection;
  conn.optedIn = false;
  connection.onmessage = e => {
    try { handle(conn, e.data); }
    catch {
      // A malformed message from a frame retires only that frame's bridge.
      conn.port?.close();
      conn.port = null;
      if (conn.role === "drawer") closeDrawerSurface();
    }
  };
  connection.start();
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.addEventListener("click", () => navigate({ section: button.dataset.section as Route["section"], view: "list", record_id: null, segment_id: null }));
window.addEventListener("popstate", () => {
  clearPreviews();
  route = readRoute();
  pushAll();
  // History can land on another Customer/Segment detail (e.g. Duplicate then
  // Back): that destination keeps the overlay. Only a route without a
  // presentable detail retires it.
  if (route.record_id === null || route.section === "campaigns") closeDrawerSurface();
});
window.addEventListener("pagehide", () => { primary.port?.close(); child?.port?.close(); });
scrim.addEventListener("click", () => closeDrawerSurface());
drawerClose.addEventListener("click", () => closeDrawerSurface());
window.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !drawerOpen) return;
  // The preview's own navigation menu closes first, mirroring the app's
  // menu → edit → drawer Escape precedence.
  if (board.dataset.sidebarOpen === "true") return;
  closeDrawerSurface();
});
frame.src = `./frame.html?nonce=${primary.nonce}`;
if (import.meta.hot) import.meta.hot.dispose(() => { frameResize.disconnect(); primary.port?.close(); child?.port?.close(); });
