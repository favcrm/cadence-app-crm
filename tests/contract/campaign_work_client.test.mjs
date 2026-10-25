// CRM-12 campaign-work client: the wire body is closed and revision-bound.
// Run: bun test tests/contract/campaign_work_client.test.mjs
//
// The real bridge modules run unchanged; @cadence/screen-ui is the shared
// stub because only the browser frame supplies it. `channel.request` is
// observed directly so the test sees the exact operation and body a real
// host would receive — no live host, no retry, no synthetic rows.

import { test, expect, beforeAll, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

const DIGEST = "sha256:" + "a".repeat(64);
const scope = { installId: "inst-1", digest: DIGEST };
let screenUi;
let scopeModule;
let channelModule;
let client;
const calls = [];

const projection = (actions) => ({
  v: 1,
  op: "push",
  install_id: "inst-1",
  digest: DIGEST,
  tag: "crm",
  installation: { install_id: "inst-1", name: "crm", title: "CRM", version: "0.2.1", digest: DIGEST, summary: "s" },
  runs: [],
  outbox: [],
  publish_intents: [],
  sources: [],
  defaults: [],
  readiness: [],
  actions,
  now: "2026-10-25T00:00:00Z",
  resume: null,
  route: { section: "campaigns", view: "list", record_id: null, segment_id: null },
  read_observations: [],
});

beforeAll(async () => {
  screenUi = await import("@cadence/screen-ui");
  scopeModule = await import("../../src/bridge/scope.ts");
  channelModule = await import("../../src/bridge/channel.ts");
  client = await import("../../src/features/crm/campaignWorkClient.ts");
  scopeModule.acceptPush(projection(["campaign-work.show", "campaign-work.save"]));
  channelModule.channel.request = (kind, verb, args) => {
    calls.push({ kind, verb, args });
    return Promise.resolve({});
  };
});

const expectThrows = (fn, pattern) => {
  let failure;
  try {
    fn();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (pattern !== undefined) expect(failure.message).toMatch(pattern);
};

test("show sends only the campaign id", async () => {
  const before = calls.length;
  await client.campaignWorkClient.show(scope, "welcome");
  expect(calls.length).toBe(before + 1);
  expect(calls.at(-1)).toEqual({ kind: "call", verb: "campaign-work.show", args: { campaign_id: "welcome" } });
});

test("save sends exactly the closed body with the revision it read", async () => {
  const before = calls.length;
  await client.campaignWorkClient.save(scope, {
    campaignId: "welcome",
    expectedRevision: 0,
    assignee: "Ada",
    dueAt: "2026-11-01",
    status: "blocked",
    blockedReason: "waiting on legal",
  });
  expect(calls.length).toBe(before + 1);
  expect(calls.at(-1)).toEqual({
    kind: "call",
    verb: "campaign-work.save",
    args: {
      campaign_id: "welcome",
      expected_revision: 0,
      assignee: "Ada",
      due_at: "2026-11-01",
      status: "blocked",
      blocked_reason: "waiting on legal",
    },
  });
});

test("an unassign is an explicit null, never an omitted field", async () => {
  await client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 3, assignee: null });
  expect(calls.at(-1).args).toEqual({ campaign_id: "welcome", expected_revision: 3, assignee: null });
});

test("the revision is mandatory and must be a non-negative integer", () => {
  expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", assignee: "Ada" }), /revision/);
  for (const bad of [-1, 1.5, Number.NaN, "2", null]) {
    expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: bad, assignee: "Ada" }));
  }
});

test("authority, provenance and derived fields never travel from the frame", () => {
  const base = { campaignId: "welcome", expectedRevision: 1, assignee: "Ada" };
  for (const key of ["actor", "by", "owner", "assigned_by", "assigned_at", "revision", "updated_at", "content_revision", "next_decision", "link", "install_id", "context_id"]) {
    expectThrows(() => client.campaignWorkClient.save(scope, { ...base, [key]: "forged" }));
  }
});

test("grammar checks refuse before any request is issued", () => {
  const before = calls.length;
  expectThrows(() => client.campaignWorkClient.show(scope, "bad id"), /campaign ID/);
  expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 1, assignee: "" }), /plain text/);
  expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 1, dueAt: "2026-02-30" }), /calendar day/);
  expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 1, status: "Blocked" }));
  expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 1, blockedReason: "legal" }), /blocked status/);
  expectThrows(() => client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 1 }), /at least one value/);
  expect(calls.length).toBe(before);
});

test("a stale refusal reaches the caller unchanged and is never retried", async () => {
  let attempts = 0;
  channelModule.channel.request = () => {
    attempts += 1;
    return Promise.reject(new screenUi.ApiError("These campaign work details changed.", 409, { code: "stale_revision" }));
  };
  let failure;
  try {
    await client.campaignWorkClient.save(scope, { campaignId: "welcome", expectedRevision: 1, assignee: "Ada" });
  } catch (error) {
    failure = error;
  }
  expect(failure?.status).toBe(409);
  expect(failure?.code).toBe("stale_revision");
  expect(attempts).toBe(1);
});

test("a forbidden read reaches the caller unchanged", async () => {
  channelModule.channel.request = () => Promise.reject(new screenUi.ApiError("no access", 403, { code: "forbidden" }));
  let failure;
  try {
    await client.campaignWorkClient.show(scope, "welcome");
  } catch (error) {
    failure = error;
  }
  expect(failure?.status).toBe(403);
});

test("the operations are refused when the host does not advertise them", async () => {
  scopeModule.acceptPush(projection([]));
  let failure;
  try {
    await client.campaignWorkClient.show(scope, "welcome");
  } catch (error) {
    failure = error;
  }
  expect(failure?.status).toBe(403);
  // Restore the admitted projection for any later test.
  scopeModule.acceptPush(projection(["campaign-work.show", "campaign-work.save"]));
});
