import { ApiError } from "@cadence/screen-ui";
import { channel } from "./channel";
import { assertCurrentScope,requireOperation,type DisplayScope } from "./scope";

type Bag = Record<string, unknown>;
type CsvDecision = { row: number; action: string; expected_revision?: number };
type Base = { mode: "all" } | { mode: "segment"; segment_id: string } | { mode: "custom"; customer_ids: string[] };
export interface CallArgs {
  "records.list": { query?: string; limit?: number; cursor?: string };
  "records.show": { record_id: string };
  "records.create": { record_id: string; profile: unknown; consent_provenance?: unknown };
  "records.update": { record_id: string; expected_revision: number; profile: unknown; consent_provenance?: unknown };
  "records.csv.preview": { csv_text: string };
  "segments.list": Bag; "segments.show": { segment_id: string };
  "segments.save": { segment_id: string; name: string; predicates: unknown[]; expected_revision?: number };
  "exclusions.list": Bag; "exclusions.show": { list_id: string };
  "exclusions.save": { list_id: string; name: string; member_ids: string[]; expected_revision?: number };
  "suppressions.list": Bag; "suppressions.add": { email?: string; customer_id?: string; reason: string };
  "audience.preview": { base: Base; exclusion_list_id?: string };
  "audience.prepare": { freeze_id: string; base: Base; exclusion_list_id?: string; max_recipients: number };
  "audience.show": { freeze_id: string };
  "content.list": Bag; "content.show": { campaign_id: string };
  "content.save": { campaign_id: string; subject: string; name?: string; preheader?: string; blocks?: unknown[]; html?: string; text?: string; expected_revision?: number };
  "content.clone": { campaign_id: string; expected_revision: number; name: string; copy_audience: boolean; copy_sender: boolean; source_freeze_id?: string; source_binding_id?: string };
  "content.render": { campaign_id: string; revision?: number; sample_first_name?: string; binding_id?: string };
  "proposals.list": { campaign_id?: string }; "proposals.show": { proposal_id: string }; "proposals.render": { proposal_id: string };
  "proposals.apply": { proposal_id: string; expected_revision?: number }; "proposals.discard": { proposal_id: string };
  "sender-bindings.list": Bag; "sender-bindings.show": { binding_id: string };
  "sender-bindings.save": { binding_id: string; sender_name: string; sender_address: string; unsubscribe_base: string; expected_revision?: number };
  "content.test-prepare": { campaign_id: string; to_email: string; binding_id?: string };
  "content.send-prepare": { campaign_id: string; binding_id: string; audience_freeze_id?: string };
  // CRM-12 app-owned campaign work metadata. The read carries the campaign
  // id only; the write carries the revision it was read at. Attribution,
  // record revisions, the content revision and next_decision are recorded
  // or derived by the source and never travel from the frame.
  "campaign-work.show": { campaign_id: string };
  "campaign-work.save": { campaign_id: string; expected_revision: number; assignee?: string | null; due_at?: string | null; status?: string | null; blocked_reason?: string | null };
  "sends.prepare": { campaign_id: string; audience_freeze_id: string; request_id: string };
  "sends.show": { send_id: string }; "sends.list": { campaign_id?: string };
  "smtp.show": Bag; "origin.show": Bag;
  "screen.route.patch": { section?: "customers" | "segments" | "campaigns"; view?: "list" | "new"; record_id?: string | null; segment_id?: string | null; replace?: boolean };
  "screen.preview.show": { preview_id: string; document: string; anchor: Rect; mode: "draft" | "saved" };
  "screen.preview.clear": { preview_id: string };
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface SlotArgs {
  "records.csv.import": { csv_text: string; preview_token: string; request_id: string; decisions?: CsvDecision[] };
  "records.csv.confirm": SlotArgs["records.csv.import"];
  "content.approve": { campaign_id: string; expected_revision: number };
  "smtp.manage": Bag; "smtp.bind": Bag; "smtp.rebind": Bag; "smtp.revoke": Bag;
  "smtp.test-send": { campaign_id: string };
  "sends.approve": { send_id: string };
  "sends.resolve": { send_id: string; customer_id: string };
  "origin.manage": Bag;
  "chat.campaign.open": { campaign_id: string };
  "chat.campaign.brief": { campaign_id: string; brief: string };
}
// A closed field allowlist is checked again at runtime before serialization.
export const CALL_FIELDS: Record<keyof CallArgs, readonly string[]> = {
  "records.list": ["query", "limit", "cursor"], "records.show": ["record_id"],
  "records.create": ["record_id", "profile", "consent_provenance"], "records.update": ["record_id", "expected_revision", "profile", "consent_provenance"],
  "records.csv.preview": ["csv_text"], "segments.list": [], "segments.show": ["segment_id"], "segments.save": ["segment_id", "name", "predicates", "expected_revision"],
  "exclusions.list": [], "exclusions.show": ["list_id"], "exclusions.save": ["list_id", "name", "member_ids", "expected_revision"],
  "suppressions.list": [], "suppressions.add": ["email", "customer_id", "reason"],
  "audience.preview": ["base", "exclusion_list_id"], "audience.prepare": ["freeze_id", "base", "exclusion_list_id", "max_recipients"], "audience.show": ["freeze_id"],
  "content.list": [], "content.show": ["campaign_id"], "content.save": ["campaign_id", "name", "subject", "preheader", "blocks", "html", "text", "expected_revision"],
  "content.clone": ["campaign_id", "expected_revision", "name", "copy_audience", "copy_sender", "source_freeze_id", "source_binding_id"], "content.render": ["campaign_id", "revision", "sample_first_name", "binding_id"],
  "proposals.list": ["campaign_id"], "proposals.show": ["proposal_id"], "proposals.render": ["proposal_id"], "proposals.apply": ["proposal_id", "expected_revision"], "proposals.discard": ["proposal_id"],
  "sender-bindings.list": [], "sender-bindings.show": ["binding_id"], "sender-bindings.save": ["binding_id", "sender_name", "sender_address", "unsubscribe_base", "expected_revision"],
  "content.test-prepare": ["campaign_id", "to_email", "binding_id"], "content.send-prepare": ["campaign_id", "binding_id", "audience_freeze_id"],
  "campaign-work.show": ["campaign_id"], "campaign-work.save": ["campaign_id", "expected_revision", "assignee", "due_at", "status", "blocked_reason"],
  "sends.prepare": ["campaign_id", "audience_freeze_id", "request_id"], "sends.show": ["send_id"], "sends.list": ["campaign_id"], "smtp.show": [], "origin.show": [],
  "screen.route.patch": ["section", "view", "record_id", "segment_id", "replace"], "screen.preview.show": ["preview_id", "document", "anchor", "mode"], "screen.preview.clear": ["preview_id"],
};
export const SLOT_FIELDS: Record<keyof SlotArgs, readonly string[]> = {
  "records.csv.import": ["csv_text", "preview_token", "request_id", "decisions"], "records.csv.confirm": ["csv_text", "preview_token", "request_id", "decisions"],
  "content.approve": ["campaign_id", "expected_revision"], "smtp.manage": [], "smtp.bind": [], "smtp.rebind": [], "smtp.revoke": [], "smtp.test-send": ["campaign_id"],
  "sends.approve": ["send_id"], "sends.resolve": ["send_id", "customer_id"], "origin.manage": [], "chat.campaign.open": ["campaign_id"], "chat.campaign.brief": ["campaign_id", "brief"],
};
export const OPERATIONS = [...Object.keys(CALL_FIELDS), ...Object.keys(SLOT_FIELDS)];
export function cleanArgs(verb: string, args: Bag, slot: boolean): Bag {
  const fields = (slot ? SLOT_FIELDS : CALL_FIELDS)[verb as never] as readonly string[] | undefined;
  if (!fields || !args || typeof args !== "object" || Array.isArray(args)) throw new ApiError("Unlisted CRM operation", 400);
  for (const key of Object.keys(args)) if (!fields.includes(key)) throw new ApiError(`Refused CRM field: ${key}`, 400);
  const value = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  const cap = verb.startsWith("records.csv.") ? 327680 : ["records.create", "records.update", "content.save", "screen.preview.show"].includes(verb) ? 49152 : 16384;
  if (new TextEncoder().encode(JSON.stringify(value)).length > cap) throw new ApiError("CRM request exceeds its operation budget", 413);
  return value;
}
const writeListeners = new Set<() => void>();
export const onWrite = (f: () => void) => { writeListeners.add(f); return () => { writeListeners.delete(f); }; };
const written = () => writeListeners.forEach(f => f());
export async function serviceCall<T = unknown, K extends keyof CallArgs = keyof CallArgs>(scope: DisplayScope, verb: K, args: CallArgs[K]): Promise<T> {
  assertCurrentScope(scope); requireOperation(verb);
  const result = await channel.request("call", verb, cleanArgs(verb, args as Bag, false)) as T;
  if (["records.create", "records.update", "segments.save", "exclusions.save", "suppressions.add", "audience.prepare", "content.save", "content.clone", "proposals.apply", "proposals.discard", "sender-bindings.save", "campaign-work.save"].includes(verb)) written();
  return result;
}
export async function serviceSlot<T = unknown, K extends keyof SlotArgs = keyof SlotArgs>(scope: DisplayScope, verb: K, args: SlotArgs[K]): Promise<T> {
  assertCurrentScope(scope); requireOperation(verb);
  const result = await channel.request("slot", verb, cleanArgs(verb, args as Bag, true)) as T;
  if (!["smtp.manage", "chat.campaign.open", "chat.campaign.brief"].includes(verb)) written();
  return result;
}
