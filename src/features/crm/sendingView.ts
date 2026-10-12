// CRM-specific receipt labels; no settings, connections or credential authority.
export const EMAIL_SENDING_HREF = "crm:sending";
export const WAITING_APPROVAL_TEXT = "Waiting for owner approval in AgenticOS";
export const isHostedTransport = (b: { transportKind: string } | null | undefined) => b?.transportKind === "agenticos";
export const sendingFrom = (b: { state: string; sender: { address: string } } | null | undefined): string | null => b?.state === "live" ? b.sender.address : null;
export const waitingApproval = (row: { state: string; reason: string | null }) => row.state === "queued" && (row.reason ?? "").toLowerCase().startsWith("waiting for owner approval");
