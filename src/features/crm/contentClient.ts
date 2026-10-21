import { ApiError } from "@cadence/screen-ui";
import { serviceCall, serviceSlot, type CallArgs } from "../../bridge/services";

/**
 * Typed host action client for versioned campaign email content (CAD-782).
 *
 * Independent of CAD-781's record client: the installation identity
 * always comes from the trusted route/scope (install + digest) — never
 * from a form field, a chat message or a stored draft. Request bodies carry only
 * the operator-checked grammar the HTTP peer accepts; anything else
 * throws client-side before a byte is sent, and the server's
 * `deny_unknown_fields` refuses it again. No actor claims, receipt
 * claims (`assistant_receipt`, `turn_id`, `nonce`), HTML, SMTP
 * secrets or project links ever enter this client. Authority stays
 * server-checked; drafts submitted here are recorded as operator
 * work and stay inert until the operator explicitly applies them.
 * Sender/unsubscribe material travels only as typed preview-only
 * operator bindings; every render and test preparation is labelled
 * preview-only and final-send preparation refuses until CAD-785/786
 * supply host-verified evidence.
 */

/** URL-bound scope: the only identity this client will use. */
export interface ContentScope {
  installId: string;
  digest: string;
}

export type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "button"; label: string; url: string };

/** Body keys the HTTP peer accepts, per operation. */
const SAVE_KEYS = [
  "campaign_id",
  "name",
  "subject",
  "preheader",
  "blocks",
  "html",
  "text",
  "expected_revision",
] as const;
const CLONE_KEYS = [
  "expected_revision",
  "name",
  "copy_audience",
  "source_freeze_id",
  "copy_sender",
  "source_binding_id",
] as const;
const RENDER_KEYS = ["revision", "sample_first_name", "binding_id"] as const;
const APPROVE_KEYS = ["expected_revision"] as const;
const TEST_PREPARE_KEYS = ["to_email", "binding_id"] as const;
const SEND_PREPARE_KEYS = ["binding_id", "audience_freeze_id"] as const;
const BINDING_SAVE_KEYS = [
  "binding_id",
  "sender_name",
  "sender_address",
  "unsubscribe_base",
  "expected_revision",
] as const;

const APPLY_KEYS = ["expected_revision"] as const;
// CAD-813: the operator's one-time proposal-request mint names only
// the campaign and the chat message the assistant's turn should
// answer. Campaign scope and the source revision are host-stamped by
// the daemon — the body can never carry a token, receipt, turn or
// source_revision claim.


/** Authority-claiming fields that must never travel from the browser. */
const ALWAYS_FORBIDDEN = [
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
] as const;

export const FORBIDDEN_CONTENT_KEYS = [...ALWAYS_FORBIDDEN] as const;

function assertClean(body: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw new ApiError(`content ${what} carries a forbidden field`, 400, {
        code: "forbidden_field",
      });
    }
  }
}

function assertInputClean(input: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw new ApiError(`content ${what} carries a forbidden field`, 400, {
        code: "forbidden_field",
      });
    }
  }
}

/**
 * CAD-1056 operator save: exactly one of `blocks` (structured) or
 * `html` (pasted; the host sanitises it and stores only the result),
 * plus an optional plain-text override. The host always appends the
 * unsubscribe footer and any save resets approval.
 */
export type ContentDraftInput = {
  campaignId: string;
  /** CAD-1058: optional human campaign name (operator save only). */
  name?: string;
  subject: string;
  preheader?: string;
  text?: string;
  expectedRevision?: number;
} & (
  | { blocks: ContentBlock[]; html?: never }
  | { html: string; blocks?: never }
);

export interface CloneInput {
  expectedRevision: number;
  name: string;
  copyAudience?: { sourceFreezeId: string };
  copySender?: { sourceBindingId: string };
}

export interface ClonedContent {
  campaign_id: string;
  name: string;
  revision: number;
  subject: string;
  preheader: string;
  blocks: ContentBlock[];
  mode: "blocks" | "html";
  html: string | null;
  text_override: string | null;
  approval: { revision: number | null; digest: string | null; valid: false; scope: "content-only" };
}

