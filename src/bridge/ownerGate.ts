import { useSyncExternalStore } from "react";

/**
 * The host answers a member's read of an owner-only table with 403 `owner_required`
 * ("Only an owner may read this table's records."). Customers stay member-readable;
 * segments and campaigns are owner-only. The first such refusal of a read is recorded
 * once per section, and the screen shows one calm owner-only state in place of that
 * section (page and canvas alike): no partial data, no retry. Other sections keep loading.
 */
export type GatedSection = "segments" | "campaigns";

const PREFIXES: ReadonlyArray<readonly [string, GatedSection]> = [
  ["segments.", "segments"], ["exclusions.", "segments"], ["suppressions.", "segments"],
  ["content.", "campaigns"], ["proposals.", "campaigns"], ["sender-bindings.", "campaigns"],
  ["sends.", "campaigns"], ["smtp.", "campaigns"], ["origin.", "campaigns"],
];

/** The owner-only section a `.list`/`.show` read belongs to; writes, prepares, records and audience reads belong to none. */
export const sectionOfRead = (verb: string): GatedSection | null =>
  /\.(list|show)$/.test(verb) ? PREFIXES.find(([p]) => verb.startsWith(p))?.[1] ?? null : null;

export const isOwnerRequired = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "owner_required";

let refused: ReadonlySet<GatedSection> = new Set();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

export function noteOwnerRequired(section: GatedSection): void {
  if (refused.has(section)) return;
  refused = new Set([...refused, section]);
  emit();
}
export function resetOwnerGate(): void {
  if (refused.size === 0) return;
  refused = new Set();
  emit();
}
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const getOwnerRefused = (): ReadonlySet<GatedSection> => refused;
export function useOwnerRefused(): ReadonlySet<GatedSection> { return useSyncExternalStore(subscribe, getOwnerRefused); }
