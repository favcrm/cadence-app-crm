import { ApiError } from "@cadence/screen-ui";
import { useLayoutEffect,useRef,useState } from "react";
import { getScope,onScopeRetired,subscribeScope,type DisplayScope } from "../../bridge/scope";

const operations = { customers: "records.list", segments: "segments.list", campaigns: "content.list" } as const;
type ListKey = keyof typeof operations;
export interface CustomerListState {
  query: string;
  committed: string;
  cursors: string[];
  consentFilter: string;
  sourceFilter: string;
  tagFilter: string;
}
type Position = { top: number; left: number };
type Entry = { position: Position; customers?: CustomerListState };
type Ticket = { identity: string; generation: number; key: ListKey };
let generation = 0;
let memory: { identity: string; lists: Partial<Record<ListKey, Entry>> } | null = null;
const retireHandlers = new Set<() => void>();
const clear = () => { memory = null; generation++; retireHandlers.forEach(stop => stop()); };

// One verified scope in this frame only. Any admitted-rights change retires
// tickets, so a cleanup from before access loss cannot repopulate the memory.
function reconcile(): string | null {
  const snapshot = getScope();
  const identity = snapshot && snapshot.digest
    ? JSON.stringify([snapshot.scope.installId, snapshot.digest,
        [...new Set(snapshot.actions)].sort()])
    : null;
  if (memory && memory.identity !== identity) clear();
  return identity;
}
onScopeRetired(clear);
subscribeScope(reconcile);

function open(scope: DisplayScope, key: ListKey): Ticket | null {
  const identity = reconcile();
  const snapshot = getScope();
  if (!identity || !snapshot || snapshot.scope.installId !== scope.installId ||
      !snapshot.actions.includes(operations[key])) return null;
  memory ??= { identity, lists: {} };
  return { identity, generation, key };
}
function current(ticket: Ticket | null): boolean {
  const identity = reconcile();
  const snapshot = getScope();
  return ticket !== null && memory !== null && ticket.generation === generation &&
    ticket.identity === identity && memory.identity === identity &&
    snapshot !== null && snapshot.actions.includes(operations[ticket.key]);
}
const copyCustomers = (state: CustomerListState): CustomerListState => ({ ...state, cursors: [...state.cursors] });
export function readCustomerList(scope: DisplayScope): CustomerListState | null {
  const ticket = open(scope, "customers");
  if (!current(ticket)) return null;
  const saved = memory?.lists.customers?.customers;
  return saved ? copyCustomers(saved) : null;
}
function bounded(state: CustomerListState): boolean {
  // Retention limits only: never truncate a live selector/backstack or disable
  // ordinary Next/Previous. An oversized snapshot simply isn't retained.
  if (state.query.length > 120 || state.committed.length > 120 || state.cursors.length > 64 ||
      !["", "granted", "unknown", "denied"].includes(state.consentFilter) ||
      state.sourceFilter.length > 256 || state.tagFilter.length > 256) return false;
  const encoder = new TextEncoder();
  return state.cursors.every(cursor => cursor.length <= 2048 && encoder.encode(cursor).length <= 2048) &&
    encoder.encode(JSON.stringify(state)).length <= 32768;
}
const offset = (value: number) => Number.isFinite(value) ? Math.min(1000000, Math.max(0, value)) : 0;