export type AudienceSelectionBase =
  | { mode: "all" }
  | { mode: "segment"; segment_id: string }
  | { mode: "custom"; customer_ids: string[] };

export interface CloneResult {
  content: ClonedContent;
  starterSelection: {
    audience: { base: AudienceSelectionBase; exclusionListId: string | null } | null;
    senderBindingId: string | null;
  };
}

interface CloneResponse {
  content: ClonedContent;
  starter_selection: {
    audience: { base: AudienceSelectionBase; exclusion_list_id: string | null } | null;
    sender_binding_id: string | null;
  };
}

export interface ProposalInput {
  campaignId: string;
  proposalId: string;
  subject: string;
  preheader?: string;
  blocks: ContentBlock[];
}

/** Mount contract (CAD-784 owns visible campaign wiring):
 *  `CrmOutlet` renders `<CrmCompose scope campaignId />` inside the
 *  campaign route; this client stays mount-agnostic. */
export const contentClient = {
  save(scope: ContentScope, input: ContentDraftInput): Promise<unknown> {
    assertInputClean(input as unknown as Record<string, unknown>, ["campaignId", "name", "subject", "preheader", "blocks", "html", "text", "expectedRevision"], "save");
    if ((input.blocks === undefined) === (input.html === undefined)) {
      throw new ApiError("content save needs exactly one of blocks or html", 400, {
        code: "invalid_body",
      });
    }
    const body: CallArgs["content.save"] = {
      campaign_id: input.campaignId,
      subject: input.subject,
      preheader: input.preheader ?? "",
    };
    if (input.blocks !== undefined) body.blocks = input.blocks;
    if (input.html !== undefined) body.html = input.html;
    if (input.text !== undefined) body.text = input.text;
    if (input.name !== undefined) body.name = input.name;
    if (input.expectedRevision !== undefined) body.expected_revision = input.expectedRevision;
    assertClean(body, SAVE_KEYS, "save");
    return serviceCall(scope, "content.save", body);
  },
  show(scope: ContentScope, campaignId: string): Promise<unknown> {
    return serviceCall(scope, "content.show", { campaign_id: campaignId });
  },
  clone(scope: ContentScope, sourceCampaignId: string, input: CloneInput): Promise<CloneResult> {
    const allowed = ["expectedRevision", "name", "copyAudience", "copySender"] as const;
    assertInputClean(input as unknown as Record<string, unknown>, allowed, "clone");
    const body: Record<string, unknown> = {
      expected_revision: input.expectedRevision,
      name: input.name,
      copy_audience: input.copyAudience !== undefined,
      copy_sender: input.copySender !== undefined,
    };
    if (input.copyAudience !== undefined) {
      assertInputClean(input.copyAudience, ["sourceFreezeId"], "clone audience selection");
      body.source_freeze_id = input.copyAudience.sourceFreezeId;
    }
    if (input.copySender !== undefined) {
      assertInputClean(input.copySender, ["sourceBindingId"], "clone sender selection");
      body.source_binding_id = input.copySender.sourceBindingId;
    }
    assertClean(body, CLONE_KEYS, "clone");
    return serviceCall<CloneResponse>(scope, "content.clone", { campaign_id: sourceCampaignId, ...body }).then((response) => ({
      content: response.content,
      starterSelection: {
        audience: response.starter_selection.audience
          ? {
              base: response.starter_selection.audience.base,
              exclusionListId: response.starter_selection.audience.exclusion_list_id,
            }
          : null,
        senderBindingId: response.starter_selection.sender_binding_id,
      },
    }));
  },
  list(scope: ContentScope): Promise<unknown> {
    return serviceCall(scope, "content.list", {});
  },
  render(
    scope: ContentScope,
    campaignId: string,
    opts?: { revision?: number; sampleFirstName?: string; bindingId?: string },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (opts?.revision !== undefined) body.revision = opts.revision;
    if (opts?.sampleFirstName !== undefined) body.sample_first_name = opts.sampleFirstName;
    if (opts?.bindingId !== undefined) body.binding_id = opts.bindingId;
    assertClean(body, RENDER_KEYS, "render");
    return serviceCall(scope, "content.render", { campaign_id: campaignId, ...body });
  },
  approve(scope: ContentScope, campaignId: string, expectedRevision: number): Promise<unknown> {
    const body: Record<string, unknown> = { expected_revision: expectedRevision };
    assertClean(body, APPROVE_KEYS, "approve");
    return serviceSlot(scope, "content.approve", { campaign_id: campaignId, expected_revision: expectedRevision }).then(() => serviceCall(scope, "content.show", { campaign_id: campaignId }));
  },
  /** `GET …/proposals/<id>/render` — read transport (the proposal id is
   *  the only selector; a body is refused). The host renders the inert
   *  draft's own subject/preheader/blocks — never a save, never a send —
   *  returning proposal_id/source_revision/preview_only:true/send_ready:
   *  false (no saved `revision` — a proposal is unsaved by definition). */
  proposalRender(scope: ContentScope, proposalId: string): Promise<unknown> {
    return serviceCall(scope, "proposals.render", { proposal_id: proposalId });
  },
  testPrepare(
    scope: ContentScope,
    campaignId: string,
    toEmail: string,
    bindingId?: string,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { to_email: toEmail };
    if (bindingId !== undefined) body.binding_id = bindingId;
    assertClean(body, TEST_PREPARE_KEYS, "test-prepare");
    return serviceCall(scope, "content.test-prepare", { campaign_id: campaignId, to_email: toEmail, binding_id: bindingId });
  },
  sendPrepare(
    scope: ContentScope,
    campaignId: string,
    bindingId: string,
    audienceFreezeId?: string,
  ): Promise<unknown> {
    const body: Record<string, unknown> = { binding_id: bindingId };
    if (audienceFreezeId !== undefined) body.audience_freeze_id = audienceFreezeId;
    assertClean(body, SEND_PREPARE_KEYS, "send-prepare");
    return serviceCall(scope, "content.send-prepare", { campaign_id: campaignId, binding_id: bindingId, audience_freeze_id: audienceFreezeId });
  },
  bindingSave(
    scope: ContentScope,
    input: {
      bindingId: string;
      senderName: string;
      senderAddress: string;
      unsubscribeBase: string;
      expectedRevision?: number;
    },
  ): Promise<unknown> {
    assertInputClean(input as unknown as Record<string, unknown>, [
      "bindingId",
      "senderName",
      "senderAddress",
      "unsubscribeBase",
      "expectedRevision",
    ], "binding-save");
    const body: CallArgs["sender-bindings.save"] = {
      binding_id: input.bindingId,
      sender_name: input.senderName,
      sender_address: input.senderAddress,
      unsubscribe_base: input.unsubscribeBase,
    };
    if (input.expectedRevision !== undefined) body.expected_revision = input.expectedRevision;
    assertClean(body, BINDING_SAVE_KEYS, "binding-save");
    return serviceCall(scope, "sender-bindings.save", body);
  },
  bindingShow(scope: ContentScope, bindingId: string): Promise<unknown> {
    return serviceCall(scope, "sender-bindings.show", { binding_id: bindingId });
  },
  bindingList(scope: ContentScope): Promise<unknown> {
    return serviceCall(scope, "sender-bindings.list", {});
  },
  proposalList(scope: ContentScope): Promise<unknown> {
    return serviceCall(scope, "proposals.list", {});
  },
  proposalShow(scope: ContentScope, proposalId: string): Promise<unknown> {
    return serviceCall(scope, "proposals.show", { proposal_id: proposalId });
  },
  proposalApply(
    scope: ContentScope,
    proposalId: string,
    expectedRevision?: number,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (expectedRevision !== undefined) body.expected_revision = expectedRevision;
    assertClean(body, APPLY_KEYS, "apply");
    return serviceCall(scope, "proposals.apply", { proposal_id: proposalId, ...body });
  },
  proposalDiscard(scope: ContentScope, proposalId: string): Promise<unknown> {
    return serviceCall(scope, "proposals.discard", { proposal_id: proposalId });
  },
};
