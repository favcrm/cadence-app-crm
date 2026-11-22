import { useEffect,useRef } from "react";
import { patchRoute } from "../../bridge/route";
import { useScope } from "../../bridge/scope";
import type { Params } from "../../domain/routeParams";

/** The params the host holds on the route (a declared view's filters). */
export function useRouteParams(): Params | undefined { return useScope()?.route.params; }

/**
 * Keeps a list's filters and the route's params in step. A route that changes
 * from outside (an assistant opening the view again) is applied through `apply`;
 * a filter the user changes is written back with `screen.route.patch {params}`,
 * so the link and the canvas title follow. `read` and `write` are the pure
 * param mappers; the first state is the caller's to derive from the route.
 */
export function useRouteParamSync<T>(state: T, read: (raw: Params | undefined) => T, write: (state: T) => Record<string, string>, apply: (next: T) => void, delayMs = 0): void {
  const raw = useRouteParams();
  const routeKey = JSON.stringify(write(read(raw)));
  const stateKey = JSON.stringify(write(state));
  const sent = useRef<string | null>(null);
  const latest = useRef({ state, read, write, apply, raw });
  latest.current = { state, read, write, apply, raw };
  // The route changed: apply it unless it is the echo of what this screen sent
  // or already what is showing.
  const mounted = useRef(false);
  useEffect(() => {
    // The first render derived its state from the route (or restored its own).
    if (!mounted.current) { mounted.current = true; return; }
    if (routeKey === sent.current) { sent.current = null; return; }
    if (routeKey === JSON.stringify(latest.current.write(latest.current.state))) return;
    latest.current.apply(latest.current.read(latest.current.raw));
  }, [routeKey]);
  // A filter changed: write it back when the route does not already say so.
  useEffect(() => {
    const current = latest.current;
    if (stateKey === JSON.stringify(current.write(current.read(current.raw)))) return;
    const timer = setTimeout(() => {
      sent.current = stateKey;
      void patchRoute({ params: current.write(current.state) }).catch(() => undefined);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [stateKey]);
}
