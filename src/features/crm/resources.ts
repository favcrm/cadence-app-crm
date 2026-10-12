import { ApiError,QueryCache,useQuery,type Resource } from "@cadence/screen-ui";
import { useMemo } from "react";
import { onScopeRetired,useScope } from "../../bridge/scope";
import { onWrite,serviceCall,type CallArgs } from "../../bridge/services";
import type { HostScope } from "./hostActions";
let cache = new QueryCache({ maxIdle: 32 });
let observationInvalid = false;
const failures = new WeakMap<object, unknown>();
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)]));
  return value;
}
export const canonicalArgs = (args: object) => JSON.stringify(ordered(args));
onScopeRetired(() => { cache = new QueryCache({ maxIdle: 32 }); observationInvalid = false; });
onWrite(() => { observationInvalid = true; cache.invalidate("crm"); });
export function useCrmQuery<T>(scope: HostScope, operation: keyof CallArgs, args: CallArgs[keyof CallArgs], parse: (data: unknown) => T): { data: T | null; error: string | null; failure: unknown; loading: boolean; updating: boolean; store: Resource<T> } {
  const pushed = useScope();
  const selectors = canonicalArgs(args);
  const key = JSON.stringify([scope.installId, scope.contextId, pushed?.digest ?? "retired", operation, selectors]);
  const store: Resource<T> = cache.family("crm", async () => {
    try {
      const result = parse(await serviceCall(scope, operation, args));
      failures.delete(store);
      return result;
    } catch (error) { failures.set(store, error); throw error; }
  }, { freshMs: 0, discardOnError: (e: unknown) => {
    const denied = e instanceof ApiError && [401, 403].includes(e.status);
    if (denied) observationInvalid = true;
    return denied;
  } })(key);
  const query = useQuery(store);
  // Display observations never seed freshness or authorize an action. Ordinary
  // network errors retain them; access refusal/scope retirement discard them.
  const row = !observationInvalid && pushed?.scope.installId === scope.installId && pushed.scope.contextId === scope.contextId
    ? pushed.observations.find(o => o.operation === operation && canonicalArgs(o.args) === selectors) : undefined;
  const observed = useMemo(() => { if (!row) return null; try { return parse(row.data); } catch { return null; } }, [row]);
  const data = query.data ?? observed;
  return { data, error: query.error, failure: failures.get(store), loading: data === null && query.inFlight, updating: data !== null && query.inFlight, store };
}
export function QueryRefresh({ updating }: { updating: boolean }) {
  // Kept in a .ts module without JSX so resource adapters stay plain TS.
  return updating ? "Updating…" : null;
}
