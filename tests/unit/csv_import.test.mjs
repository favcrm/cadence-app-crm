// CSV import preview + atomic batch creation client helpers (CRM 0.7.0).
// Run: bun test tests/unit/csv_import.test.mjs
import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

const calls = [];
let nextPreviewResult = null;
let nextBatchResult = { created: 0 };
let nextError = null;

mock.module("../../src/bridge/services.ts", () => ({
  serviceCall: async (_scope, verb, args) => {
    calls.push({ verb, args });
    if (nextError) {
      const err = nextError;
      nextError = null;
      throw err;
    }
    if (verb === "records.csv.preview") return nextPreviewResult;
    if (verb === "records.batch") return nextBatchResult;
    throw new Error(`Unexpected verb: ${verb}`);
  },
  serviceSlot: async () => ({}),
}));

let hostActions;
let parseCsvPreviewReceipt;
let CRM_CSV_MAX_BYTES;
let CRM_CSV_MAX_ROWS;
let ApiError;

beforeAll(async () => {
  ({
    hostActions,
    parseCsvPreviewReceipt,
    CRM_CSV_MAX_BYTES,
    CRM_CSV_MAX_ROWS,
  } = await import("../../src/features/crm/hostActions.ts"));
  ({ ApiError } = await import("@cadence/screen-ui"));
});

const scope = { installId: "install-crm", contextId: "default", digest: "sha256:" + "a".repeat(64) };

beforeEach(() => {
  calls.length = 0;
  nextError = null;
  nextPreviewResult = {
    preview_token: "tok_preview_1",
    headers: ["display_name", "email", "email_consent"],
    mapped_headers: ["display_name", "email"],
    unmapped_headers: ["email_consent"],
    warnings: ["Consent columns were ignored; imported customers default to email: unknown, sms: unknown."],
    summary: {
      total_rows: 3,
      valid_new: 1,
      duplicate_existing: 1,
      duplicate_in_csv: 0,
      invalid: 1,
      max_rows: 200,
    },
    rows: [
      {
        row_number: 1,
        status: "valid",
        record_id: "imp-r1",
        display_name: "Grace Hopper",
        email: "grace@example.test",
        profile: {
          schema: 1,
          display_name: "Grace Hopper",
          email: "grace@example.test",
          phone: null,
          source: null,
          customer_type: null,
          website: null,
          tags: ["pioneer"],
          consent: { email: "unknown", sms: "unknown" },
        },
        errors: [],
      },
      {
        row_number: 2,
        status: "duplicate_existing",
        existing_record_id: "ada",
        existing_revision: 3,
        display_name: "Ada Duplicate",
        email: "ada@example.test",
        errors: [],
      },
      {
        row_number: 3,
        status: "invalid",
        display_name: null,
        email: "bad-email",
        errors: ["display_name is required."],
      },
    ],
    batch_items: [
      {
        record_id: "imp-r1",
        profile: {
          schema: 1,
          display_name: "Grace Hopper",
          email: "grace@example.test",
          phone: null,
          source: null,
          customer_type: null,
          website: null,
          tags: ["pioneer"],
          consent: { email: "unknown", sms: "unknown" },
        },
      },
    ],
  };
  nextBatchResult = { created: 1 };
});

test("previewCsv validates non-empty and 120 KiB bounds before calling records.csv.preview", async () => {
  await expect(hostActions.previewCsv(scope, "   \n")).rejects.toMatchObject({
    status: 400,
    code: "validation_failed",
  });
  expect(calls).toHaveLength(0);

  const oversized = "display_name,email\n" + "a".repeat(CRM_CSV_MAX_BYTES + 10);
  await expect(hostActions.previewCsv(scope, oversized)).rejects.toMatchObject({
    status: 400,
    code: "validation_failed",
  });
  expect(calls).toHaveLength(0);

  const receipt = await hostActions.previewCsv(scope, "display_name,email\nGrace Hopper,grace@example.test\n");
  expect(calls).toEqual([
    {
      verb: "records.csv.preview",
      args: { csv_text: "display_name,email\nGrace Hopper,grace@example.test\n" },
    },
  ]);
  expect(receipt.preview_token).toBe("tok_preview_1");
  expect(receipt.summary.valid_new).toBe(1);
  expect(receipt.batch_items).toHaveLength(1);
  expect(receipt.batch_items[0].profile.consent).toEqual({ email: "unknown", sms: "unknown" });
});

test("batchCreate enforces 1..200 item bounds and dispatches records.batch", async () => {
  await expect(hostActions.batchCreate(scope, [])).rejects.toMatchObject({
    status: 400,
    code: "validation_failed",
  });
  const tooMany = Array.from({ length: CRM_CSV_MAX_ROWS + 1 }, (_, i) => ({
    record_id: `imp-${i}`,
    profile: {
      schema: 1,
      display_name: `Customer ${i}`,
      email: null,
      phone: null,
      source: null,
      customer_type: null,
      website: null,
      tags: [],
      consent: { email: "unknown", sms: "unknown" },
    },
  }));
  await expect(hostActions.batchCreate(scope, tooMany)).rejects.toMatchObject({
    status: 400,
    code: "validation_failed",
  });
  expect(calls).toHaveLength(0);

  const result = await hostActions.batchCreate(scope, nextPreviewResult.batch_items);
  expect(result).toEqual({ created: 1 });
  expect(calls).toEqual([
    {
      verb: "records.batch",
      args: { items: nextPreviewResult.batch_items },
    },
  ]);
});

test("parseCsvPreviewReceipt rejects malformed host receipts and unknown row statuses", async () => {
  expect(() => parseCsvPreviewReceipt(null)).toThrow();
  expect(() => parseCsvPreviewReceipt({})).toThrow();
  expect(() =>
    parseCsvPreviewReceipt({
      ...nextPreviewResult,
      rows: [{ row_number: 1, status: "unexpected_status", display_name: "A", email: null, errors: [] }],
    }),
  ).toThrow();

  nextError = new ApiError("Unsupported", 400, { code: "unsupported_verb" });
  await expect(hostActions.previewCsv(scope, "display_name\nAda\n")).rejects.toBeInstanceOf(ApiError);
});
