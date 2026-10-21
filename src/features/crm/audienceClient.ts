import { ApiError } from "@cadence/screen-ui";
import { serviceCall, type CallArgs } from "../../bridge/services";
import { assertRecordId,assertScope,type HostScope } from "./hostActions";

/**
 * Typed host action client for saved segments, exclusion lists,
 * suppressions and frozen audiences (CAD-780 backend, CAD-784 UI).
 *
 * Mirrors the record/content clients: the installation identity always
 * comes from the trusted route/scope (install + digest) — never from a form field,
 * a chat message or a stored draft. Request bodies carry only the
 * operator-checked grammar the HTTP peer accepts; anything else
 * throws client-side before a byte is sent, and the server's
 * `deny_unknown_fields` refuses it again. Predicate and base values
 * never become SQL — the daemon evaluates an allowlisted grammar in
 * Rust. No actor claims, receipt claims (`assistant_receipt`,
 * `turn_id`, `nonce`), SQL, App database paths or project links ever
 * enter this client.
 */

export type AudienceScope = HostScope;

export interface SegmentPredicate {
  field: string;
  op: string;
  value: string;
}

export type AudienceBaseInput =
  | { mode: "all" }
  | { mode: "segment"; segmentId: string }
  | { mode: "custom"; customerIds: string[] };

/** Body keys the HTTP peer accepts, per operation. */
const SEGMENT_SAVE_KEYS = ["segment_id", "name", "predicates", "expected_revision"] as const;
const EXCLUSION_SAVE_KEYS = ["list_id", "name", "member_ids", "expected_revision"] as const;
const SUPPRESSION_ADD_KEYS = ["email", "customer_id", "reason"] as const;
const PREVIEW_KEYS = ["base", "exclusion_list_id"] as const;
const PREPARE_KEYS = ["freeze_id", "base", "exclusion_list_id", "max_recipients"] as const;

/** Authority-claiming and receipt-shaped fields that must never
 *  travel from the browser. */
export const FORBIDDEN_AUDIENCE_KEYS = [
  "by",
  "actor",
  "workspace",
  "project",
  "project_link",
  "sql",
  "path",
  "secret",
  "install_id",
  "context_id",
  "assistant_receipt",
  "turn_id",
  "nonce",
] as const;

function assertClean(body: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new ApiError(`audience ${what} carries a forbidden field`, 400, {
        code: "forbidden_field",
      });
    }
  }
}

function assertInputClean(
  input: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new ApiError(`audience ${what} carries a forbidden field`, 400, {
        code: "forbidden_field",
      });
    }
  }
}

export interface SegmentSaveInput {
  segmentId: string;
  name: string;
  predicates: SegmentPredicate[];
  expectedRevision?: number;
}

export interface ExclusionSaveInput {
  listId: string;
  name: string;
  memberIds: string[];
  expectedRevision?: number;
}

function baseBody(base: AudienceBaseInput): CallArgs["audience.preview"]["base"] {
  if (base.mode === "all") return { mode: "all" };
  if (base.mode === "segment") {
    assertRecordId(base.segmentId);
    return { mode: "segment", segment_id: base.segmentId };
  }
  if (base.customerIds.length === 0) {
    throw new ApiError("a custom audience needs at least one customer ID", 400);
  }
  for (const id of base.customerIds) assertRecordId(id);
  return { mode: "custom", customer_ids: [...base.customerIds].sort() };
}

