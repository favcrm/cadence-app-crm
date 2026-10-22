import { ApiError } from "@cadence/screen-ui";
import { fixtureCall, fixtureDigest as digest, fixtureInstallId as installId, fixtureActions as actions } from "./fixture-state";
import "./shell";
import type { Route } from "../../src/bridge/scope";

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
  const documentText = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width, initial-scale=1">${args.document}`;
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
function push() {
  port?.postMessage({
    v: 2, op: "screen", tag: "crm", install_id: installId, digest,
    installation: { install_id: installId, name: "crm", title: "CRM fixtures", version: "development", digest, summary: "Local browser-memory fixtures" },
    actions, route, presentation_locale: "en",
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.setAttribute("aria-pressed", String(button.dataset.section === route.section));
  window.dispatchEvent(new CustomEvent("preview-route", { detail: route.section }));
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
  push();
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
      status.textContent = "Local fixture data · editing enabled";
      return;
    }
    if (request?.v !== 2 || !["call", "slot"].includes(request.op) || typeof request.id !== "string") return;
    const reply = (data: unknown) => connection.postMessage({ v: 2, op: "reply", id: request.id, ok: true, data });
    try {
      if (request.op !== "call" || !actions.includes(request.verb)) throw new ApiError("Unavailable offline. No live data was changed, sent or approved.", 503, { code: "unavailable" });
      if (request.verb === "screen.route.patch") {
        const patch = request.args;
        if ((patch.section !== undefined && !sections.includes(patch.section)) || (patch.view !== undefined && !["list", "new"].includes(patch.view)) || ["record_id", "segment_id"].some(key => patch[key] !== undefined && patch[key] !== null && (typeof patch[key] !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(patch[key])))) throw new ApiError("Invalid local route.", 400);
        navigate({ ...(patch.section ? { section: patch.section } : {}), ...(patch.view ? { view: patch.view } : {}), ...(patch.record_id !== undefined ? { record_id: patch.record_id } : {}), ...(patch.segment_id !== undefined ? { segment_id: patch.segment_id } : {}) }, patch.replace === true);
        reply({});
      } else if (request.verb === "screen.preview.show") {
        showPreview(request.args);
        reply({});
      } else if (request.verb === "screen.preview.clear") {
        const id = request.args.preview_id;
        previews.get(id)?.node.remove();
        previews.delete(id);
        reply({});
      } else reply(fixtureCall(request.verb, request.args));
    } catch (error) {
      const refusal = { code: error instanceof ApiError ? error.code ?? "invalid_body" : "invalid_body", text: error instanceof Error ? error.message : "Local fixture action refused." };
      connection.postMessage(request.op === "slot" ? { v: 2, op: "slot-state", id: request.id, state: "refused", refusal } : { v: 2, op: "reply", id: request.id, ok: false, refusal });
    }
  };
  port.start();
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-section]")) button.addEventListener("click", () => navigate({ section: button.dataset.section as Route["section"], view: "list", record_id: null, segment_id: null }));
window.addEventListener("popstate", () => { clearPreviews(); route = readRoute(); push(); });
window.addEventListener("pagehide", () => port?.close());
frame.src = `./frame.html?nonce=${nonce}`;
if (import.meta.hot) import.meta.hot.dispose(() => { frameResize.disconnect(); port?.close(); });
