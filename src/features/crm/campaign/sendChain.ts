import { ApiError } from "@cadence/screen-ui";

/** The steps of one press of Send, in order. `null` means no chain is running. */
export type ChainPhase = "approving" | "preparing" | "confirming";

/** The audience a chain was started for must still be the audience on screen
 *  before each host card is requested. Anything else stops the chain. */
export function audienceChanged(captured: string | null, current: string | null): boolean {
  return captured === null || captured !== current;
}

/** The count on the button is what the owner agreed to; the prepared send
 *  carries the host's own count. If they differ, stop before the send card. */
export function countChanged(expected: number | null, prepared: number): boolean {
  return expected === null || expected !== prepared;
}

/** A plain Cancel on a host card is the owner's choice, not a failure. The
 *  host answers it with the refusal code `cancelled`. */
export function isCancelled(error: unknown): boolean {
  return error instanceof ApiError && error.code === "cancelled";
}

/** A new chain may start only when none is running. */
export function canStart(phase: ChainPhase | null): boolean {
  return phase === null;
}

/** Refusals the host's own card layer answers when the owner or the screen
 *  closed the card before anything ran. Only these prove nothing was sent;
 *  every other failure at the confirm step (a lost answer, an HTML 500, a 504,
 *  a 503) is an unknown outcome, because hosted sends the mail inside the
 *  confirm request. */
export const HOST_LOCAL_REFUSALS: readonly string[] = ["cancelled", "expired", "superseded", "busy"];
export function isHostLocalRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && HOST_LOCAL_REFUSALS.includes(error.code);
}

/**
 * Which send's result the page may show. While a card is open, or a lost answer
 * is still being settled, there is no result yet: a first `prepared` read must
 * not read as "nothing was sent" while the board may be claiming the send.
 */
export function visibleResultId(
  chain: { phase: unknown; settling: boolean; pendingSendId: string | null; approvedSendId: string | null; noticeKind: string | null },
  latestSendId: string | null,
): string | null {
  const unsettled = chain.phase !== null || chain.settling || chain.noticeKind === "unknown"
    || (chain.pendingSendId !== null && chain.approvedSendId === null);
  return unsettled ? null : chain.approvedSendId ?? latestSendId;
}