export const audienceClient = {
  guards: { assertScope, assertRecordId },
  /** `POST …/segments` — body is exactly
   *  `{segment_id, name, predicates, expected_revision?}`. */
  async segmentSave(scope: AudienceScope, input: SegmentSaveInput): Promise<unknown> {
    assertInputClean(
      input as unknown as Record<string, unknown>,
      ["segmentId", "name", "predicates", "expectedRevision"],
      "segment save",
    );
    assertRecordId(input.segmentId);
    const body: CallArgs["segments.save"] = {
      segment_id: input.segmentId,
      name: input.name,
      predicates: input.predicates.map((rule) => ({
        field: rule.field,
        op: rule.op,
        value: rule.value,
      })),
    };
    if (input.expectedRevision !== undefined) body.expected_revision = input.expectedRevision;
    assertClean(body, SEGMENT_SAVE_KEYS, "segment save");
    return serviceCall(scope, "segments.save", body);
  },
  /** `GET …/segments/list` — every saved rule in this installation. */
  async segmentList(scope: AudienceScope): Promise<unknown> {
    return serviceCall(scope, "segments.list", {});
  },
  /** `GET …/segments/:id` — one saved rule. */
  async segmentShow(scope: AudienceScope, segmentId: string): Promise<unknown> {
    return serviceCall(scope, "segments.show", { segment_id: segmentId });
  },
  /** `POST …/exclusions` — body is exactly
   *  `{list_id, name, member_ids, expected_revision?}`. */
  async exclusionSave(scope: AudienceScope, input: ExclusionSaveInput): Promise<unknown> {
    assertInputClean(
      input as unknown as Record<string, unknown>,
      ["listId", "name", "memberIds", "expectedRevision"],
      "exclusion save",
    );
    assertRecordId(input.listId);
    const body: CallArgs["exclusions.save"] = {
      list_id: input.listId,
      name: input.name,
      member_ids: input.memberIds,
    };
    if (input.expectedRevision !== undefined) body.expected_revision = input.expectedRevision;
    assertClean(body, EXCLUSION_SAVE_KEYS, "exclusion save");
    return serviceCall(scope, "exclusions.save", body);
  },
  /** `GET …/exclusions/list` — every saved exclusion list. */
  async exclusionList(scope: AudienceScope): Promise<unknown> {
    return serviceCall(scope, "exclusions.list", {});
  },
  /** `GET …/exclusions/:id` — one saved exclusion list. */
  async exclusionShow(scope: AudienceScope, listId: string): Promise<unknown> {
    return serviceCall(scope, "exclusions.show", { list_id: listId });
  },
  /** `GET …/suppressions/list` — the current suppression set. */
  async suppressionList(scope: AudienceScope): Promise<unknown> {
    return serviceCall(scope, "suppressions.list", {});
  },
  /** `POST …/suppressions` — body is exactly
   *  `{email?, customer_id?, reason}`. */
  async suppressionAdd(
    scope: AudienceScope,
    input: { email?: string; customerId?: string; reason: string },
  ): Promise<unknown> {
    assertInputClean(input as unknown as Record<string, unknown>, ["email", "customerId", "reason"], "suppression add");
    const body: CallArgs["suppressions.add"] = { reason: input.reason };
    if (input.email !== undefined) body.email = input.email;
    if (input.customerId !== undefined) body.customer_id = input.customerId;
    assertClean(body, SUPPRESSION_ADD_KEYS, "suppression add");
    return serviceCall(scope, "suppressions.add", body);
  },
  /** `POST …/audience/preview` — exact host counts plus a bounded
   *  sample for one base mode and an optional saved exclusion list.
   *  Never the full member list. */
  async preview(
    scope: AudienceScope,
    base: AudienceBaseInput,
    exclusionListId?: string,
  ): Promise<unknown> {
    const body: CallArgs["audience.preview"] = { base: baseBody(base) };
    if (exclusionListId !== undefined) {
      assertRecordId(exclusionListId);
      body.exclusion_list_id = exclusionListId;
    }
    assertClean(body, PREVIEW_KEYS, "audience preview");
    return serviceCall(scope, "audience.preview", body);
  },
  /** `POST …/audience/prepares` — freeze the computed membership
   *  under a caller-chosen freeze ID with a recipient ceiling. */
  async prepare(
    scope: AudienceScope,
    input: { freezeId: string; base: AudienceBaseInput; exclusionListId?: string; maxRecipients: number },
  ): Promise<unknown> {
    assertInputClean(
      input as unknown as Record<string, unknown>,
      ["freezeId", "base", "exclusionListId", "maxRecipients"],
      "audience prepare",
    );
    assertRecordId(input.freezeId);
    if (!Number.isInteger(input.maxRecipients) || input.maxRecipients < 1) {
      throw new ApiError("audience maximum recipients is out of bounds", 400);
    }
    const body: CallArgs["audience.prepare"] = {
      freeze_id: input.freezeId,
      base: baseBody(input.base),
      max_recipients: input.maxRecipients,
    };
    if (input.exclusionListId !== undefined) {
      assertRecordId(input.exclusionListId);
      body.exclusion_list_id = input.exclusionListId;
    }
    assertClean(body, PREPARE_KEYS, "audience prepare");
    return serviceCall(scope, "audience.prepare", body);
  },
  /** `GET …/audience/prepares/:id` — the freeze plus its live
   *  validity (`valid`, first `drift` cause, current recount). */
  async freezeShow(scope: AudienceScope, freezeId: string): Promise<unknown> {
    return serviceCall(scope, "audience.show", { freeze_id: freezeId });
  },
};
