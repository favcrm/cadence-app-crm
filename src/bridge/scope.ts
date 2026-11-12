import { ApiError } from "@cadence/screen-ui";
import type { ScreenBridge, ScreenScopeSnapshot } from "@cadence/app-kit";
import { useSyncExternalStore } from "react";
import { admitted, channel, type CrmSection, type CrmView } from "./channel";

export interface DisplayScope { installId: string; digest: string }
export interface Route { section: CrmSection; view: CrmView; record_id: string | null; segment_id: string | null }
export interface ReadObservation { operation: string; args: Record<string, unknown>; data: unknown }
export interface ScopeSnapshot { presentationLocale: "en" | "zh-TW"; scope: DisplayScope; digest: string; actions: string[]; route: Route; observations: ReadObservation[] }

const listeners = new Set<() => void>();
const retireListeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

let activeBridge: ScreenBridge<CrmSection, CrmView, ApiError> | null = null;
let unsubscribeBridge: (() => void) | null = null;
let cachedRaw: ScreenScopeSnapshot<CrmSection, CrmView> | null = null;
let cachedSnap: ScopeSnapshot | null = null;
let manualError: string | null = null;
let wasError = false;

function mapSnapshot(raw: ScreenScopeSnapshot<CrmSection, CrmView> | null): ScopeSnapshot | null {
  if (!raw) {
    cachedRaw = null;
    cachedSnap = null;
    return null;
  }
  if (raw === cachedRaw && cachedSnap) return cachedSnap;
  const route: Route = raw.route ?? { section: "customers", view: "list", record_id: null, segment_id: null };
  cachedRaw = raw;
  cachedSnap = {
    presentationLocale: raw.presentationLocale === "zh-TW" ? "zh-TW" : "en",
    scope: { installId: raw.scope.installId, digest: raw.digest },
    digest: raw.digest,
    actions: [...raw.actions],
    route,
    observations: raw.observations.map((row) => ({ operation: row.operation, args: row.args, data: row.data })),
  };
  return cachedSnap;
}

export function bindBridgeScope(bridge: ScreenBridge<CrmSection, CrmView, ApiError>): void {
  if (activeBridge === bridge) return;
  unsubscribeBridge?.();
  activeBridge = bridge;
  cachedRaw = null;
  cachedSnap = null;
  manualError = null;
  wasError = bridge.getState().status === "error";
  unsubscribeBridge = bridge.subscribe(() => {
    manualError = null;
    const state = bridge.getState();
    const isError = state.status === "error";
    if (isError && !wasError) {
      wasError = true;
      retireListeners.forEach((f) => f());
    } else if (!isError) {
      wasError = false;
    }
    notify();
  });
  notify();
}

function ensureBridge(): ScreenBridge<CrmSection, CrmView, ApiError> {
  if (!activeBridge) bindBridgeScope(channel.bridge);
  return activeBridge!;
}

export const subscribeScope = (f: () => void) => {
  ensureBridge();
  listeners.add(f);
  return () => { listeners.delete(f); };
};

export const getScope = (): ScopeSnapshot | null => mapSnapshot(ensureBridge().getSnapshot());
export function useScope() { return useSyncExternalStore(subscribeScope, getScope); }
export function scopeError(): string | null {
  const err = ensureBridge().getState().error?.message ?? null;
  return err ?? manualError;
}
export function onScopeRetired(f: () => void) { retireListeners.add(f); return () => { retireListeners.delete(f); }; }

export function clearScope(reason: string): void {
  cachedRaw = null;
  cachedSnap = null;
  manualError = reason;
  activeBridge?.reset();
  wasError = false;
  retireListeners.forEach((f) => f());
  notify();
}

export function assertCurrentScope(scope: DisplayScope): void {
  ensureBridge().assertScope(scope);
}

export function requireOperation(verb: string): void {
  const s = getScope();
  if (!s || !admitted(verb, s.actions)) throw new ApiError("This workspace doesn't offer that action.", 403);
}
