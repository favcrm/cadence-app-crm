// Contract tests for the host scope push: context is optional and never a
// scope dimension. Accepted shapes: real id, "" with contexts [], or both
// fields absent. A malformed non-empty id is still refused.
// Run: bun test tests/contract/scope_push.test.mjs
//
// The bridge imports @cadence/screen-ui, which only the browser frame
// supplies; the shared stub keeps `bun test` coherent when several test
// files run in one process. Real React is used — no bridge module calls a
// hook at import.

import { test, expect, beforeAll, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let scope;
beforeAll(async () => {
  scope = await import("../../src/bridge/scope.ts");
});

const DIGEST = "sha256:" + "a".repeat(64);
const base = (extra = {}) => ({
  v: 1,
  op: "push",
  install_id: "inst-1",
  digest: DIGEST,
  tag: "crm",
  installation: { install_id: "inst-1", name: "crm", title: "CRM", version: "0.1.2", digest: DIGEST, summary: "s" },
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

test("accepts a real context id (today's host)", () => {
  expect(() => scope.acceptPush(base({ context_id: "ctx-real", contexts: [{ id: "ctx-real", label: "Main" }] }))).not.toThrow();
  expect(scope.getScope()?.scope.installId).toBe("inst-1");
});

test('accepts context_id "" with contexts []', () => {
  expect(() => scope.acceptPush(base({ context_id: "", contexts: [] }))).not.toThrow();
});

test("accepts both context fields absent", () => {
  expect(() => scope.acceptPush(base())).not.toThrow();
});

test("refuses a malformed non-empty context id", () => {
  expect(() => scope.acceptPush(base({ context_id: "bad id with spaces" }))).toThrow();
  expect(() => scope.acceptPush(base({ context_id: "x".repeat(129) }))).toThrow();
});

test("validates contexts entries only when present", () => {
  expect(() => scope.acceptPush(base({ contexts: [{ id: "ok", label: 3 }] }))).toThrow();
  expect(() => scope.acceptPush(base({ contexts: "not-an-array" }))).toThrow();
});
test("refuses an installation whose install/digest disagrees with the push", () => {
  expect(() => scope.acceptPush(base({ installation: { ...base().installation, install_id: "other" } }))).toThrow();
  expect(() => scope.acceptPush(base({ installation: { ...base().installation, digest: "sha256:" + "c".repeat(64) } }))).toThrow();
});

test("assertCurrentScope compares install + digest only", () => {
  scope.acceptPush(base({ context_id: "ctx-a" }));
  const snap = scope.getScope();
  expect(snap).not.toBeNull();
  expect(() => scope.assertCurrentScope({ installId: "inst-1", digest: DIGEST })).not.toThrow();
  expect(() => scope.assertCurrentScope({ installId: "other", digest: DIGEST })).toThrow();
  expect(() => scope.assertCurrentScope({ installId: "inst-1", digest: "sha256:" + "b".repeat(64) })).toThrow();
  expect(Object.hasOwn(snap.scope, "contextId")).toBe(false);
});
