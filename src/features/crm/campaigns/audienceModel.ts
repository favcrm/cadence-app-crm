import type { AudienceBaseInput } from "../audienceClient";
export interface AudiencePick {
  base: AudienceBaseInput;
  exclusionListId: string | null;
}

/** CAD-1178: the freeze id is derived from the audience, never typed. The
 *  same base + exclusions maps to the same freeze (stable across reloads);
 *  a changed audience maps to a new id — exactly when a refreeze is due —
 *  and re-freezing the same audience replays the same id server-side. */
export function audienceFreezeId(campaignId: string, pick: AudiencePick): string {
  const base =
    pick.base.mode === "segment"
      ? `segment:${pick.base.segmentId}`
      : pick.base.mode === "custom"
        ? `custom:${[...pick.base.customerIds].sort().join(",")}`
        : "all";
  const key = `${base}|${pick.exclusionListId ?? ""}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${campaignId}-freeze-${hash.toString(16).padStart(8, "0")}`;
}
