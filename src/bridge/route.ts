import type { NavigationAdapter } from "@cadence/screen-ui";
import { ApiError } from "@cadence/screen-ui";
import { getScope,type Route } from "./scope";
import { serviceCall,serviceSlot,type CallArgs } from "./services";
export const currentRoute = (): Route => getScope()?.route ?? { section: "customers", view: "list", record_id: null, segment_id: null };
export function patchRoute(patch: CallArgs["screen.route.patch"]): Promise<unknown> {
  const s = getScope();
  if (!s) return Promise.reject(new ApiError("CRM route is unavailable", 403));
  return serviceCall(s.scope, "screen.route.patch", patch);
}
export function navigateLogical(href: string, options?: { replace?: boolean }): void {
  const s = getScope();
  if (!s) return;
  if (href === "crm:sending") { void serviceSlot(s.scope, "smtp.manage", {}).catch(() => undefined); return; }
  // App-local vocabulary only; never parse or forward a host URL.
  const match = /^crm:(customers|segments|campaigns)(?:\/(new|[A-Za-z0-9_-]{1,128}))?$/.exec(href);
  if (!match) throw new ApiError("CRM navigation destination is not admitted", 400);
  void patchRoute({ section: match[1] as Route["section"], view: match[2] === "new" ? "new" : "list", record_id: match[2] && match[2] !== "new" ? match[2] : null, segment_id: null, ...(options?.replace ? { replace: true } : {}) }).catch(() => undefined);
}
export const FrameNavigationAdapter: NavigationAdapter = { href: () => "#", modifiedClicks: "prevent", navigate: navigateLogical };
