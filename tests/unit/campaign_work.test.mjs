// CRM-12 app-owned campaign work metadata and the scoped read contract.
// Run: bun test tests/unit/campaign_work.test.mjs
//
// The domain module imports ApiError from @cadence/screen-ui; no React or
// host bridge is involved, so only that module is stubbed.

import { test, expect, beforeAll, mock } from "bun:test";

mock.module("@cadence/screen-ui", () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, extra) {
      super(message);
      this.status = status;
      this.code = extra?.code;
    }
  },
}));

let domain;
beforeAll(async () => {
  domain = await import("../../src/domain/campaignWork.ts");
});

const DIGEST = "sha256:" + "a".repeat(64);
const AT = "2026-10-25T09:00:00.000Z";
const LATER = "2026-10-26T10:30:00.000Z";

const record = (overrides = {}) => ({
  revision: 1,
  contentRevision: 4,
  assignee: "Ada",
  assignedBy: "operator",
  assignedAt: AT,
  dueAt: "2026-11-01",
  status: "in_progress",
  blockedReason: null,
  updatedAt: AT,
  ...overrides,
});

const wireWork = (overrides = {}) => ({
  revision: 1,
  content_revision: 4,
  assignee: "Ada",
  assigned_by: "operator",
  assigned_at: AT,
  due_at: "2026-11-01",
  status: "in_progress",
  blocked_reason: null,
  updated_at: AT,
  ...overrides,
});

// The readiness chain reports each gate once; an override replaces it.
const readiness = (overrides = {}) =>
  ["draft", "freeze", "sender", "test"].map((key) => ({ key, done: overrides[key] ?? true }));

test("assignee, due date, blocked reason and status bounds refuse bad values", () => {
  const { checkAssignee, checkDueAt, checkBlockedReason, checkWorkStatus } = domain;
  expect(() => checkAssignee("Ada Lovelace")).not.toThrow();
  for (const bad of ["", " Ada", "Ada ", "<Ada>", "x".repeat(81), "Ada\u0000"]) {
    expect(() => checkAssignee(bad)).toThrow();
  }
  for (const bad of ["", "2026-2-3", "2026-02-30", "2026-13-01", "01-02-2026", " 2026-02-03"]) {
    expect(() => checkDueAt(bad)).toThrow();
  }
  expect(() => checkDueAt("2024-02-29")).not.toThrow();
  expect(() => checkDueAt("2026-02-28")).not.toThrow();
  expect(() => checkBlockedReason("")).toThrow();
  expect(() => checkBlockedReason("x".repeat(201))).toThrow();
  expect(checkWorkStatus("blocked")).toBe("blocked");
  expect(() => checkWorkStatus("Blocked")).toThrow();
});

test("applyWorkWrite records attribution, revisions and the content binding", () => {
  const { applyWorkWrite } = domain;
  const first = applyWorkWrite(
    null,
    { assignee: "Ada", dueAt: "2026-11-01", status: "in_progress" },
    { actor: "operator", at: AT },
    4,
  );
  expect(first.revision).toBe(1);
  expect(first.assignee).toBe("Ada");
  expect(first.assignedBy).toBe("operator");
  expect(first.assignedAt).toBe(AT);
  expect(first.contentRevision).toBe(4);
  expect(first.dueAt).toBe("2026-11-01");
  expect(first.status).toBe("in_progress");
  expect(first.updatedAt).toBe(AT);

  // A due-date-only write keeps the existing assignment provenance.
  const second = applyWorkWrite(first, { dueAt: "2026-11-05" }, { actor: "agent", at: LATER }, 5);
  expect(second.revision).toBe(2);
  expect(second.assignee).toBe("Ada");
  expect(second.assignedBy).toBe("operator");
  expect(second.assignedAt).toBe(AT);
  expect(second.dueAt).toBe("2026-11-05");
  expect(second.contentRevision).toBe(5);

  // Unassigning is itself an attributed decision.
  const third = applyWorkWrite(second, { assignee: null }, { actor: "agent", at: LATER }, 5);
  expect(third.revision).toBe(3);
  expect(third.assignee).toBeNull();
  expect(third.assignedBy).toBe("agent");
  expect(third.assignedAt).toBe(LATER);
});

