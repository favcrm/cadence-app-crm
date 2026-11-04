import { useSyncExternalStore } from "react";
import type { ChainPhase } from "./sendChain";

/**
 * One record per `installId:campaignId` for the send that is running, held
 * outside the keyed page component. The page remounts on a route change or
 * back/forward while the frame and the host's card stay alive; the running
 * chain, its lock and what it learned must survive that, so a remounted page
 * reads them back instead of starting from a fresh "Draft".
 */
export interface ChainNotice {
  kind: "error" | "cancelled" | "waiting";
  /** English text with `{slot}` placeholders; translated where it is shown. */
  text: string;
  slots?: Record<string, string>;
  /** Nothing can have been sent when the chain stopped before its last card. */
  confirming: boolean;
}

export interface ChainRecord {
  phase: ChainPhase | null;
  /** The send a host card may have confirmed: observe it, never show Draft. */
  pendingSendId: string | null;
  approvedSendId: string | null;
  notice: ChainNotice | null;
  /** Bumped whenever a chain ends: a mounted page reads the sends again. */
  ended: number;
  /** Bumped when the count the owner agreed to proved out of date. */
  recount: number;
}

export interface Current {
  freezeId: string | null;
  count: number | null;
}

const EMPTY: ChainRecord = { phase: null, pendingSendId: null, approvedSendId: null, notice: null, ended: 0, recount: 0 };
const records = new Map<string, ChainRecord>();
const currents = new Map<string, Current>();
const skipped = new Map<string, Set<string>>();
const listeners = new Map<string, Set<() => void>>();

export const chainKey = (installId: string, campaignId: string) => `${installId}:${campaignId}`;
export const getChain = (key: string): ChainRecord => records.get(key) ?? EMPTY;
function emit(key: string) { for (const fn of listeners.get(key) ?? []) fn(); }

export function patchChain(key: string, patch: Partial<ChainRecord>): void {
  records.set(key, { ...getChain(key), ...patch });
  emit(key);
}

/** Atomically claim the right to run a chain. A second press, from this page
 *  or a remounted one, gets `false`. */
export function beginChain(key: string): boolean {
  if (getChain(key).phase !== null) return false;
  patchChain(key, { phase: "approving", notice: null, pendingSendId: null });
  return true;
}

export function subscribeChain(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (set === undefined) { set = new Set(); listeners.set(key, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

export function useChain(key: string): ChainRecord {
  return useSyncExternalStore((fn) => subscribeChain(key, fn), () => getChain(key));
}

/** What the page on screen currently shows. `undefined` = no page is mounted,
 *  so a chain must stop rather than act on a stale picture. */
export const publishCurrent = (key: string, current: Current | undefined) => {
  if (current === undefined) currents.delete(key); else currents.set(key, current);
};
export const getCurrent = (key: string): Current | undefined => currents.get(key);

export function skipPrepared(key: string, sendId: string): void {
  let set = skipped.get(key);
  if (set === undefined) { set = new Set(); skipped.set(key, set); }
  set.add(sendId);
}
export const skippedPrepared = (key: string): ReadonlySet<string> => skipped.get(key) ?? new Set();

/** Test hook: forget everything. */
export function resetChains(): void { records.clear(); currents.clear(); skipped.clear(); listeners.clear(); }
