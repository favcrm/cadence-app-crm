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
  expect(consent.profile).toEqual({ consent: { email: "granted", sms: "unknown" } });
  expect({ ...existing, ...consent.profile }).toEqual({
    ...existing, consent: { email: "granted", sms: "unknown" },
  });
});

test("withdrawal patches only consent even when unrelated host data cannot be edited by this form", () => {
  const existing = {
    display_name: "Ada",
    website: "ftp://example.test/file",
    tags: ["legacy"],
    consent: { email: "granted", sms: "unknown" },
  };
  const change = profile.buildConsentChange(existing, {
    email: "denied", sms: "unknown", method: "", note: "",
  });
  expect(change).toEqual({
    profile: { consent: { email: "denied", sms: "unknown" } },
    provenance: null,
  });
  expect({ ...existing, ...change.profile }).toEqual({
    ...existing, consent: { email: "denied", sms: "unknown" },
  });
});

test("a consent note is never silently discarded when its method is missing", () => {
  const current = { display_name: "Ada", tags: [], consent: { email: "granted", sms: "unknown" } };
  const withdrawal = { email: "denied", sms: "unknown", method: "", note: "Opt-out request" };
  expect(() => profile.buildConsentChange(current, withdrawal)).toThrow();
  expect(profile.buildConsentChange(current, { ...withdrawal, method: "written" }).provenance)
    .toEqual({ method: "written", note: "Opt-out request" });
  expect(profile.buildConsentChange(current, { ...withdrawal, note: "" }).provenance).toBeNull();
  expect(() => profile.buildCreateProvenance("", "Signed form")).toThrow();
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
  expect(items.map(({ kind, actor, revision, note }) => ({ kind, actor, revision, note }))).toEqual([
    { kind: "note", actor: "assistant", revision: undefined, note: undefined },
    { kind: "consent", actor: "Morgan", revision: 2, note: "Signed form" },
    { kind: "revision", actor: "Morgan", revision: 2, note: undefined },
  ]);
});

test("reused revision numbers do not mix another activity's changes or consent note", () => {
  const state = (email, consent) => ({ email, consent: { email: consent, sms: "unknown" } });
  const [newer, older] = profile.activityItems(record({
    profile: state("new@example.test", "granted"),
    history: [
      { revision: 2, digest: DIGEST, actor: "Morgan", at: 30,
        before: state("middle@example.test", "denied"), after: state("new@example.test", "granted"),
        provenance: { method: "written", note: "Signed form" } },
      { revision: 2, digest: DIGEST, actor: "Robin", at: 10,
        before: state("old@example.test", "granted"), after: state("middle@example.test", "denied"),
        provenance: { method: "written", note: "Opt-out request" } },
    ],
    consentHistory: [],
  }));
  expect(newer.key).not.toBe(older.key);
  expect(newer.actor).toBe("Morgan");
  expect(newer.note).toBe("Signed form");
  expect(newer.changes).toContainEqual({ field: "Email", before: "middle@example.test", after: "new@example.test" });
  expect(older.actor).toBe("Robin");
  expect(older.note).toBe("Opt-out request");
  expect(older.changes).toContainEqual({ field: "Email", before: "old@example.test", after: "middle@example.test" });
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