test("applyWorkWrite clears the block on resume and refuses an orphan reason", () => {
  const { applyWorkWrite } = domain;
  const blocked = applyWorkWrite(record({ status: "blocked", blockedReason: "waiting on legal" }), { status: "in_progress" }, { actor: "operator", at: LATER }, 4);
  expect(blocked.status).toBe("in_progress");
  expect(blocked.blockedReason).toBeNull();
  expect(() => applyWorkWrite(record(), { blockedReason: "no owner" }, { actor: "operator", at: LATER }, 4)).toThrow();
  expect(() => applyWorkWrite(record(), { status: "blocked", blockedReason: "" }, { actor: "operator", at: LATER }, 4)).toThrow();
  expect(() => applyWorkWrite(record(), { revision: 9 }, { actor: "operator", at: LATER }, 4)).toThrow();
  // A null content revision leaves the previous binding untouched.
  expect(applyWorkWrite(record(), { dueAt: "2026-12-01" }, { actor: "operator", at: LATER }, null).contentRevision).toBe(4);
});

test("stale revisions refuse with 409 and never expose a fallback token", () => {
  const { isStaleRevision, assertWorkRevision } = domain;
  expect(isStaleRevision(null, 0)).toBe(false);
  expect(isStaleRevision(null, 1)).toBe(true);
  expect(isStaleRevision(record({ revision: 2 }), 2)).toBe(false);
  expect(isStaleRevision(record({ revision: 2 }), 1)).toBe(true);
  expect(isStaleRevision(record({ revision: 2 }), -1)).toBe(true);
  expect(isStaleRevision(record({ revision: 2 }), 1.5)).toBe(true);
  let refusal;
  try {
    assertWorkRevision(record({ revision: 2 }), 1);
  } catch (error) {
    refusal = error;
  }
  expect(refusal?.status).toBe(409);
  expect(refusal?.code).toBe("stale_revision");
  expect(() => assertWorkRevision(record({ revision: 2 }), 2)).not.toThrow();
});

test("parseWorkView accepts only the closed fact shape", () => {
  const { parseWorkView, WORK_CONTRACT } = domain;
  const empty = parseWorkView({
    contract: WORK_CONTRACT,
    source: { app: "crm", install_id: "inst-1", context_id: "ctx-1" },
    campaign_id: "welcome",
    work: null,
    content: { revision: 3, digest: DIGEST },
  });
  expect(empty.work).toBeNull();
  expect(empty.source).toEqual({ app: "crm", installId: "inst-1", contextId: "ctx-1" });
  expect(empty.content).toEqual({ revision: 3, digest: DIGEST });

  const full = parseWorkView({
    contract: WORK_CONTRACT,
    source: { app: "crm", install_id: "inst-1", context_id: null },
    campaign_id: "welcome",
    work: {
      revision: 2,
      content_revision: 3,
      assignee: "Ada",
      assigned_by: "operator",
      assigned_at: AT,
      due_at: "2026-11-01",
      status: "blocked",
      blocked_reason: "waiting on legal",
      updated_at: LATER,
    },
    content: null,
  });
  expect(full.work).toEqual(record({ revision: 2, contentRevision: 3, status: "blocked", blockedReason: "waiting on legal", updatedAt: LATER }));

  const base = {
    contract: WORK_CONTRACT,
    source: { app: "crm", install_id: "inst-1", context_id: null },
    campaign_id: "welcome",
    work: null,
    content: null,
  };
  expect(() => parseWorkView({ ...base, contract: "crm-campaign-work/v2" })).toThrow();
  expect(() => parseWorkView({ ...base, next_decision: { key: "send" } })).toThrow();
  expect(() => parseWorkView({ ...base, source: { ...base.source, app: "other" } })).toThrow();
  expect(() => parseWorkView({ ...base, source: { app: "crm", install_id: "bad id" } })).toThrow();
  expect(() => parseWorkView({ ...base, campaign_id: "bad id" })).toThrow();
  expect(() => parseWorkView({ ...base, content: { revision: 0, digest: DIGEST } })).toThrow();
  expect(() => parseWorkView({ ...base, content: { revision: 1, digest: "sha256:not-hex" } })).toThrow();
  expect(() => parseWorkView({ ...base, work: wireWork({ status: "Blocked" }) })).toThrow();
  expect(() => parseWorkView({ ...base, work: wireWork({ updated_at: "yesterday" }) })).toThrow();
  expect(() => parseWorkView({ ...base, work: wireWork({ revision: 0 }) })).toThrow();
  expect(() => parseWorkView({ ...base, work: { ...wireWork(), next_decision: { key: "send" } } })).toThrow();
  expect(() => parseWorkView({ ...base, work: wireWork({ due_at: "2026-02-30" }) })).toThrow();
  expect(() => parseWorkView({ ...base, work: wireWork({ assigned_at: null, assigned_by: null }) })).not.toThrow();
});

