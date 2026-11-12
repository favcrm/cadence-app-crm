import { ApiError } from "@cadence/screen-ui";
import {
  createScreenBridge,
  type ScreenBridge,
  type ScreenBridgeRuntimeOverrides,
} from "@cadence/app-kit";
import { bindBridgeScope, type DisplayScope } from "./scope";
import { CALL_FIELDS, OPERATIONS, SLOT_FIELDS, WRITE_VERBS } from "./services";

export type CrmSection = "customers" | "segments" | "campaigns";
export type CrmView = "list" | "new";
export type CampaignLeaveState = { publish: (unsaved: boolean) => void; release: () => void };

export function createCrmBridge(): ScreenBridge<CrmSection, CrmView, ApiError> {
  return createScreenBridge<CrmSection, CrmView, ApiError>({
    tag: "crm",
    appName: "crm",
    records: true,
    locale: true,
    calls: CALL_FIELDS,
    slots: SLOT_FIELDS,
    argBytes: {
      "records.csv.preview": 327680,
      "records.csv.import": 327680,
      "records.csv.confirm": 327680,
      "records.create": 49152,
      "records.update": 49152,
      "content.save": 49152,
      "screen.preview.show": 49152,
    },
    singleFlight: ["records.csv."],
    writeVerbs: WRITE_VERBS,
    route: {
      sections: ["customers", "segments", "campaigns"],
      defaultSection: "customers",
      views: ["list", "new"],
    },
    observations: [
      "records.list",
      "records.show",
      "segments.list",
      "segments.show",
      "content.list",
      "content.show",
    ],
    maxInFlight: 8,
    timeoutMs: 65000,
    createError: (message, status, options) => new ApiError(message, status, options),
  });
}

export class Channel {
  private instance: ScreenBridge<CrmSection, CrmView, ApiError> | null = null;

  get bridge(): ScreenBridge<CrmSection, CrmView, ApiError> {
    if (!this.instance) this.instance = createCrmBridge();
    return this.instance;
  }

  start(opts: ScreenBridgeRuntimeOverrides = {}): void {
    bindBridgeScope(this.bridge);
    this.bridge.start(opts);
    const state = this.bridge.getState();
    if (state.status === "error" && state.error) throw state.error;
  }

  /** A live editor owns only a boolean warning hint, not a navigation request. */
  ownCampaignLeaveState(): CampaignLeaveState | null {
    return this.bridge.ownLeaveState();
  }

  call<T = unknown>(scope: DisplayScope, verb: string, args: Record<string, unknown>): Promise<T> {
    if (this.bridge.getState().status === "error" || !this.bridge.getSnapshot()) {
      return Promise.reject(new ApiError("CRM bridge is unavailable", 503));
    }
    return this.bridge.call<T>(scope, verb, args);
  }

  slot<T = unknown>(scope: DisplayScope, verb: string, args: Record<string, unknown>): Promise<T> {
    if (this.bridge.getState().status === "error" || !this.bridge.getSnapshot()) {
      return Promise.reject(new ApiError("CRM bridge is unavailable", 503));
    }
    return this.bridge.slot<T>(scope, verb, args, "footer");
  }

  request(kind: "call" | "slot", verb: string, args: Record<string, unknown>): Promise<unknown> {
    const snap = this.bridge.getSnapshot();
    if (!snap || this.bridge.getState().status === "error") {
      return Promise.reject(new ApiError("CRM bridge is unavailable", 503));
    }
    const scope: DisplayScope = { installId: snap.scope.installId, digest: snap.digest };
    return kind === "call" ? this.call(scope, verb, args) : this.slot(scope, verb, args);
  }

  onWrite = (listener: () => void): (() => void) => this.bridge.onWrite(listener);

  retire(error: ApiError): void {
    this.bridge.retire(error);
  }

  resetForTests(): void {
    this.bridge.reset();
  }
}

export const createChannel = (): Channel => new Channel();
export const channel = createChannel();
export function admitted(verb: string, actions: readonly string[]): boolean {
  return OPERATIONS.includes(verb) && actions.includes(verb);
}
