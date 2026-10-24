import { ApiError } from "@cadence/screen-ui";
import { useSyncExternalStore } from "react";

/**
 * CAD-1777 — the host surface contract (`screen-surfaces.v1`). The host tells
 * each frame which surface it owns and whether its overlay is modal. This is
 * host-local UI state: never a records operation, an authority grant or a
 * routing instruction. A frame never chooses its own role.
 */
export const SCREEN_SURFACES_V1 = "screen-surfaces.v1";

/** The two UI verbs an opted-in records peer may be advertised. They are
 *  deliberately absent from the records operation table: a drawer capability
 *  never becomes a service call. */
export const DRAWER_VERBS = ["screen.drawer.open", "screen.drawer.close"] as const;
export type DrawerVerb = (typeof DRAWER_VERBS)[number];
export type DrawerSurface = "customer" | "segment";
export type SurfaceRole = "primary" | "drawer";

export interface SurfaceState {
  /** Set only after the host pushed a validated surface message. Hosts that
   *  never opt in keep the ordinary embedded drawer. */
  negotiated: boolean;
  role: SurfaceRole;
  modal: boolean;
}

const VERB_SET: ReadonlySet<string> = new Set(DRAWER_VERBS);
export const isDrawerVerb = (verb: string): verb is DrawerVerb => VERB_SET.has(verb);

/** Both verbs are required to open: opening a panel the app could not close
 *  again is not a capability we treat as available. */
export const drawerAdvertised = (actions: readonly string[]): boolean =>
  DRAWER_VERBS.every((verb) => actions.includes(verb));

/** A child may be advertised only close; it still needs that close path. */
export const drawerClosable = (actions: readonly string[]): boolean =>
  actions.includes("screen.drawer.close");

const initial: SurfaceState = { negotiated: false, role: "primary", modal: false };
let surface: SurfaceState = initial;
const listeners = new Set<() => void>();

export const getSurface = (): SurfaceState => surface;

export const subscribeSurface = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useSurface(): SurfaceState {
  return useSyncExternalStore(subscribeSurface, getSurface);
}

function applySurface(next: SurfaceState): void {
  if (surface.negotiated === next.negotiated && surface.role === next.role && surface.modal === next.modal) return;
  surface = next;
  for (const listener of listeners) listener();
}

/** Retiring a scope (or the frame) must never leave an overlay role behind. */
export function resetSurface(): void {
  applySurface(initial);
}

/** Strict parse: exactly the four negotiated keys (v, op, role, modal), v1, a
 *  closed role set and a boolean modal flag. Anything else is a protocol
 *  violation the channel retires on. The role is host-owned; no child
 *  argument can set it. */
export function parseSurface(data: Record<string, unknown>): SurfaceState {
  const keys = Object.keys(data);
  if (
    keys.length !== 4 ||
    !keys.includes("v") ||
    !keys.includes("op") ||
    !keys.includes("role") ||
    !keys.includes("modal") ||
    data.v !== 1 ||
    data.op !== "surface" ||
    (data.role !== "primary" && data.role !== "drawer") ||
    typeof data.modal !== "boolean"
  ) {
    throw new ApiError("The CRM bridge refused an invalid surface message", 502);
  }
  return { negotiated: true, role: data.role === "drawer" ? "drawer" : "primary", modal: data.modal === true };
}

export function acceptSurface(data: Record<string, unknown>): void {
  applySurface(parseSurface(data));
}