test("nextDecision follows the recorded lifecycle first, then the readiness chain", () => {
  const { nextDecision, readinessFacts } = domain;
  const closed = (facts) => nextDecision(record({ status: "done" }), facts);
  const facts = readinessFacts(readiness());
  expect(facts).toEqual({ draft: true, audience_valid: true, sender_live: true, test_accepted: true });
  expect(nextDecision(record(), facts).key).toBe("send");
  expect(closed(facts).key).toBe("closed");
  expect(nextDecision(record({ status: "cancelled" }), facts).key).toBe("closed");

  const emptyWork = readinessFacts(readiness());
  expect(nextDecision(null, emptyWork).key).toBe("send");

  const blocked = nextDecision(record({ status: "blocked", blockedReason: "waiting on legal" }), facts);
  expect(blocked.key).toBe("unblock");
  expect(blocked.reason).toBe("waiting on legal");
  expect(blocked.label).toContain("waiting on legal");

  const order = [
    ["draft", { draft: false }],
    ["audience", { freeze: false }],
    ["sender", { sender: false }],
    ["test", { test: false }],
  ];
  for (const [key, overrides] of order) {
    expect(nextDecision(record(), readinessFacts(readiness(overrides))).key).toBe(key);
  }
  // A missing chain answer is "not recorded", never a failed check.
  expect(nextDecision(record(), readinessFacts([])).key).toBe("unknown");
  expect(readinessFacts([])).toEqual({ draft: null, audience_valid: null, sender_live: null, test_accepted: null });
});

test("campaignWorkRead returns recorded values with a source-qualified identity", () => {
  const { campaignWorkRead, WORK_CONTRACT, workIdentity, workLink } = domain;
  const response = campaignWorkRead({
    source: { app: "crm", installId: "inst-1", contextId: "ctx-1" },
    campaignId: "welcome",
    work: record(),
    content: { revision: 4, digest: DIGEST },
    readiness: { draft: true, audience_valid: true, sender_live: true, test_accepted: true },
    access: "authorized",
  });
  expect(response.contract).toBe(WORK_CONTRACT);
  expect(response.state).toBe("ok");
  expect(response.source).toEqual({ app: "crm", install_id: "inst-1", context_id: "ctx-1" });
  expect(response.identity).toBe(workIdentity({ app: "crm", installId: "inst-1", contextId: "ctx-1" }, "welcome"));
  expect(response.identity).toBe("crm:inst-1:ctx-1:welcome");
  expect(response.campaign).toEqual({ id: "welcome", link: workLink("welcome") });
  expect(response.campaign.link).toBe("crm:campaigns/welcome");
  expect(response.revision).toBe(1);
  expect(response.content_revision).toBe(4);
  expect(response.assignment).toEqual({ assignee: "Ada", assigned_by: "operator", assigned_at: AT });
  expect(response.due_at).toBe("2026-11-01");
  expect(response.lifecycle).toEqual({ status: "in_progress", blocked_reason: null, updated_at: AT });
  expect(response.next_decision?.key).toBe("send");
  expect(response.unavailable).toEqual([]);
  expect(response.refusal).toBeNull();
});

