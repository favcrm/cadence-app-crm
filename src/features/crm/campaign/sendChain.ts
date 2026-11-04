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
