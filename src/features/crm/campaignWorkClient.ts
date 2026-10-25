import { ApiError } from "@cadence/screen-ui";
import {
  checkAssignee,
  checkBlockedReason,
  checkDueAt,
  checkWorkStatus,
  type WorkStatus,
} from "../../domain/campaignWork";
import { serviceCall, type CallArgs } from "../../bridge/services";
import { checkCampaignId } from "./campaignGrammar";

/**
 * Typed host client for app-owned campaign work metadata (CRM-12).
 *
 * Scope (installation + digest) always comes from the trusted route via
 * the bridge; the body carries only the campaign id, the expected work
 * revision and the requested values. Attribution (`assigned_by`,
 * `assigned_at`), record revisions, `updated_at`, the content revision
 * and `next_decision` are recorded or derived by the source, so they are
 * refused here before a byte is sent — the host refuses them again.
 *
 * `expected_revision` is mandatory on every write: the first write of a
 * campaign sends 0 and any other value is a stale-write refusal, never an
 * overwrite. No field here can approve, send or publish anything.
 */

/** Fields this client refuses in any body or input: authority claims,
 *  recorded provenance and derived state. */
export const FORBIDDEN_WORK_KEYS = [
  "by",
  "actor",
  "owner",
  "assigned_by",
  "assigned_at",
  "revision",
  "updated_at",
  "content_revision",
  "next_decision",
  "link",
  "install_id",
  "context_id",
] as const;

export interface WorkScope {
  installId: string;
  digest: string;
}

export interface WorkWriteInput {
  campaignId: string;
  /** The work revision the operator last read; 0 for the first write. */
  expectedRevision: number;
  /** Present = change. `null` unassigns, clears the due date or the status. */
  assignee?: string | null;
  dueAt?: string | null;
  status?: WorkStatus | null;
  blockedReason?: string | null;
}

const SHOW_KEYS = ["campaign_id"] as const;
const SAVE_KEYS = ["campaign_id", "expected_revision", "assignee", "due_at", "status", "blocked_reason"] as const;
const INPUT_KEYS = ["campaignId", "expectedRevision", "assignee", "dueAt", "status", "blockedReason"] as const;

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new ApiError(`campaign work ${what} carries a forbidden field: ${key}`, 400, {
        code: "forbidden_field",
      });
    }
  }
}

function workWriteBody(input: WorkWriteInput): CallArgs["campaign-work.save"] {
  assertKeys(input as unknown as Record<string, unknown>, INPUT_KEYS, "save");
  checkCampaignId(input.campaignId);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ApiError("A campaign work save needs the revision it was read at.", 400, {
      code: "invalid_body",
    });
  }
  const body: CallArgs["campaign-work.save"] = {
    campaign_id: input.campaignId,
    expected_revision: input.expectedRevision,
  };
  if (input.assignee !== undefined) {
    if (input.assignee !== null) checkAssignee(input.assignee);
    body.assignee = input.assignee;
  }
  if (input.dueAt !== undefined) {
    if (input.dueAt !== null) checkDueAt(input.dueAt);
    body.due_at = input.dueAt;
  }
  if (input.status !== undefined) {
    if (input.status !== null) checkWorkStatus(input.status);
    body.status = input.status;
  }
  if (input.blockedReason !== undefined) {
    if (input.blockedReason !== null) checkBlockedReason(input.blockedReason);
    if (input.blockedReason !== null && body.status !== "blocked" && input.status === undefined) {
      throw new ApiError("A blocked reason needs the blocked status.", 400);
    }
    body.blocked_reason = input.blockedReason;
  }
  if (Object.keys(body).length === 2) {
    throw new ApiError("A campaign work save changes at least one value.", 400, { code: "invalid_body" });
  }
  assertKeys(body as unknown as Record<string, unknown>, SAVE_KEYS, "save");
  return body;
}

export const campaignWorkClient = {
  /** Read one campaign's recorded work facts. The host answers with the
   *  contract, source identity, campaign, work row and content revision. */
  show(scope: WorkScope, campaignId: string): Promise<unknown> {
    checkCampaignId(campaignId);
    const body: CallArgs["campaign-work.show"] = { campaign_id: campaignId };
    assertKeys(body as unknown as Record<string, unknown>, SHOW_KEYS, "read");
    return serviceCall(scope, "campaign-work.show", body);
  },
  /** Record an assignment, due date, status or blocked reason. Refuses a
   *  stale revision (409 `stale_revision`) and any authority claim. */
  save(scope: WorkScope, input: WorkWriteInput): Promise<unknown> {
    return serviceCall(scope, "campaign-work.save", workWriteBody(input));
  },
};
