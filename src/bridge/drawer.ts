import { channel } from "./channel";
import { getSurface, type DrawerSurface } from "./presentation";
import { getScope } from "./scope";

const SURFACE = /^[a-z0-9_-]{1,64}$/;

/**
 * These are host-local presentation calls, not records operations: they are
 * sent only to a host that negotiated `screen-surfaces.v1` and advertised the
 * verb, so a non-capable or older host never receives a blind call. A refusal
 * leaves the frame in the outlet instead of pretending the drawer succeeded.
 * Role is host-owned: only a primary frame may open, while a drawer frame may
 * always close its own host panel (and never open another one).
 */
export function openDrawer(surface: DrawerSurface): Promise<boolean> {
  const state = getSurface();
  if (!state.negotiated || state.role !== "primary" || !SURFACE.test(surface) || getScope()?.drawerOpen !== true) {
    return Promise.resolve(false);
  }
  return channel.request("call", "screen.drawer.open", { surface }, true).then(
    () => true,
    () => false,
  );
}

export function closeDrawer(): Promise<boolean> {
  const state = getSurface();
  // Close is a host operation: every role needs the advertised close verb,
  // and a host that never opted in is never called at all. The host's own
  // trusted close stays independent of this app-initiated request.
  if (!(state.negotiated && getScope()?.drawerClose === true)) {
    return Promise.resolve(false);
  }
  return channel.request("call", "screen.drawer.close", {}, true).then(
    () => true,
    () => false,
  );
}