/** Presentation only: no rows, resources, drafts, receipts or authority. */
export function useListMemory(
  scope: DisplayScope,
  key: ListKey,
  ready: boolean,
  failure: unknown,
  customers?: CustomerListState,
  presentation = "",
) {
  const listRef = useRef<HTMLElement>(null);
  const [ticket] = useState(() => open(scope, key));
  const [saved] = useState(() => current(ticket) ? memory?.lists[key]?.position : undefined);
  const latest = useRef({ ready: false, customers, presentation, position: saved ? { ...saved } : { top: 0, left: 0 }, topPending: true, leftPending: true });
  const denied = failure instanceof ApiError && [401, 403].includes(failure.status);
  const persist = () => {
    if (!current(ticket) || !memory) return;
    const state = latest.current;
    if (key === "customers" && (!state.customers || !bounded(state.customers))) {
      delete memory.lists.customers;
      return;
    }
    memory.lists[key] = {
      position: { ...state.position },
      ...(key === "customers" && state.customers ? { customers: copyCustomers(state.customers) } : {}),
    };
  };

  useLayoutEffect(() => {
    if (denied) { clear(); latest.current.ready = false; return; }
    latest.current.ready = ready;
    latest.current.customers = customers;
    if (!current(ticket)) return;
    const root = listRef.current;
    const vertical = root?.ownerDocument.scrollingElement;
    if (!root || !vertical) return;
    const table = root.querySelector<HTMLElement>(".crm-table-wrap");
    const state = latest.current;
    if (state.presentation !== presentation) {
      state.presentation = presentation;
      state.topPending = state.leftPending = false;
    }
    if (ready) {
      // Restore only after these exact selectors have rendered cached/server
      // rows. Keep a wanted offset if the initial geometry clamps it (often 0);
      // a subsequent data render can finish restoration, without polling.
      if (state.topPending) {
        const max = Math.max(0, vertical.scrollHeight - vertical.clientHeight);
        if (max > 0 || state.position.top === 0) vertical.scrollTop = Math.min(max, state.position.top);
        state.topPending = max < state.position.top;
      }
      if (state.leftPending && table) {
        const max = Math.max(0, table.scrollWidth - table.clientWidth);
        if (max > 0 || state.position.left === 0) table.scrollLeft = Math.min(max, state.position.left);
        state.leftPending = max < state.position.left;
      }
      if (!state.topPending) state.position.top = offset(vertical.scrollTop);
      if (!state.leftPending && table) state.position.left = offset(table.scrollLeft);
    }
    persist();
  });

  useLayoutEffect(() => {
    const root = listRef.current;
    const doc = root?.ownerDocument;
    const vertical = doc?.scrollingElement;
    if (!root || !doc || !vertical || !current(ticket)) return;
    const capture = (event: Event) => {
      if (!current(ticket) || !latest.current.ready) return;
      const state = latest.current;
      const table = root.querySelector<HTMLElement>(".crm-table-wrap");
      if ((event.target === doc || event.target === vertical) && !state.topPending) state.position.top = offset(vertical.scrollTop);
      else if (table && event.target === table && !state.leftPending) state.position.left = offset(table.scrollLeft);
      else return;
      persist();
    };
    // Deliberate scrolling supersedes an unreachable wanted offset. Ordinary
    // input/control clicks and drawer events must not consume restoration.
    const interact = (event: Event) => {
      if (!current(ticket) || !latest.current.ready || !(event.target instanceof Element) || !root.contains(event.target)) return;
      if (event instanceof KeyboardEvent && (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(event.key) || event.target.closest("input, textarea, select, button, [contenteditable]"))) return;
      if (event.type === "pointerdown" && event.target !== root.querySelector(".crm-table-wrap")) return;
      latest.current.topPending = latest.current.leftPending = false;
    };
    doc.addEventListener("scroll", capture, true);
    root.addEventListener("wheel", interact, { passive: true });
    root.addEventListener("touchmove", interact, { passive: true });
    root.addEventListener("pointerdown", interact);
    root.addEventListener("keydown", interact);
    const stop = () => {
      doc.removeEventListener("scroll", capture, true);
      root.removeEventListener("wheel", interact);
      root.removeEventListener("touchmove", interact);
      root.removeEventListener("pointerdown", interact);
      root.removeEventListener("keydown", interact);
      retireHandlers.delete(stop);
    };
    retireHandlers.add(stop);
    return () => { stop(); persist(); };
    // Ticket is mount-local; retirement permanently disables its old handlers.
  }, [ticket]);
  return listRef;
}
