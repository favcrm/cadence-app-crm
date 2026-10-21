import { ApiError } from "@cadence/screen-ui";
import { useSyncExternalStore } from "react";
import { admitted,exact } from "./channel";
import { CALL_FIELDS,OPERATIONS } from "./services";
export interface DisplayScope { installId: string; digest: string }
export interface Route { section: "customers" | "segments" | "campaigns"; view: "list" | "new"; record_id: string | null; segment_id: string | null }
export interface ReadObservation { operation: string; args: Record<string, unknown>; data: unknown }
export interface ScopeSnapshot { presentationLocale: "en" | "zh-TW"; scope: DisplayScope; digest: string; actions: string[]; route: Route; observations: ReadObservation[] }
let snapshot: ScopeSnapshot | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();
const retireListeners = new Set<() => void>();
const notify = () => listeners.forEach(f => f());
export const subscribeScope = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const getScope = () => snapshot;
export function useScope() { return useSyncExternalStore(subscribeScope, getScope); }
export function scopeError() { return error; }
export function onScopeRetired(f: () => void) { retireListeners.add(f); return () => { retireListeners.delete(f); }; }
export function clearScope(reason: string): void { snapshot = null; error = reason; retireListeners.forEach(f => f()); notify(); }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest = (v: unknown) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
function invalid(): never { throw new ApiError("Invalid CRM scope projection", 502); }
export function parseRoute(v: unknown): Route {
  if (!obj(v) || !exact(v, ["section", "view", "record_id", "segment_id"]) || !["customers", "segments", "campaigns"].includes(v.section as string) || !["list", "new"].includes(v.view as string) || (v.record_id !== null && !id(v.record_id)) || (v.segment_id !== null && !id(v.segment_id))) invalid();
  return v as unknown as Route;
}
export function acceptPush(p: Record<string, unknown>): void {
  if (!exact(p, ["v", "op", "install_id", "context_id", "digest", "tag", "installation", "contexts", "runs", "outbox", "publish_intents", "sources", "defaults", "readiness", "actions", "now", "resume", "route", "read_observations", "presentation_locale"]) || p.tag !== "crm" || !id(p.install_id) || !(p.context_id === undefined || p.context_id === "" || id(p.context_id)) || !digest(p.digest) || !Array.isArray(p.actions) || !p.actions.every(a => typeof a === "string" && OPERATIONS.includes(a)) || new Set(p.actions).size !== p.actions.length) invalid();
  if ("presentation_locale" in p && p.presentation_locale !== "en" && p.presentation_locale !== "zh-TW") invalid();
  if (!obj(p.installation) || !exact(p.installation, ["install_id", "name", "title", "version", "digest", "summary"]) || p.installation.install_id !== p.install_id || p.installation.digest !== p.digest || p.installation.name !== "crm" || !["title", "version", "summary"].every(k => typeof (p.installation as Record<string, unknown>)[k] === "string") || ("contexts" in p && (!Array.isArray(p.contexts) || !p.contexts.every(c => obj(c) && exact(c, ["id", "label"]) && id(c.id) && typeof c.label === "string")))) invalid();
  if (snapshot && (snapshot.scope.installId !== p.install_id || snapshot.digest !== p.digest)) invalid();
  const actions = p.actions as string[];
  const observations: ReadObservation[] = [];
  if (p.read_observations !== undefined) {
    if (!Array.isArray(p.read_observations) || p.read_observations.length > 16) invalid();
    for (const row of p.read_observations) {
      if (!obj(row) || !exact(row, ["operation", "args", "data"]) || typeof row.operation !== "string" || !["records.list", "records.show", "segments.list", "segments.show", "content.list", "content.show"].includes(row.operation) || !admitted(row.operation, actions) || !obj(row.args) || !exact(row.args, CALL_FIELDS[row.operation as keyof typeof CALL_FIELDS]) || new TextEncoder().encode(JSON.stringify(row)).length > 65536) invalid();
      observations.push(row as unknown as ReadObservation);
    }
  }
  snapshot = { presentationLocale: p.presentation_locale === "zh-TW" ? "zh-TW" : "en", scope: { installId: p.install_id as string, digest: p.digest as string }, digest: p.digest as string, actions, route: parseRoute(p.route), observations };
  error = null; notify();
}
export function assertCurrentScope(scope: DisplayScope): void {
  if (!snapshot || scope.installId !== snapshot.scope.installId || scope.digest !== snapshot.scope.digest) throw new ApiError("CRM scope is absent or retired", 403);
}
export function requireOperation(verb: string): void {
  if (!snapshot || !admitted(verb, snapshot.actions)) throw new ApiError("CRM operation is unavailable on this mount", 403);
}
