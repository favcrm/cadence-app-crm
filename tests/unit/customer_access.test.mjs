import { beforeAll, expect, mock, test } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let parseRecord;
let canEditCustomer;
beforeAll(async () => {
  ({ parseRecord } = await import("../../src/features/crm/hostActions.ts"));
  ({ canEditCustomer } = await import("../../src/features/crm/viewer.ts"));
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
