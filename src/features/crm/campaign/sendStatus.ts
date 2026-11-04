import type { SendCounts,SendListEntry } from "../sendClient";

/** What the status needs of a send: its state and per-recipient counts. */
export type SendFacts = { state: string; counts: SendCounts; countsKnown?: boolean };

/** The campaign's status, derived only from what the host recorded about
 *  its sends. `null` (unknown) is not "Draft": a failed or unfinished read
 *  shows no chip rather than an invented state. */
export type CampaignStatusKey = "draft" | "sending" | "sent" | "partial" | "failed" | "nothing" | "finished" | "uncertain";

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

export function sendStatus(send: SendFacts): CampaignStatus {
  // Prepared, never approved: nothing went out.
  if (send.state === "prepared") return { key: "draft", label: "Draft", chip: null };
  if (send.state === "sending") return { key: "sending", label: "Sending", chip: "running" };
  if (send.state === "closed" || send.counts.uncertain > 0) {
    return { key: "uncertain", label: "Check result", chip: "uncertain" };
  }
  if (send.state === "completed" && send.countsKnown === false) {
    // The host did not report counts: say it finished, not what it did.
    return { key: "finished", label: "Finished", chip: null };
  }
  if (send.state === "completed") {
    // "Sent" needs at least one message the mail server accepted. A send in
    // which nothing was accepted is never called sent.
    if (send.counts.accepted === 0) {
      return send.counts.failed > 0
        ? { key: "failed", label: "Not sent, all failed", chip: "failed" }
        : { key: "nothing", label: "Nothing sent", chip: null };
    }
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
