import { beforeAll, expect, mock, test } from "bun:test";
import { ApiError, sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let parseRecord, parseRecordList;
let canEditCustomer, isDefiniteCreateRefusal;
beforeAll(async () => {
  ({ parseRecord, parseRecordList } = await import("../../src/features/crm/hostActions.ts"));
  ({ canEditCustomer } = await import("../../src/features/crm/viewer.ts"));
  ({ isDefiniteCreateRefusal } = await import("../../src/features/crm/hostErrors.ts"));
});

const receipt = (recordAccess) => ({
  record: {
    id: "customer-1",
    revision: 1,
    digest: `sha256:${"a".repeat(64)}`,
    profile: {},
    ...(recordAccess === undefined ? {} : { record_access: recordAccess }),
  },
});

test("customer edit requires both the host operation and the record write grant", () => {
  const viewer = { operator: true, readOnly: false, canUpdate: true };
  expect(canEditCustomer(viewer, parseRecord(receipt({ can_write: true })))).toBe(true);
  expect(canEditCustomer(viewer, parseRecord(receipt({ can_write: false })))).toBe(false);
  expect(canEditCustomer({ ...viewer, canUpdate: false }, parseRecord(receipt({ can_write: true })))).toBe(false);
  expect(canEditCustomer({ ...viewer, readOnly: true, canCreate: false }, parseRecord(receipt({ can_write: true })))).toBe(true);
  expect(canEditCustomer({ ...viewer, operator: false }, parseRecord(receipt({ can_write: true })))).toBe(false);
  // Older, unprotected hosts do not send an individual access decision.
  expect(canEditCustomer(viewer, parseRecord(receipt(undefined)))).toBe(true);
});

test("malformed record access decisions fail closed", () => {
  for (const access of [null, {}, { can_write: "true" }, { can_write: 1 }, []]) {
    expect(() => parseRecord(receipt(access))).toThrow();
  }
});

test("create ID negotiation accepts only the host-assigned policy", () => {
  expect(parseRecordList({ records: [] }).hostAssignedCreateId).toBe(false);
  expect(parseRecordList({ records: [], record_access: { create_id: "host" } }).hostAssignedCreateId).toBe(true);
  for (const access of [null, {}, { create_id: "client" }, { create_id: true }, []]) {
    expect(() => parseRecordList({ records: [], record_access: access })).toThrow();
  }
});

test("only explicit pre-write refusals permit retrying a host-assigned create", () => {
  expect(isDefiniteCreateRefusal(new ApiError("Invalid", 400, { code: "validation_failed" }))).toBe(true);
  expect(isDefiniteCreateRefusal(new ApiError("Unknown outcome", 400, { code: "outcome_uncertain" }))).toBe(false);
  expect(isDefiniteCreateRefusal(new ApiError("Unavailable", 400, { code: "storage_unavailable" }))).toBe(false);
  expect(isDefiniteCreateRefusal(new TypeError("network failed"))).toBe(false);
});
