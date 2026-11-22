import { beforeAll, expect, mock, test } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);
let contacts;
beforeAll(async () => {
  contacts = await import("../../src/features/crm/customerProfile.ts");
});

const contact = { name: "Alex Chan", title: "Operations lead", email: "alex@example.test", phone: "+1 202 555 0134" };

test("contacts are available only when the host returns a valid collection", () => {
  expect(contacts.readCustomerContacts({})).toBeNull();
  expect(contacts.readCustomerContacts({ contacts: null })).toBeNull();
  expect(contacts.readCustomerContacts({ contacts: [{ name: "Alex", unknown: "keep" }] })).toBeNull();
  expect(contacts.readCustomerContacts({ contacts: [] })).toEqual([]);
  expect(contacts.readCustomerContacts({ contacts: [contact] })).toEqual([contact]);
});

test("host-valid contact text remains intact when another contact changes", () => {
  const raw = {
    name: "\u0000Name\n",
    title: "Role\u007f",
    email: "legacy\nemail",
    phone: "\u0001phone",
  };
  const rows = contacts.readCustomerContacts({ contacts: [raw, contact] });
  expect(rows).toEqual([raw, contact]);
  expect(contacts.changeCustomerContacts(rows, 1, {
    name: "Updated", title: "", email: "", phone: "",
  })).toEqual({ contacts: [raw, { name: "Updated", title: null, email: null, phone: null }] });
  expect(() => contacts.changeCustomerContacts(rows, 1, {
    name: "Bad\u0000name", title: "", email: "", phone: "",
  })).toThrow();
});

test("contact schema string limits count Unicode code points", () => {
  const atLimit = { name: "😀".repeat(120), title: "😀".repeat(120), email: "😀".repeat(254), phone: "😀".repeat(24) };
  expect(contacts.readCustomerContacts({ contacts: [atLimit] })).toEqual([atLimit]);
  for (const field of ["name", "title", "email", "phone"]) {
    expect(contacts.readCustomerContacts({ contacts: [{ ...atLimit, [field]: atLimit[field] + "😀" }] })).toBeNull();
  }
  expect(contacts.readCustomerContacts({ contacts: [{ ...atLimit, name: "" }] })).toBeNull();
  expect(contacts.readCustomerContacts({ contacts: [{ ...atLimit, title: undefined }] })).toBeNull();
  expect(contacts.readCustomerContacts({ contacts: [{ ...atLimit, extra: "unknown" }] })).toBeNull();
});

test("contact edits preserve other entries and validate basic identity details", () => {
  const original = [contact, { name: "Robin Lee", title: null, email: null, phone: null }];
  expect(contacts.changeCustomerContacts(original, 1, {
    name: "Robin Lee", title: "Director", email: " robin@example.test ", phone: "",
  })).toEqual({ contacts: [contact, { name: "Robin Lee", title: "Director", email: "robin@example.test", phone: null }] });
  expect(contacts.changeCustomerContacts(original, 0, null)).toEqual({ contacts: [original[1]] });
  expect(contacts.changeCustomerContacts(original, null, {
    name: "Morgan", title: "", email: "", phone: "",
  }).contacts[2]).toEqual({ name: "Morgan", title: null, email: null, phone: null });
  expect(original[1].title).toBeNull();
  expect(() => contacts.changeCustomerContacts(original, 5, null)).toThrow();
  expect(() => contacts.changeCustomerContacts(original, null, { name: "", title: "", email: "", phone: "" })).toThrow();
  expect(() => contacts.changeCustomerContacts(original, null, { name: "A", title: "", email: "bad", phone: "" })).toThrow();
  expect(() => contacts.changeCustomerContacts(original, null, { name: "A", title: "", email: "", phone: "12" })).toThrow();
});

test("activity shows contact changes only when the current record and both snapshots expose them", () => {
  const history = [{
    revision: 2, digest: "sha256:" + "a".repeat(64), actor: "Morgan", at: 20,
    before: { contacts: [] }, after: { contacts: [contact] },
  }];
  const record = { id: "cust-1", revision: 2, profile: { contacts: [contact] }, history };
  const [visible] = contacts.activityItems(record);
  expect(visible.changes).toEqual([{
    field: "Contacts", before: "Not provided",
    after: "Alex Chan · Operations lead · alex@example.test · +1 202 555 0134",
  }]);
  const [hidden] = contacts.activityItems({ ...record, profile: {} });
  expect(hidden.changes ?? []).toEqual([]);
});

test("activity details show only currently visible structured field changes", () => {
  const custom_fields = { renewal_date: { label: "Renewal date", type: "date", value: "2027-02-28" } };
  const history = [{
    revision: 2, digest: "sha256:" + "a".repeat(64), actor: "Morgan", at: 20,
    before: { custom_fields: {} }, after: { custom_fields },
  }];
  const record = { id: "cust-1", revision: 2, profile: { custom_fields }, history };
  const [visible] = contacts.activityItems(record);
  expect(visible.changes).toEqual([{
    field: "Custom fields", before: "Not provided", after: "Renewal date (renewal_date): 2027-02-28",
  }]);
  const [hidden] = contacts.activityItems({ ...record, profile: {} });
  expect(hidden.changes ?? []).toEqual([]);
});
