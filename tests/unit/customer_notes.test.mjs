import { test, expect, beforeAll, mock } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

let services;
let hostActionsModule;
beforeAll(async () => {
  services = await import("../../src/bridge/services.ts");
  hostActionsModule = await import("../../src/features/crm/hostActions.ts");
});

test("bridge admits table selectors, records.aggregate, and records.batch", () => {
  expect(services.CALL_FIELDS["records.list"]).toContain("table");
  expect(services.CALL_FIELDS["records.list"]).toContain("filters");
  expect(services.CALL_FIELDS["records.aggregate"]).toEqual(["table", "query", "filters", "group_by", "sum"]);
  expect(services.CALL_FIELDS["records.batch"]).toEqual(["items", "consent_provenance"]);
  expect(services.WRITE_VERBS).toContain("records.batch");

  const agg = services.cleanArgs("records.aggregate", { table: "customers", group_by: ["source"] }, false);
  expect(agg).toEqual({ table: "customers", group_by: ["source"] });

  const batch = services.cleanArgs("records.batch", {
    items: [{ table: "notes", record_id: "n-1", profile: { customer_id: "c-1", body: "First contact" } }],
  }, false);
  expect(batch.items).toHaveLength(1);
});

test("parseNoteRecord validates required fields and archived_at", () => {
  const active = hostActionsModule.parseNoteRecord({
    id: "note-1",
    revision: 1,
    profile: { customer_id: "cust-1", body: "Follow up Tuesday", archived_at: null },
  });
  expect(active).toEqual({
    id: "note-1",
    revision: 1,
    customerId: "cust-1",
    body: "Follow up Tuesday",
    archivedAt: null,
  });
  expect(() =>
    hostActionsModule.parseNoteRecord({ id: "note-2", revision: 0, profile: { customer_id: "c", body: "x" } }),
  ).toThrow();
});
