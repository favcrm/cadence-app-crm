import { ApiError } from "@cadence/screen-ui";
import {
  createScreenReceiver,
  ScreenClosedError,
  ScreenRefusalError,
  ScreenTimeoutError,
  type ScreenBoot,
  type ScreenReceiver,
} from "@cadence/app-kit";
import { acceptPush,clearScope,getScope } from "./scope";
import { OPERATIONS } from "./services";

type CampaignLeaveState = { publish: (unsaved: boolean) => void; release: () => void };
const MAX_PUSH_BYTES = 131072;
const MAX_DATA_BYTES = 1048576;
const SECRET_KEYS = ["confirmation_nonce", "confirmation_token", "confirm_token", "action_token"];
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

function guardData(value: unknown): unknown {
  if (bytes(value) > MAX_DATA_BYTES) throw invalid();
  if (object(value) && SECRET_KEYS.some(k => k in value)) throw invalid();
  return value;
}

class Channel {
  private receiver: ScreenReceiver | null = null;
  private retired = false;
  private leaveOwner: symbol | null = null;
  private inFlight = 0;
  private csvInFlight = false;
  private cause: ApiError | null = null;

  start(): void {
    if (this.receiver || this.retired) return;
    const node = document.getElementById("cadence-screen-boot");
    if (!node?.textContent || node.textContent.length > 2048) throw invalid();
    const boot: unknown = JSON.parse(node.textContent);
    if (!object(boot) || !exact(boot, ["tag", "bridge_nonce", "generation", "parent_origin"]) || boot.tag !== "crm" ||
        typeof boot.bridge_nonce !== "string" || !/^[a-f0-9]{64}$/.test(boot.bridge_nonce) ||
        !Number.isSafeInteger(boot.generation) || (boot.generation as number) < 0 || typeof boot.parent_origin !== "string") throw invalid();
    const origin = new URL(boot.parent_origin);
    if (origin.origin !== boot.parent_origin || !["http:", "https:"].includes(origin.protocol) || window.parent === window) throw invalid();

    const receiver = createScreenReceiver({
      boot: boot as unknown as ScreenBoot,
      accepts: ["screen.v2", "screen-records.v1", "crm-locale.v1"],
      timeoutMs: 65000,
      maxArgsBytes: 327680,
      onPush: (push) => {
        if (bytes(push) > MAX_PUSH_BYTES) throw invalid();
        acceptPush(push);
      },
      onError: (reason) => {
        this.retire(new ApiError(reason, 502));
      },
    });
    // app-kit reports a refused boot through an inert receiver; keep the app's
    // own tag check here so a different app's boot can never mount CRM.
    if (!receiver.boot || receiver.boot.tag !== "crm") {
      receiver.teardown();
      throw invalid();
    }
    this.receiver = receiver;
  }

  /** A live editor owns only a boolean warning hint, not a navigation request. */
  ownCampaignLeaveState(): CampaignLeaveState | null {
    const receiver = this.receiver;
    const scope = getScope();
    // A validated scope PUSH must precede any warning publication.
    if (!receiver?.accepted() || this.retired || !scope) return null;
    const owner = Symbol();
    this.leaveOwner = owner;
    const live = () => {
      const current = getScope();
      return !this.retired && this.receiver === receiver && this.leaveOwner === owner && !!current &&
        current.scope.installId === scope.scope.installId &&
        current.digest === scope.digest;
    };
    const publish = (unsaved: boolean) => {
      if (typeof unsaved !== "boolean" || !live()) return;
      receiver.state(JSON.stringify({ contract: "crm-leave.v1", unsaved }));
    };
    return { publish, release: () => { if (live()) { publish(false); this.leaveOwner = null; } } };
  }

  request(kind: "call" | "slot", verb: string, args: Record<string, unknown>): Promise<unknown> {
    const receiver = this.receiver;
    if (!receiver || this.retired) return Promise.reject(new ApiError("CRM bridge is unavailable", 503));
    if (this.inFlight >= 8) return Promise.reject(new ApiError("CRM bridge is busy; wait for the current request", 429));
    const large = verb.startsWith("records.csv.");
    if (large && this.csvInFlight) return Promise.reject(new ApiError("A CSV request is already pending", 429));
    this.inFlight += 1;
    if (large) this.csvInFlight = true;
    const settle = () => { this.inFlight -= 1; if (large) this.csvInFlight = false; };
    const result = kind === "call"
      ? receiver.call(verb, args)
      : receiver.slot(verb, args, "footer").then(event => {
          if (event.state !== "done") throw refusal(event.refusal);
          return event.data;
        });
    return result.then(
      value => {
        settle();
        try { return guardData(value); }
        catch (error) { const mapped = this.mapError(error); this.retire(mapped); throw mapped; }
      },
      error => {
        settle();
        const mapped = this.mapError(error);
        if ([401, 403, 504, 502].includes(mapped.status)) this.retire(mapped);
        return Promise.reject(mapped);
      },
    );
  }

  private mapError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    if (error instanceof ScreenRefusalError) return new ApiError(error.text || error.code, error.status, { code: error.code });
    if (error instanceof ScreenTimeoutError) {
      return new ApiError("CRM request did not answer. Inspect fresh status before retrying an effect.", 504);
    }
    if (error instanceof ScreenClosedError) return this.cause ?? new ApiError("CRM bridge is unavailable", 503);
    return invalid();
  }

  retire(error: ApiError): void {
    if (this.retired) return;
    this.retired = true; this.leaveOwner = null; this.cause = error;
    this.receiver?.teardown(); this.receiver = null;
    clearScope(error.message);
  }
}
export const createChannel = (): Channel => new Channel();
export const channel = createChannel();
export function admitted(verb: string, actions: readonly string[]): boolean { return OPERATIONS.includes(verb) && actions.includes(verb); }
