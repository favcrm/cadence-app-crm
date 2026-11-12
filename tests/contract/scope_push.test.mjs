// Contract tests for the host scope push: context is optional and never a
// scope dimension. Accepted shapes: real id, "" with contexts [], or both
// fields absent. A malformed non-empty id is still refused.
// Run: bun test tests/contract/scope_push.test.mjs

import { test, expect, beforeAll, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let createChannel;
let scope;
beforeAll(async () => {
  ({ createChannel } = await import("../../src/bridge/channel.ts"));
  scope = await import("../../src/bridge/scope.ts");
});

const DIGEST = "sha256:" + "a".repeat(64);
const boot = {
  tag: "crm",
  bridge_nonce: "c".repeat(64),
  generation: 1,
  parent_origin: "https://board.example",
};

const base = (extra = {}) => ({
  v: 2,
  op: "screen",
  install_id: "inst-1",
  digest: DIGEST,
  tag: "crm",
  installation: { install_id: "inst-1", name: "crm", title: "CRM", version: "0.4.0", digest: DIGEST, summary: "s" },
  runs: [],
  outbox: [],
  publish_intents: [],
  sources: [],
  defaults: [],
  readiness: [],
  actions: [],
  now: "2026-10-21T00:00:00Z",
  resume: null,
  route: { section: "customers", view: "list", record_id: null, segment_id: null },
  read_observations: [],
  ...extra,
});

async function sendPush(payload) {
  scope.clearScope("reset");
  let host;
  const events = [];
  const parent = {
    postMessage(message, _origin, transfer) {
      if (message.op !== "init") return;
      host = transfer?.[0];
      host.onmessage = (event) => events.push(event.data);
      host.start?.();
    },
  };
  const ch = createChannel();
  ch.start({ boot, parent, window: { parent, addEventListener() {} } });
  for (let i = 0; i < 100 && !events.some((e) => e.op === "ready"); i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  host.postMessage(payload);
  for (let i = 0; i < 100 && scope.getScope() === null && scope.scopeError() === null; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return ch;
}

test("accepts a real context id (today's host)", async () => {
  const ch = await sendPush(base({ context_id: "ctx-real", contexts: [{ id: "ctx-real", label: "Main" }] }));
  expect(scope.scopeError()).toBeNull();
  expect(scope.getScope()?.scope.installId).toBe("inst-1");
  ch.resetForTests();
});

test('accepts context_id "" with contexts []', async () => {
  const ch = await sendPush(base({ context_id: "", contexts: [] }));
  expect(scope.scopeError()).toBeNull();
  expect(scope.getScope()?.scope.installId).toBe("inst-1");
  ch.resetForTests();
});

test("accepts both context fields absent", async () => {
  const ch = await sendPush(base());
  expect(scope.scopeError()).toBeNull();
  expect(scope.getScope()?.scope.installId).toBe("inst-1");
  ch.resetForTests();
});

test("refuses a malformed non-empty context id", async () => {
  const ch1 = await sendPush(base({ context_id: "bad id with spaces" }));
  expect(scope.getScope()).toBeNull();
  expect(scope.scopeError()).toContain("Invalid screen scope projection");
  ch1.resetForTests();

  const ch2 = await sendPush(base({ context_id: "x".repeat(129) }));
  expect(scope.getScope()).toBeNull();
  expect(scope.scopeError()).toContain("Invalid screen scope projection");
  ch2.resetForTests();
});

test("validates contexts entries only when present", async () => {
  const ch1 = await sendPush(base({ contexts: [{ id: "ok", label: 3 }] }));
  expect(scope.getScope()).toBeNull();
  expect(scope.scopeError()).toContain("Invalid screen scope projection");
  ch1.resetForTests();

  const ch2 = await sendPush(base({ contexts: "not-an-array" }));
  expect(scope.getScope()).toBeNull();
  expect(scope.scopeError()).toContain("Invalid screen scope projection");
  ch2.resetForTests();
});

test("refuses an installation whose install/digest disagrees with the push", async () => {
  const ch1 = await sendPush(base({ installation: { ...base().installation, install_id: "other" } }));
  expect(scope.getScope()).toBeNull();
  expect(scope.scopeError()).toContain("Invalid screen scope projection");
  ch1.resetForTests();

  const ch2 = await sendPush(base({ installation: { ...base().installation, digest: "sha256:" + "c".repeat(64) } }));
  expect(scope.getScope()).toBeNull();
  expect(scope.scopeError()).toContain("Invalid screen scope projection");
  ch2.resetForTests();
});

test("assertCurrentScope compares install + digest only", async () => {
  const ch = await sendPush(base({ context_id: "ctx-a" }));
  const snap = scope.getScope();
  expect(snap).not.toBeNull();
  expect(() => scope.assertCurrentScope({ installId: "inst-1", digest: DIGEST })).not.toThrow();
  expect(() => scope.assertCurrentScope({ installId: "other", digest: DIGEST })).toThrow();
  expect(() => scope.assertCurrentScope({ installId: "inst-1", digest: "sha256:" + "b".repeat(64) })).toThrow();
  expect(Object.hasOwn(snap.scope, "contextId")).toBe(false);
  ch.resetForTests();
});
