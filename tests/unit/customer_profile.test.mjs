// CRM app-owned profile shaping and consent timeline projection.
// Run: bun test tests/unit/customer_profile.test.mjs
//
// The module imports ApiError from @cadence/screen-ui and a local error
// helper; no React component or host bridge is involved.

import { test, expect, beforeAll, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let profile;
beforeAll(async () => {
  profile = await import("../../src/features/crm/customerProfile.ts");
});

const DIGEST = "sha256:" + "a".repeat(64);

const fields = (overrides = {}) => ({
  displayName: "Ada Lovelace",
  email: "",
  phone: "",
  tags: "",
  source: "",
  consentEmail: "unknown",
  consentSms: "unknown",
  ...overrides,
});

const record = (overrides = {}) => ({
  id: "cust-1",
  install_id: "inst-1",
  context_id: "ctx-1",
  kind: "customer",
  revision: 2,
  digest: DIGEST,
  profile: {},
  ...overrides,
});

test("blank optional profile values are explicit null", () => {
  const built = profile.buildCustomerProfile(fields());
  expect(built.schema).toBe(1);
  expect(built.email).toBeNull();
  expect(built.phone).toBeNull();
  expect(built.source).toBeNull();
  expect(built.consent).toEqual({ email: "unknown", sms: "unknown" });
});

test("non-blank optional profile values are carried", () => {
  const built = profile.buildCustomerProfile(
    fields({ email: "ada@example.test", phone: "+44 20 7946 0000", source: "event" }),
  );
  expect(built.email).toBe("ada@example.test");
  expect(built.phone).toBe("+44 20 7946 0000");
  expect(built.source).toBe("event");
});

test("a real explicit consent_history wins over the generic journal", () => {
  const entries = profile.consentEntries(
    record({
      consentHistory: [
        { revision: 1, channel: "email", state: "granted", actor: "operator", at: 5 },
      ],
      history: [
        {
          revision: 1,
          operation: "create",
          actor: "operator",
          at: 5,
          digest: DIGEST,
          before: null,
          after: { consent: { email: "unknown", sms: "unknown" } },
          provenance: null,
        },
      ],
    }),
  );
  expect(entries).toEqual([
    { revision: 1, channel: "email", state: "granted", actor: "operator", at: 5 },
  ]);
});

test("an empty consent_history falls back to generic history transitions", () => {
  const entries = profile.consentEntries(
    record({
      consentHistory: [],
      history: [
        {
          revision: 2,
          operation: "update",
          actor: "Ada",
          at: 20,
          digest: DIGEST,
          before: { consent: { email: "unknown", sms: "denied" } },
          after: { consent: { email: "granted", sms: "denied" } },
          provenance: { method: "web_form", note: "sign-up form" },
        },
        {
          revision: 1,
          operation: "create",
          actor: "operator",
          at: 10,
          digest: DIGEST,
          before: null,
          after: { consent: { email: "unknown", sms: "unknown" } },
          provenance: null,
        },
      ],
    }),
  );
  expect(entries).toEqual([
    { revision: 1, channel: "email", state: "unknown", actor: "operator", at: 10 },
    { revision: 1, channel: "sms", state: "unknown", actor: "operator", at: 10 },
    {
      revision: 2,
      channel: "email",
      state: "granted",
      actor: "Ada",
      at: 20,
      method: "web_form",
      note: "sign-up form",
    },
  ]);
});

test("unchanged consent and malformed history are not projected", () => {
  const entries = profile.consentEntries(
    record({
      consentHistory: [],
      history: [
        { revision: 9, operation: "update", actor: "bad" },
        {
          revision: 2,
          operation: "update",
          actor: "Ada",
          at: 20,
          digest: DIGEST,
          before: { consent: { email: "granted", sms: "unknown" } },
          after: { consent: { email: "granted", sms: "unknown" } },
          provenance: null,
        },
      ],
    }),
  );
  expect(entries).toEqual([]);
});
