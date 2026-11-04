import type { SendListEntry } from "../sendClient";

/** The campaign's status, derived only from what the host recorded about
 *  its sends. `null` (unknown) is not "Draft": a failed or unfinished read
 *  shows no chip rather than an invented state. */
export type CampaignStatusKey = "draft" | "sending" | "sent" | "partial" | "uncertain";

export interface CampaignStatus {
  key: CampaignStatusKey;
  /** English label; translate at render. */
  label: string;
  /** The `data-state` the chip wears. */
  chip: "running" | "completed" | "failed" | "uncertain" | null;
}

/** The newest send that left `prepared`. A prepared send was never
 *  approved, so nothing went out. Ties keep the later row. */
export function latestSend(sends: SendListEntry[]): SendListEntry | null {
  let best: SendListEntry | null = null;
  for (const row of sends) {
    if (row.state === "prepared") continue;
    if (best === null || row.created >= best.created) best = row;
  }
  return best;
}

export function sendStatus(send: SendListEntry): CampaignStatus {
  if (send.state === "sending") return { key: "sending", label: "Sending", chip: "running" };
  if (send.state === "closed" || send.counts.uncertain > 0) {
    return { key: "uncertain", label: "Check result", chip: "uncertain" };
  }
  if (send.state === "completed") {
    return send.counts.failed > 0
      ? { key: "partial", label: "Sent, some failed", chip: "failed" }
      : { key: "sent", label: "Sent", chip: "completed" };
  }
  // A state this app does not know: say so instead of calling it sent.
  return { key: "uncertain", label: "Check result", chip: "uncertain" };
}

export function campaignStatus(sends: SendListEntry[] | null): CampaignStatus | null {
  if (sends === null) return null;
  const send = latestSend(sends);
  return send === null ? { key: "draft", label: "Draft", chip: null } : sendStatus(send);
}
