// CRM-16 pure logic: draft audience parsing, subject preview, send status,
// readiness and the freeze id. Run: bun test tests/unit/campaign_polish.test.mjs
import { test, expect, beforeAll, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let g, status, ready, model, chain, sdk;
beforeAll(async () => {
  g = await import("../../src/features/crm/campaignGrammar.ts");
  status = await import("../../src/features/crm/campaign/sendStatus.ts");
  ready = await import("../../src/features/crm/campaign/readiness.ts");
  model = await import("../../src/features/crm/campaigns/audienceModel.ts");
  chain = await import("../../src/features/crm/campaign/sendChain.ts");
  sdk = await import("@cadence/screen-ui");
});

const row = (extra = {}) => ({ content: { campaign_id: "c1", revision: 2, subject: "s", preheader: "", blocks: [], content_digest: "d", ...extra } });

test("draft audience: absent key means the board cannot keep one", () => {
  const doc = g.parseContentDoc(row());
  expect(doc.draftAudience).toBeUndefined();
});
test("draft audience: null, all, segment, custom parse", () => {
  expect(g.parseContentDoc(row({ draft_audience_full: null })).draftAudience).toBeNull();
  expect(g.parseContentDoc(row({ draft_audience_full: { mode: "all" } })).draftAudience).toEqual({ mode: "all" });
  expect(g.parseContentDoc(row({ draft_audience_full: { mode: "segment", segment_id: "s1" } })).draftAudience).toEqual({ mode: "segment", segmentId: "s1" });
  expect(g.parseContentDoc(row({ draft_audience_full: { mode: "custom", customer_ids: ["a", "b"] } })).draftAudience).toEqual({ mode: "custom", customerIds: ["a", "b"] });
});
test("draft audience: malformed is refused, not guessed", () => {
  for (const bad of [{ mode: "everyone" }, { mode: "segment" }, { mode: "segment", segment_id: "" }, { mode: "custom", customer_ids: [] }, { mode: "custom", customer_ids: [1] }, { mode: "custom", customer_ids: Array(101).fill("x") }, [], "all", 3]) {
    expect(() => g.parseContentDoc(row({ draft_audience_full: bad }))).toThrow();
  }
});
test("legacy segment hint is read separately and never becomes the full field", () => {
  const doc = g.parseContentDoc(row({ draft_audience: { mode: "segment", segment_id: "s9" } }));
  expect(doc.draftAudience).toBeUndefined();
  expect(doc.legacySegmentId).toBe("s9");
});
test("wire shape and equality", () => {
  expect(g.draftAudienceWire(null)).toBeNull();
  expect(g.draftAudienceWire({ mode: "custom", customerIds: ["a"] })).toEqual({ mode: "custom", customer_ids: ["a"] });
  expect(g.sameAudience({ mode: "custom", customerIds: ["b", "a"] }, { mode: "custom", customerIds: ["a", "b"] })).toBe(true);
  expect(g.sameAudience({ mode: "all" }, null)).toBe(false);
  expect(g.sameAudience(null, undefined)).toBe(true);
});
test("subject preview uses the sample name, else the token's fallback", () => {
  const s = "Spring offer for {{first_name|Friend}}!";
  expect(g.previewSubject(s, "Ada")).toBe("Spring offer for Ada!");
  expect(g.previewSubject(s, "  ")).toBe("Spring offer for Friend!");
  expect(g.previewSubject("Hi {{first_name|Pal}} {{first_name|Pal}}", "Al")).toBe("Hi Al Al");
  expect(g.previewSubject("No token {{ oops", "Al")).toBe("No token {{ oops");
  expect(g.summarySubject(s)).toBe("Spring offer for {first name}!");
});

const send = (state, counts = {}, created = 1) => ({ sendId: `s${created}`, campaignId: "c1", state, created, counts: { queued: 0, submitting: 0, accepted: 0, failed: 0, uncertain: 0, suppressed: 0, closed: 0, ...counts } });
test("status comes from real sends", () => {
  expect(status.campaignStatus(null)).toBeNull();
  expect(status.campaignStatus([]).key).toBe("draft");
  expect(status.campaignStatus([send("prepared")]).key).toBe("draft");
  expect(status.campaignStatus([send("sending", { queued: 3 })]).label).toBe("Sending");
  expect(status.campaignStatus([send("completed", { accepted: 9 })]).label).toBe("Sent");
  expect(status.campaignStatus([send("completed", { accepted: 9, failed: 1 })]).label).toBe("Sent, some failed");
  expect(status.campaignStatus([send("completed", { accepted: 9, uncertain: 1 })]).label).toBe("Check result");
  expect(status.campaignStatus([send("closed", { accepted: 2 })]).label).toBe("Check result");
  expect(status.campaignStatus([send("mystery")]).label).toBe("Check result");
});
test("status uses the newest sent send and ignores a later prepared one", () => {
  const rows = [send("completed", { accepted: 5 }, 1), send("sending", {}, 2), send("prepared", {}, 3)];
  expect(status.campaignStatus(rows).key).toBe("sending");
});

const doc = { revision: 2, contentDigest: "d" };
const binding = { state: "live", digest: "L" };
const receipt = { contentRevision: 2, contentDigest: "d", linkDigest: "L", accepted: true, pendingApproval: false };
test("readiness reports the first blocker in order", () => {
  const items = (o) => ready.sendReadiness({ doc, binding, testEvidence: receipt, audience: { state: "ready", count: 3 }, ...o });
  expect(ready.firstBlocker(items({}))).toBeNull();
  expect(ready.firstBlocker(items({ audience: { state: "unchosen" }, testEvidence: null }))).toBe("Choose an audience first.");
  expect(ready.firstBlocker(items({ testEvidence: null }))).toBe("Send a test email first.");
  expect(ready.firstBlocker(items({ binding: { state: "live", digest: "M" } }))).toBe("The sender changed. Send a new test, then send.");
  expect(ready.firstBlocker(items({ testEvidence: { ...receipt, contentRevision: 1 } }))).toBe("The email changed since the last test. Send a new test, then send.");
  expect(ready.firstBlocker(items({ binding: null }))).toBe("Connect a sender first.");
  expect(ready.firstBlocker(items({ testEvidence: { ...receipt, accepted: false } }))).toBe("The last test wasn't accepted. Send a new test, then send.");
  expect(ready.firstBlocker(items({ testEvidence: { ...receipt, accepted: false, pendingApproval: true } }))).toBe("Approve the test email in AgenticOS, then send it again.");
  expect(ready.firstBlocker(items({ audience: { state: "counting" } }))).toBe("Counting who can receive this…");
});
test("an unchosen audience has no freeze id", () => {
  expect(model.audienceFreezeId("c1", { base: null, exclusionListId: null }, 20)).toBeNull();
  expect(model.audienceFreezeId("c1", { base: { mode: "all" }, exclusionListId: null }, 20)).toMatch(/^c1-freeze-/);
});
test("a send waits while the audience choice is still being saved", () => {
  const items = ready.sendReadiness({ doc, binding, testEvidence: receipt, audience: { state: "saving" } });
  expect(ready.firstBlocker(items)).toBe("Saving your audience choice…");
  const failed = ready.sendReadiness({ doc, binding, testEvidence: receipt, audience: { state: "unsaved" } });
  expect(ready.firstBlocker(failed)).toBe("Your audience choice wasn't saved. Open Audience and retry.");
});

test("a send in which nothing was accepted is never called sent", () => {
  expect(status.campaignStatus([send("completed", { failed: 124 })]).label).toBe("Not sent, all failed");
  expect(status.campaignStatus([send("completed", { failed: 124 })]).key).toBe("failed");
  expect(status.campaignStatus([send("completed", { suppressed: 5 })]).label).toBe("Nothing sent");
  expect(status.campaignStatus([send("completed", {})]).label).toBe("Nothing sent");
  expect(status.campaignStatus([send("completed", { failed: 3, suppressed: 2 })]).key).toBe("failed");
  // still sent / partial once anything was accepted
  expect(status.campaignStatus([send("completed", { accepted: 1, failed: 123 })]).label).toBe("Sent, some failed");
  expect(status.campaignStatus([send("completed", { accepted: 1 })]).label).toBe("Sent");
});

test("send chain guards", () => {
  expect(chain.audienceChanged("c-freeze-1", "c-freeze-1")).toBe(false);
  expect(chain.audienceChanged("c-freeze-1", "c-freeze-2")).toBe(true);
  expect(chain.audienceChanged("c-freeze-1", null)).toBe(true);
  expect(chain.audienceChanged(null, null)).toBe(true);
  expect(chain.countChanged(124, 124)).toBe(false);
  expect(chain.countChanged(124, 120)).toBe(true);
  expect(chain.countChanged(null, 5)).toBe(true);
  expect(chain.canStart(null)).toBe(true);
  for (const phase of ["approving", "preparing", "confirming"]) expect(chain.canStart(phase)).toBe(false);
  expect(chain.isCancelled(new sdk.ApiError("Cancelled.", 400, { code: "cancelled" }))).toBe(true);
  expect(chain.isCancelled(new sdk.ApiError("Refused.", 400, { code: "failed" }))).toBe(false);
  expect(chain.isCancelled(new Error("cancelled"))).toBe(false);
});

test("a send waits for unsaved email edits when a new audience is pending", () => {
  const items = ready.sendReadiness({ doc, binding, testEvidence: receipt, audience: { state: "email-unsaved" } });
  expect(ready.firstBlocker(items)).toBe("Save or discard your email changes first.");
});
