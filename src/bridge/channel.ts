import { ApiError } from "@cadence/screen-ui";
import { acceptPush,clearScope,getScope } from "./scope";
import { OPERATIONS } from "./services";

type CampaignLeaveState = { publish: (unsaved: boolean) => void; release: () => void };
type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout>; kind: "call" | "slot"; large: boolean };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function exact(v: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(v).every(k => keys.includes(k)); }
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const invalid = () => new ApiError("The CRM bridge refused an invalid or retired response", 502);
// Refusal codes, not text heuristics, preserve native CAS/absent/access UI paths.
function refusal(v: unknown): ApiError {
  if (!object(v) || !exact(v, ["code", "text"]) || typeof v.code !== "string" || typeof v.text !== "string" || v.text.length > 2000) throw invalid();
  const status = ({ not_found: 404, missing: 404, stale_revision: 409, conflict: 409, unauthorized: 401, forbidden: 403, unavailable: 503 } as Record<string, number>)[v.code] ?? 400;
  return new ApiError(v.text, status, { code: v.code });
}
class Channel {
  private port: MessagePort | null = null;
  private retired = false;
  private leaveOwner: symbol | null = null;
  private serial = 0;
  private pending = new Map<string, Pending>();
  start(): void {
    if (this.port || this.retired) return;
    const node = document.getElementById("cadence-screen-boot");
    if (!node?.textContent || node.textContent.length > 2048) throw invalid();
    const boot: unknown = JSON.parse(node.textContent);
    if (!object(boot) || !exact(boot, ["tag", "bridge_nonce", "generation", "parent_origin"]) || boot.tag !== "crm" || typeof boot.bridge_nonce !== "string" || !/^[a-f0-9]{64}$/.test(boot.bridge_nonce) || !Number.isSafeInteger(boot.generation) || (boot.generation as number) < 0 || typeof boot.parent_origin !== "string") throw invalid();
    const origin = new URL(boot.parent_origin);
    if (origin.origin !== boot.parent_origin || !["http:", "https:"].includes(origin.protocol) || window.parent === window) throw invalid();
    const pair = new MessageChannel();
    this.port = pair.port1;
    pair.port1.onmessage = e => {
      try { this.receive(e.data); } catch { this.retire(invalid()); }
    };
    pair.port1.onmessageerror = () => this.retire(invalid());
    pair.port1.start();
    window.parent.postMessage({ v: 1, op: "init", tag: boot.tag, bridge_nonce: boot.bridge_nonce, generation: boot.generation }, boot.parent_origin, [pair.port2]);
    pair.port1.postMessage({ v: 1, op: "ready", accepts: ["screen.v2", "screen-records.v1", "crm-locale.v1"] });
    window.addEventListener("pagehide", () => this.retire(new ApiError("CRM mount retired", 403)), { once: true });
  }
  /** A live editor owns only a boolean warning hint, not a navigation request. */
  ownCampaignLeaveState(): CampaignLeaveState | null {
    const port = this.port;
    const scope = getScope();
    // A validated scope PUSH must precede any warning publication.
    if (!port || this.retired || !scope) return null;
    const owner = Symbol();
    this.leaveOwner = owner;
    const live = () => {
      const current = getScope();
      return !this.retired && this.port === port && this.leaveOwner === owner && !!current &&
        current.scope.installId === scope.scope.installId && current.scope.contextId === scope.scope.contextId &&
        current.digest === scope.digest;
    };
    const publish = (unsaved: boolean) => {
      if (typeof unsaved !== "boolean" || !live()) return;
      try { port.postMessage({ v: 1, op: "state", data: JSON.stringify({ contract: "crm-leave.v1", unsaved }) }); }
      catch { /* Best effort; never allocate an RPC or retry on a retired port. */ }
    };
    return { publish, release: () => { if (live()) { publish(false); this.leaveOwner = null; } } };
  }
  request(kind: "call" | "slot", verb: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.port || this.retired) return Promise.reject(new ApiError("CRM bridge is unavailable", 503));
    if (this.pending.size >= 8) return Promise.reject(new ApiError("CRM bridge is busy; wait for the current request", 429));
    const large = verb.startsWith("records.csv.");
    if (large && [...this.pending.values()].some(p => p.large)) return Promise.reject(new ApiError("A CSV request is already pending", 429));
    const id = `crm-${++this.serial}`;
    return new Promise((resolve, reject) => {
      // No automatic retries: a timed-out protected operation may have executed.
      const timer = setTimeout(() => this.retire(new ApiError("CRM request did not answer. Inspect fresh status before retrying an effect.", 504)), 65000);
      this.pending.set(id, { resolve, reject, timer, kind, large });
      this.port!.postMessage({ v: 2, op: kind, id, verb, args, ...(kind === "slot" ? { anchor: "footer" } : {}) });
    });
  }
  private receive(data: unknown): void {
    if (this.retired || !object(data) || data.v !== 2) throw invalid();
    if (data.op === "screen") {
      if (bytes(data) > 131072) throw invalid();
      acceptPush(data);
      return;
    }
    if (data.op !== "reply" && data.op !== "slot-state") throw invalid();
    if (bytes(data) > 1049600 || typeof data.id !== "string") throw invalid();
    const p = this.pending.get(data.id);
    if (!p || (data.op === "reply" ? p.kind !== "call" : p.kind !== "slot")) throw invalid();
    if (data.op === "reply") {
      if (data.ok === true && exact(data, ["v", "op", "id", "ok", "data"]) && "data" in data) {
        if (bytes(data.data) > 1048576) throw invalid();
        this.finish(data.id, data.data);
      }
      else if (data.ok === false && exact(data, ["v", "op", "id", "ok", "refusal"])) this.fail(data.id, refusal(data.refusal));
      else throw invalid();
    } else {
      if (!exact(data, ["v", "op", "id", "state", "refusal", "data"])) throw invalid();
      if (data.state === "pending" && data.data === undefined && data.refusal === undefined) return;
      if (data.state === "done" && data.refusal === undefined) {
        if ("data" in data && bytes(data.data) > 1048576) throw invalid();
        if (object(data.data) && ["confirmation_nonce", "confirmation_token", "confirm_token", "action_token"].some(k => k in (data.data as Record<string, unknown>))) throw invalid();
        this.finish(data.id, data.data);
      } else if (data.state === "refused" && data.data === undefined) this.fail(data.id, refusal(data.refusal));
      else throw invalid();
    }
  }
  private finish(id: string, value: unknown): void {
    const p = this.pending.get(id)!; clearTimeout(p.timer); this.pending.delete(id); p.resolve(value);
  }
  private fail(id: string, error: ApiError): void {
    const p = this.pending.get(id)!; clearTimeout(p.timer); this.pending.delete(id);
    if ([401, 403].includes(error.status)) { p.reject(error); this.retire(error); }
    else p.reject(error);
  }
  retire(error: ApiError): void {
    if (this.retired) return;
    this.retired = true; this.leaveOwner = null;
    this.port?.close(); this.port = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); clearScope(error.message);
  }
}
export const channel = new Channel();
export function admitted(verb: string, actions: readonly string[]): boolean { return OPERATIONS.includes(verb) && actions.includes(verb); }
