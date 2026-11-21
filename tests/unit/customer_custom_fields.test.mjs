import { beforeAll, expect, mock, test } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);
let profile;
beforeAll(async () => { profile = await import("../../src/features/crm/customerCustomFields.ts"); });

test("custom fields are typed, stable-keyed data on the customer", () => {
  expect(profile.readCustomerCustomFields({})).toBeNull();
  expect(profile.readCustomerCustomFields({ custom_fields: { renewal_date: { label: "Renewal date", type: "date", value: "2027-02-28" } } })).toEqual({ renewal_date: { label: "Renewal date", type: "date", value: "2027-02-28" } });
  const badDate = { renewal_date: { label: "Renewal date", type: "date", value: "2027-02-30" } };
  expect(profile.readCustomerCustomFields({ custom_fields: badDate })).toEqual(badDate);
  expect(profile.readCustomerCustomFields({ custom_fields: { staff: { label: "Staff", type: "number", value: "many" } } })).toBeNull();
  expect(profile.readCustomerCustomFields({ custom_fields: { staff: { label: "Staff", type: "number", value: 3, unknown: true } } })).toBeNull();
});

test("adding, changing and removing fields preserves other data and validates types", () => {
  const original = { industry: { label: "Industry", type: "text", value: "Retail" } };
  const count = profile.changeCustomerCustomFields(original, null, { key: "staff_count", label: "Staff count", type: "number", value: "12" });
  expect(count.custom_fields).toEqual({ ...original, staff_count: { label: "Staff count", type: "number", value: 12 } });
  expect(profile.changeCustomerCustomFields(count.custom_fields, "staff_count", { key: "staff_count", label: "Staff", type: "number", value: "15" }).custom_fields.staff_count.value).toBe(15);
  expect(profile.changeCustomerCustomFields(count.custom_fields, "staff_count", null).custom_fields).toEqual(original);
  expect(() => profile.changeCustomerCustomFields(original, null, { key: "industry", label: "Again", type: "text", value: "x" })).toThrow();
  expect(() => profile.changeCustomerCustomFields(original, null, { key: "bad key", label: "Bad", type: "text", value: "x" })).toThrow();
  expect(() => profile.changeCustomerCustomFields(original, null, { key: "renewal", label: "Date", type: "date", value: "2027-02-30" })).toThrow();
  expect(() => profile.changeCustomerCustomFields(original, null, { key: "count", label: "Count", type: "number", value: "NaN" })).toThrow();
  expect(() => profile.changeCustomerCustomFields(original, "industry", { key: "renamed", label: "Industry", type: "text", value: "Retail" })).toThrow();
  expect(() => profile.changeCustomerCustomFields(original, "industry", { key: "industry", label: "Industry", type: "number", value: "1" })).toThrow();
});

test("custom fields cannot use keys that the host removes from record replies", () => {
  const reserved = ["action_token", "confirmation_token", "confirmation_nonce", "confirm_token", "csv_confirm_token", "scope_proof", "password", "credentials", "credential", "secret", "session_key", "host_command"];
  const field = { label: "Status", type: "text", value: "active" };
  for (const key of reserved) {
    expect(() => profile.changeCustomerCustomFields({}, null, { key, ...field })).toThrow("reserved");
    expect(profile.readCustomerCustomFields({ custom_fields: { [key]: field } })).toBeNull();
  }
  expect(profile.changeCustomerCustomFields({}, null, { key: "customer_status", ...field }).custom_fields).toEqual({ customer_status: field });
});
