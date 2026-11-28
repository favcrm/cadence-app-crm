import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { views as CRM_VIEWS } from "../../scripts/crm_views.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
}

function sha256File(relPath) {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(REPO_ROOT, relPath)))
    .digest("hex");
}

describe("CRM 0.8.0 revenue, touchpoints, and merge contracts", () => {
  it("app-storage.json declares schema v11 with verified 007-011 migrations and tables", () => {
    const manifest = readJson("app/app-storage.json");
    assert.equal(manifest.schema_version, 11);
    assert.deepEqual(manifest.compatible_schema_versions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const expectedMigrations = [
      {
        version: 7,
        path: "storage/007-deals.json",
        table: "deals",
        searchColumns: ["title", "stage", "owner_label"],
      },
      {
        version: 8,
        path: "storage/008-tasks.json",
        table: "tasks",
        searchColumns: ["title", "status", "assignee"],
      },
      {
        version: 9,
        path: "storage/009-touchpoints.json",
        table: "touchpoints",
        searchColumns: ["summary", "channel"],
      },
    ];

    const tableCols = {};
    for (const item of expectedMigrations) {
      const entry = manifest.migrations.find((m) => m.version === item.version);
      assert.ok(entry, `missing migration version ${item.version}`);
      assert.equal(entry.path, item.path);
      assert.equal(entry.sha256, `sha256:${sha256File(path.join("app", item.path))}`);
      assert.ok(manifest.tables[item.table], `missing table definition for ${item.table}`);
      assert.deepEqual(manifest.tables[item.table].search_columns, item.searchColumns);

      const migration = readJson(path.join("app", item.path));
      const createOp = migration.operations.find(
        (op) => op.op === "create_table" && op.table === item.table,
      );
      assert.ok(createOp, `missing create_table op for ${item.table}`);
      tableCols[item.table] = Object.fromEntries(createOp.columns.map((col) => [col.name, col]));
    }

    assert.equal(tableCols.deals.stage.type, "text");
    assert.deepEqual(tableCols.deals.stage.enum, ["lead", "qualified", "proposal", "won", "lost"]);
    assert.equal(tableCols.deals.amount_cents.type, "integer");
    assert.equal(tableCols.tasks.status.type, "text");
    assert.deepEqual(tableCols.tasks.status.enum, ["open", "done", "cancelled"]);
    assert.equal(tableCols.touchpoints.channel.type, "text");
    assert.deepEqual(tableCols.touchpoints.channel.enum, [
      "email",
      "whatsapp",
      "phone",
      "meeting",
      "note",
      "other",
    ]);
    const linkMigration = "storage/010-touchpoint-deal.json";
    assert.equal(
      manifest.migrations.find((m) => m.version === 10).sha256,
      `sha256:${sha256File(path.join("app", linkMigration))}`,
    );

    const columnsMigration = "storage/011-crm26-schema-columns.json";
    assert.deepEqual(manifest.migrations.at(-1), {
      version: 11,
      path: columnsMigration,
      sha256: `sha256:${sha256File(path.join("app", columnsMigration))}`,
    });
    const added = {};
    const nullable = [];
    for (const op of readJson(path.join("app", columnsMigration)).operations) {
      assert.equal(op.op, "add_column");
      (added[op.table] ??= []).push(op.column.name);
      if (op.column.nullable) nullable.push([op.table, op.column.name]);
    }
    assert.deepEqual(added, {
      deals: ["status", "loss_reason", "source", "next_step", "custom_fields"],
      tasks: ["priority", "origin", "source_ref"],
      touchpoints: ["external_ref", "provenance"],
    });
    // A stored null is validated against the write schema, so every nullable column needs a null branch.
    for (const [table, name] of nullable) {
      const property = manifest.tables[table].write_schema.properties.after.properties[name];
      assert.ok(property, `write schema missing ${table}.${name}`);
      assert.ok(
        (property.anyOf ?? []).some((branch) => branch.type === "null"),
        `${table}.${name} write schema must accept the stored null`,
      );
    }
    const customFields = readJson(path.join("app", columnsMigration)).operations
      .find((op) => op.column.name === "custom_fields").column;
    const refusedKeys = customFields.json_schema.propertyNames.allOf.find((rule) => rule.not).not.enum;
    for (const key of ["api_key", "access_token", "client_secret", "private_key", "password"]) {
      assert.ok(refusedKeys.includes(key), `custom_fields must refuse ${key}`);
    }
  });

  it("bridge services and CRM views expose records.merge and deals/tasks/customer routes", () => {
    const servicesSrc = fs.readFileSync(path.join(REPO_ROOT, "src/bridge/services.ts"), "utf8");
    assert.match(servicesSrc, /"records\.merge"/);

    const viewIds = CRM_VIEWS.map((view) => view.id);
    assert.ok(viewIds.includes("deals"));
    assert.ok(viewIds.includes("tasks"));
    assert.ok(viewIds.includes("customer"));
    assert.equal(CRM_VIEWS.length, 8);
  });

  it("built screens.json exposes 55 operations, 5 sections, and 8 views", () => {
    const screens = readJson("app/screens/crm/screens.json");
    const declaredOps = Array.isArray(screens.operations) ? screens.operations : [];
    assert.equal(declaredOps.length, 55);
    assert.ok(declaredOps.includes("records.merge"));

    const navSections = (screens.navigation?.sections ?? []).map((s) => s.id ?? s);
    assert.deepEqual(navSections, ["customers", "deals", "tasks", "segments", "campaigns"]);

    const builtViews = (screens.views ?? []).map((v) => v.id);
    assert.equal(builtViews.length, 8);
    assert.ok(builtViews.includes("deals"));
    assert.ok(builtViews.includes("tasks"));
    assert.ok(builtViews.includes("customer"));
  });

  it("Deals.tsx and Tasks.tsx guard data-outlet-heading with !viewer.canvas", () => {
    const dealsSrc = fs.readFileSync(path.join(REPO_ROOT, "src/features/crm/deals/Deals.tsx"), "utf8");
    const tasksSrc = fs.readFileSync(path.join(REPO_ROOT, "src/features/crm/tasks/Tasks.tsx"), "utf8");

    assert.match(dealsSrc, /\{!viewer\.canvas && \(\s*<h3[^>]*data-outlet-heading[^>]*>\s*\{t\("Pipeline"\)\}\s*<\/h3>\s*\)\}/);
    assert.match(tasksSrc, /\{!viewer\.canvas && \(\s*<h3[^>]*data-outlet-heading[^>]*>\s*\{t\("Tasks"\)\}\s*<\/h3>\s*\)\}/);
  });
});
