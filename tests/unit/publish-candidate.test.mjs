import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../.github/scripts/publish.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "app-publisher-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "app.md": "synthetic manifest\n",
    "screens/shared.md": "screen\n",
    "workflows/shared.md": "workflow\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, "app", path, ".."), { recursive: true });
    writeFileSync(join(root, "app", path), content);
  }
  const digest = `sha256:${"a".repeat(64)}`;
  writeFileSync(
    join(root, "check.json"),
    JSON.stringify({
      ok: true,
      name: "test-app",
      version: "1.2.3",
      title: "Synthetic",
      summary: "Synthetic package",
      listing: {},
      digest,
    }),
  );
  writeFileSync(
    join(root, "install.json"),
    JSON.stringify({ digest, compatibility: { compatible: true, host: { core: "0.0.1" } } }),
  );
  const env = {
    ...process.env,
    DRY_RUN: "1",
    APP_DIR: "app",
    APP_UPLOAD_JSON: "",
    APP_CHECK_JSON: join(root, "check.json"),
    APP_INSTALL_CHECK_JSON: join(root, "install.json"),
    GITHUB_REF: "refs/tags/v1.2.3",
    GITHUB_REPOSITORY: "synthetic/app",
    EXPECTED_REPOSITORY: "synthetic/app",
  };
  delete env.CATALOGUE_PUBLISH_URL;
  return {
    files,
    run: (extra = {}) =>
      spawnSync(process.execPath, [script], {
        cwd: root,
        env: { ...env, ...extra },
        encoding: "utf8",
      }),
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

test("a configured legacy endpoint cannot publish stable before draft verification", (t) => {
  const result = fixture(t).run({
    CATALOGUE_PUBLISH_URL: "https://synthetic.example/public/apps/publish",
  });
  assert.notEqual(result.status, 0);
});

test("a branch cannot substitute for the matching version tag", (t) => {
  assert.notEqual(fixture(t).run({ GITHUB_REF: "refs/heads/main" }).status, 0);
});
