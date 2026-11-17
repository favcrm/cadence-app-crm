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
