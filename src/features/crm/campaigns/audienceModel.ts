import type { AudienceBaseInput } from "../audienceClient";

/** `base: null` is "the owner has not chosen": no freeze id, no send
 *  selection, no prepare. It is never read as everyone. */
export interface AudiencePick {
  base: AudienceBaseInput | null;
  exclusionListId: string | null;
}

/** The most recipients a send may freeze: the counted audience plus headroom,
 *  rounded up to a step of ten so a count that drifts by one or two stays in
 *  the same freeze instead of creating a new one each time. */
export function sendCeiling(finalCount: number): number {
  return Math.max(10, Math.ceil((finalCount * 1.25 + 10) / 10) * 10);
}

/** CAD-1178: the freeze id is derived from the audience, never typed. The
 *  same base + exclusions maps to the same freeze (stable across reloads);
 *  a changed audience maps to a new id — exactly when a refreeze is due —
 *  and re-freezing the same audience replays the same id server-side.
 *  No chosen audience has no freeze id. */
export function audienceFreezeId(campaignId: string, pick: AudiencePick, ceiling: number | null): string | null {
  if (pick.base === null || ceiling === null) return null;
  const base =
    pick.base.mode === "segment"
      ? `segment:${pick.base.segmentId}`
      : pick.base.mode === "custom"
        ? `custom:${[...pick.base.customerIds].sort().join(",")}`
        : "all";
  // The ceiling is part of the freeze address: the board refuses the same
  // freeze behind a different maximum (`ceiling_differs`), so a count that
  // moves the ceiling must move to a new freeze rather than a dead end.
  const key = `${base}|${pick.exclusionListId ?? ""}|${ceiling}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${campaignId}-freeze-${hash.toString(16).padStart(8, "0")}`;
}