test("a campaign without recorded work is unavailable, never inferred", () => {
  const { campaignWorkRead } = domain;
  const response = campaignWorkRead({
    source: { app: "crm", installId: "inst-1", contextId: null },
    campaignId: "welcome",
    work: null,
    content: { revision: 2, digest: DIGEST },
    readiness: { draft: true, audience_valid: false, sender_live: true, test_accepted: false },
    access: "authorized",
  });
  expect(response.state).toBe("unavailable");
  expect(response.revision).toBeNull();
  expect(response.assignment).toBeNull();
  expect(response.due_at).toBeNull();
  expect(response.lifecycle).toBeNull();
  expect(response.unavailable).toEqual(["assignee", "assigned_by", "assigned_at", "due_at", "status", "blocked_reason"]);
  // The campaign's own readiness still yields a decision.
  expect(response.next_decision?.key).toBe("audience");
  expect(response.identity).toBe("crm:inst-1:-:welcome");
});

test("partial records list exactly the values they do not have", () => {
  const { campaignWorkRead } = domain;
  const response = campaignWorkRead({
    source: { app: "crm", installId: "inst-1", contextId: null },
    campaignId: "welcome",
    work: record({ dueAt: null, status: null, assignedBy: null, assignedAt: null, assignee: null }),
    content: null,
    readiness: { draft: true, audience_valid: true, sender_live: true, test_accepted: true },
    access: "authorized",
  });
  expect(response.state).toBe("ok");
  expect(response.unavailable).toEqual(["assignee", "assigned_by", "assigned_at", "due_at", "status"]);
  const noReadiness = campaignWorkRead({
    source: { app: "crm", installId: "inst-1", contextId: null },
    campaignId: "welcome",
    work: record(),
    content: null,
    readiness: null,
    access: "authorized",
  });
  expect(noReadiness.state).toBe("partial");
  expect(noReadiness.next_decision).toBeNull();
  expect(noReadiness.unavailable).toEqual(["next_decision"]);
});

test("forbidden and stale reads refuse with no values", () => {
  const { campaignWorkRead } = domain;
  const input = {
    source: { app: "crm", installId: "inst-1", contextId: null },
    campaignId: "welcome",
    work: record(),
    content: { revision: 4, digest: DIGEST },
    readiness: { draft: true, audience_valid: true, sender_live: true, test_accepted: true },
  };
  const forbidden = campaignWorkRead({ ...input, access: "forbidden" });
  expect(forbidden.state).toBe("forbidden");
  expect(forbidden.refusal?.code).toBe("forbidden");
  expect(forbidden.assignment).toBeNull();
  expect(forbidden.next_decision).toBeNull();
  expect(forbidden.revision).toBeNull();
  expect(forbidden.unavailable).toContain("next_decision");

  const stale = campaignWorkRead({ ...input, access: "authorized", expectedRevision: 0 });
  expect(stale.state).toBe("stale");
  expect(stale.refusal?.code).toBe("stale_revision");
  expect(stale.revision).toBe(1);
  expect(stale.assignment).toBeNull();
  expect(stale.next_decision).toBeNull();

  const current = campaignWorkRead({ ...input, access: "authorized", expectedRevision: 1 });
  expect(current.state).toBe("ok");
});

test("identical campaign ids in different installations never collide", () => {
  const { workIdentity } = domain;
  const a = workIdentity({ app: "crm", installId: "inst-a", contextId: null }, "welcome");
  const b = workIdentity({ app: "crm", installId: "inst-b", contextId: null }, "welcome");
  const c = workIdentity({ app: "crm", installId: "inst-a", contextId: "ctx-1" }, "welcome");
  expect(new Set([a, b, c]).size).toBe(3);
});
