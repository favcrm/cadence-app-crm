import { test, expect, beforeAll, mock } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { sdkMock } from "../support/sdk-mock.mjs";

mock.module("@cadence/screen-ui", sdkMock);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
}

function sha256File(relPath) {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(REPO_ROOT, relPath)))
    .digest("hex");
}

let hostActionsModule;
let fixtureStateModule;

beforeAll(async () => {
  hostActionsModule = await import("../../src/features/crm/hostActions.ts");
  fixtureStateModule = await import("../../dev/preview/fixture-state.ts");
});

test("CRM 1.0.0 manifest and app-storage.json declare schema v10 and links migration hash", () => {
  const pkg = readJson("package.json");
  expect(pkg.version).toBe("1.0.0");

  const appMd = fs.readFileSync(path.join(REPO_ROOT, "app/app.md"), "utf8");
  expect(appMd).toContain("version: '1.0.0'");

  const storage = readJson("app/app-storage.json");
  expect(storage.schema_version).toBe(10);
  expect(storage.compatible_schema_versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const linksEntry = storage.migrations.find((m) => m.version === 10);
  expect(linksEntry).toEqual({
    version: 10,
    path: "storage/010-links.json",
    sha256: `sha256:${sha256File("app/storage/010-links.json")}`,
  });

  const linksTable = storage.tables.links;
  expect(linksTable).toBeDefined();
  expect(linksTable.search_columns).toEqual(["label", "target_ref", "target_kind"]);
  expect(linksTable.immutable_columns).toEqual(["customer_id"]);

  const migration = readJson("app/storage/010-links.json");
  const createOp = migration.operations.find((op) => op.op === "create_table" && op.table === "links");
  expect(createOp).toBeDefined();
  const cols = Object.fromEntries(createOp.columns.map((c) => [c.name, c]));
  expect(cols.target_kind.enum).toEqual([
    "issue",
    "artifact",
    "quote",
    "calendar_event",
    "invoice",
    "accounting",
    "url",
    "other",
  ]);
});

test("CRM 1.0.0 ships all five governed capture workflows and updated SKILL.md", () => {
  const expected = [
    { file: "mail-capture.md", key: "mail", needle: "ref_id" },
    { file: "whatsapp-capture.md", key: "whatsapp", needle: "crm_context" },
    { file: "meeting-capture.md", key: "meetings", needle: "untrusted" },
    { file: "web-enrichment.md", key: "web_enrichment", needle: "source_url" },
    { file: "revenue-watchdog.md", key: "watchdogs", needle: "expected_close_date" },
  ];

  for (const wf of expected) {
    const raw = fs.readFileSync(path.join(REPO_ROOT, "app/workflows", wf.file), "utf8");
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    expect(fmMatch?.[1]).toBeTruthy();
    const parsed = YAML.parse(fmMatch[1]);
    expect(typeof parsed.title).toBe("string");
    expect(typeof parsed.goal).toBe("string");
    expect(raw).toContain(`autonomy.capture_sources.${wf.key}`);
    expect(raw).toContain("read_only === false");
    expect(raw).toContain(wf.needle);
  }

  const skill = fs.readFileSync(path.join(REPO_ROOT, "app/skills/crm/SKILL.md"), "utf8");
  for (const term of [
    "CRM 1.0.0",
    "`links`",
    "mail-capture",
    "whatsapp-capture",
    "meeting-capture",
    "web-enrichment",
    "revenue-watchdog",
    "capture_sources",
    "/api/apps/crm/control-panel",
    "crm_context",
    "Untrusted input firewall",
  ]) {
    expect(skill).toContain(term);
  }
});

test("parseLinkRecord validates shape and defaults unknown kind to other", () => {
  expect(hostActionsModule.LINK_TARGET_KINDS).toEqual([
    "issue",
    "artifact",
    "quote",
    "calendar_event",
    "invoice",
    "accounting",
    "url",
    "other",
  ]);

  const parsed = hostActionsModule.parseLinkRecord({
    id: "link-1",
    revision: 2,
    profile: {
      customer_id: "cust-1",
      deal_id: "deal-1",
      target_kind: "quote",
      target_ref: "quote-2026-001",
      label: "Annual quote",
      source_url: "https://example.invalid/quotes/1",
      notes: "Signed PDF",
    },
  });
  expect(parsed).toEqual({
    id: "link-1",
    revision: 2,
    customerId: "cust-1",
    dealId: "deal-1",
    targetKind: "quote",
    targetRef: "quote-2026-001",
    label: "Annual quote",
    sourceUrl: "https://example.invalid/quotes/1",
    notes: "Signed PDF",
  });

  const fallbackKind = hostActionsModule.parseLinkRecord({
    id: "link-2",
    revision: 1,
    profile: {
      customer_id: "cust-1",
      target_kind: "unexpected",
      target_ref: "ref-2",
      label: "Fallback",
    },
  });
  expect(fallbackKind.targetKind).toBe("other");

  expect(() =>
    hostActionsModule.parseLinkRecord({
      id: "link-bad",
      revision: 1,
      profile: { customer_id: "cust-1", label: "Missing target_ref" },
    }),
  ).toThrow();
});

test("preview fixture supports links CRUD and reparents links on customer merge", () => {
  const { fixtureCall } = fixtureStateModule;
  const listedBefore = fixtureCall("records.list", {
    table: "links",
    filters: [{ field: "customer_id", op: "eq", value: "ada" }],
  });
  expect(listedBefore.records.map((r) => r.id)).toContain("link-ada-1");

  const created = fixtureCall("records.create", {
    table: "links",
    record_id: "link-sam-1",
    profile: {
      customer_id: "sam",
      target_kind: "issue",
      target_ref: "AOS-708",
      label: "Implementation tracker",
      source_url: "https://example.invalid/issues/AOS-708",
    },
  });
  expect(created.record.profile.customer_id).toBe("sam");

  const shown = fixtureCall("records.show", {
    table: "links",
    record_id: "link-sam-1",
  });
  expect(shown.record.profile.target_ref).toBe("AOS-708");

  const sam = fixtureCall("records.show", { record_id: "sam" }).record;
  const ada = fixtureCall("records.show", { record_id: "ada" }).record;
  const merged = fixtureCall("records.merge", {
    source_id: "sam",
    target_id: "ada",
    expected_source_revision: sam.revision,
    expected_target_revision: ada.revision,
  });
  expect(merged.reparented.links).toBeGreaterThanOrEqual(1);

  const afterMerge = fixtureCall("records.list", {
    table: "links",
    filters: [{ field: "customer_id", op: "eq", value: "ada" }],
  });
  expect(afterMerge.records.map((r) => r.id)).toEqual(
    expect.arrayContaining(["link-ada-1", "link-sam-1"]),
  );
});

test("Customers component declares Links tab and Add link panel", () => {
  const src = fs.readFileSync(
    path.join(REPO_ROOT, "src/features/crm/customers/Customers.tsx"),
    "utf8",
  );
  expect(src).toContain('{ id: "links", label: "Links" }');
  expect(src).toContain('aria-label={t("Links")}');
  expect(src).toContain("hostActions.listLinks(scope, recordId)");
  expect(src).toContain(".createLink(scope,");
});
