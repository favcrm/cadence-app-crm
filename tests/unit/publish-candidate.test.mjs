import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../.github/scripts/publish.mjs", import.meta.url));

const MANIFEST = [
  "---",
  "app: test-app",
  "title: Synthetic",
  "version: '1.2.3'",
  "summary: Synthetic package",
  "listing:",
  "  tagline: Test",
  "  category: customers",
  "---",
  "",
  "Body.",
  "",
].join("\n");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "app-publisher-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "app.md": MANIFEST,
    "screens/shared.md": "screen\n",
    "workflows/shared.md": "workflow\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, "app", path, ".."), { recursive: true });
    writeFileSync(join(root, "app", path), content);
  }
  const digest = `sha256:${"a".repeat(64)}`;
  const inventory = Object.entries(files).map(([path, content]) => ({
    path,
    bytes: Buffer.byteLength(content, "utf8"),
    cap: 262144,
  }));
  const report = {
    ok: true,
    check: "app-package/1",
    name: "test-app",
    version: "1.2.3",
    title: "Synthetic",
    summary: "Synthetic package",
    listing: { tagline: "Test", category: "customers" },
    digest,
    files: inventory,
    compatibility: { compatible: true, host: { core: "0.0.1" } },
  };
  const checkPath = join(root, "check.json");
  writeFileSync(checkPath, JSON.stringify(report));
  const env = {
    ...process.env,
    DRY_RUN: "1",
    APP_DIR: "app",
    APP_UPLOAD_JSON: "",
    APP_CHECK_JSON: checkPath,
    GITHUB_REF: "refs/tags/v1.2.3",
    GITHUB_REPOSITORY: "synthetic/app",
    EXPECTED_REPOSITORY: "synthetic/app",
  };
  delete env.CATALOGUE_PUBLISH_URL;
  return {
    files,
    report,
    checkPath,
    run: (extra = {}) =>
      spawnSync(process.execPath, [script], {
        cwd: root,
        env: { ...env, ...extra },
        encoding: "utf8",
      }),
    writeReport: (report) => writeFileSync(checkPath, JSON.stringify(report)),
    writeManifest: (text) => writeFileSync(join(root, "app", "app.md"), text),
  };
}

test("nested package paths survive publication without basename collisions", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const expected = JSON.stringify({ files: f.files }, null, 2) + "\n";
  const digest = createHash("sha256").update(expected).digest("hex");
  assert.equal(JSON.parse(result.stdout).uploadSha256, digest);
});

test("a hosted-only native refusal publishes identity/listing from app.md without a compatibility claim", (t) => {
  const f = fixture(t);
  f.writeReport({
    ok: false,
    digest: f.report.digest,
    files: f.report.files,
    refusal: {
      code: "app_check_content",
      kind: "rejected",
      message: "app is not installable — unsupported requirement app-storage: [1]",
    },
  });
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.entry.id, "test-app");
  assert.equal(output.entry.app, "test-app");
  assert.equal(output.entry.version, "1.2.3");
  assert.equal(output.entry.title, "Synthetic");
  assert.equal(output.entry.summary, "Synthetic package");
  assert.deepEqual(output.entry.listing, { tagline: "Test", category: "customers" });
  assert.equal(output.entry.digest, f.report.digest);
  assert.equal(Object.hasOwn(output.entry, "compatibility"), false);
  assert.equal(output.native.ok, false);
  assert.equal(output.native.refusal, "app_check_content");
});

test("a passing native report still cannot invent a compatibility claim", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const entry = JSON.parse(result.stdout).entry;
  assert.equal(Object.hasOwn(entry, "compatibility"), false);
});

test("a refusal without inventory cannot publish", (t) => {
  const f = fixture(t);
  f.writeReport({
    ok: false,
    digest: f.report.digest,
    refusal: { code: "app_check_content", kind: "rejected", message: "refused" },
  });
  assert.notEqual(f.run().status, 0);
});

test("malformed identity cannot publish", (t) => {
  const f = fixture(t);
  f.writeManifest("---\napp: test-app\nversion: '1.2.3'\n---\n");
  assert.notEqual(f.run().status, 0);
});

test("a non-sha256 digest cannot publish", (t) => {
  const f = fixture(t);
  f.writeReport({ ...f.report, digest: "sha256:nothex" });
  assert.notEqual(f.run().status, 0);
});

test("an inventory that does not describe the bundle cannot publish", (t) => {
  const f = fixture(t);
  f.writeReport({
    ...f.report,
    files: [...f.report.files, { path: "extra.md", bytes: 1, cap: 262144 }],
  });
  assert.notEqual(f.run().status, 0);
});

test("a configured legacy endpoint cannot publish stable before draft verification", (t) => {
  const result = fixture(t).run({
    CATALOGUE_PUBLISH_URL: "https://synthetic.example/public/apps/publish",
  });
  assert.notEqual(result.status, 0);
});

test("a branch cannot substitute for the matching version tag", (t) => {
  assert.notEqual(fixture(t).run({ GITHUB_REF: "refs/heads/main" }).status, 0);
});
