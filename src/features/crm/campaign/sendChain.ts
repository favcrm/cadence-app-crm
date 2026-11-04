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

/** A host refusal carries a code; a timeout or a malformed answer does not.
 *  Only a refusal proves the host did not run the confirmation. */
export function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined;
}

/** The prepared (never approved) send that can be confirmed again as it
 *  stands: same audience, same ceiling, same saved email, and not one the
 *  host already refused. Anything else is prepared fresh. */
export function reusablePrepared(
  sends: { sendId: string; state: string; audienceFreezeId: string; maxRecipients: number; contentRevision: number; contentDigest: string }[] | null,
  want: { freezeId: string; maxRecipients: number; contentRevision: number; contentDigest: string },
  skip: ReadonlySet<string>,
): string | null {
  if (sends === null) return null;
  for (let i = sends.length - 1; i >= 0; i -= 1) {
    const row = sends[i]!;
    if (
      row.state === "prepared" &&
      !skip.has(row.sendId) &&
      row.audienceFreezeId === want.freezeId &&
      row.maxRecipients === want.maxRecipients &&
      row.contentRevision === want.contentRevision &&
      row.contentDigest === want.contentDigest
    ) return row.sendId;
  }
  return null;
}
