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
  customerType: "",
  website: "",
  tags: "",
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
  expect(built).not.toHaveProperty("source");
  expect(built.consent).toEqual({ email: "unknown", sms: "unknown" });
});

test("non-blank optional profile values are carried", () => {
  const built = profile.buildCustomerProfile(
    fields({ email: "ada@example.test", phone: "+44 20 7946 0000" }),
  );
  expect(built.email).toBe("ada@example.test");
  expect(built.phone).toBe("+44 20 7946 0000");
});

test("customer type and website round-trip without treating an organization as a contact", () => {
  const input = fields({ customerType: "organization", website: "https://example.test/about" });
  const saved = profile.buildCustomerProfile(input);
  expect(saved).toMatchObject({ customer_type: "organization", website: "https://example.test/about" });
  expect(profile.formFromProfile({ ...saved })).toMatchObject({
    customerType: "organization", website: "https://example.test/about",
  });
  expect(profile.viewProfile(saved)).toMatchObject({ customerType: "organization", website: "https://example.test/about" });
  expect(() => profile.buildCustomerProfile(fields({ website: "javascript:alert(1)" }))).toThrow();
  expect(() => profile.buildCustomerProfile(fields({ website: "https://user:secret@example.test/" }))).toThrow();
  expect(profile.customerWebsiteHref("javascript:alert(1)")).toBeNull();
});

test("profile edits leave platform-managed source untouched", () => {
  const existing = {
    display_name: "Ada Lovelace",
    email: "ada@example.test",
    phone: null,
    source: "platform_import",
    tags: [],
    consent: { email: "unknown", sms: "unknown" },
  };
  const patch = profile.buildCustomerProfile(profile.formFromProfile(existing));
  expect(patch).not.toHaveProperty("source");
  expect({ ...existing, ...patch }.source).toBe("platform_import");
  const consent = profile.buildConsentChange(existing, {
    email: "granted",
    sms: "unknown",
    method: "written",
    note: "",
  });
  expect(consent.profile).not.toHaveProperty("source");
  expect({ ...existing, ...consent.profile }.source).toBe("platform_import");
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

test("activity details retain the recorded actor, revision and note", () => {
  const items = profile.activityItems(record({
    history: [{ revision: 2, digest: DIGEST, actor: "Morgan", at: 20 }],
    consentHistory: [
      { revision: 2, channel: "email", state: "granted", actor: "Morgan", at: 20, method: "written", note: "Signed form" },
    ],
    notes: [{ id: "note-1", recordId: "cust-1", body: "Discussed renewal", actor: "assistant", created: 30 }],
  }));
  expect(items.map(({ key, kind, actor, revision, note }) => ({ key, kind, actor, revision, note }))).toEqual([
    { key: "n:note-1", kind: "note", actor: "assistant", revision: undefined, note: undefined },
    { key: "r2", kind: "revision", actor: "Morgan", revision: 2, note: "Signed form" },
  ]);
});

test("activity translates the recorded unknown consent state", () => {
  const t = (value) => ({
    Email: "電郵",
    unknown: "未知",
    "{channel} consent recorded as {state}": "{channel}：{state}",
  })[value] ?? value;
  const [item] = profile.activityItems(record({
    history: [{ revision: 1, digest: DIGEST, actor: "operator", at: 10 }],
    consentHistory: [{ revision: 1, channel: "email", state: "unknown", actor: "operator", at: 10 }],
  }), t);
  expect(item.text).toContain("電郵：未知");
});

test("activity details show recorded field changes without exposing other fields", () => {
  const before = {
    display_name: "Ada",
    email: "old@example.test",
    phone: null,
    tags: ["vip"],
    consent: { email: "unknown", sms: "unknown" },
    source: "private-source",
    internal_note: "private-note",
  };
  const after = {
    ...before,
    phone: "+1 202 555 0126",
    tags: ["vip", "renewal"],
    consent: { email: "granted", sms: "unknown" },
  };
  const [item] = profile.activityItems(record({
    profile: after,
    history: [{ revision: 2, digest: DIGEST, actor: "Morgan", at: 20, before, after }],
  }));
  expect(item.changes).toEqual([
    { field: "Phone", before: "Not provided", after: "+1 202 555 0126" },
    { field: "Tags", before: "vip", after: "vip, renewal" },
    { field: "Email marketing", before: "Unknown", after: "Granted" },
  ]);
  expect(JSON.stringify(item)).not.toContain("private-source");
  expect(JSON.stringify(item)).not.toContain("private-note");
});

test("activity does not infer a change when one side was not returned", () => {
  const [missingBefore] = profile.activityItems(record({
    profile: { display_name: "Ada", phone: "+1 202 555 0126" },
    history: [{
      revision: 2,
      digest: DIGEST,
      actor: "Morgan",
      at: 20,
      before: { display_name: "Ada" },
      after: { display_name: "Ada", phone: "+1 202 555 0126" },
    }],
  }));
  expect(missingBefore.changes ?? []).toEqual([]);
  const [hiddenNow] = profile.activityItems(record({
    profile: { display_name: "Ada" },
    history: [{
      revision: 2,
      digest: DIGEST,
      actor: "Morgan",
      at: 20,
      before: { phone: null },
      after: { phone: "+1 202 555 0126" },
    }],
  }));
  expect(hiddenNow.changes ?? []).toEqual([]);
});
