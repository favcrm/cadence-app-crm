// CAD-974 focused tests for the canonical contract check boundary.
// Run: node --test tests/contract/check_app_views.test.mjs
//
// Real assertions only: these tests exercise the checker's option
// refusals/acceptance — the part that keeps validation honest. The
// descriptor/fixture correctness itself is proven by actually running
// scripts/check_app_views.mjs against the pinned host, which root does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

const appRoot = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const checker = resolve(appRoot, "scripts/check_app_views.mjs");
const { checkOptions } = await import(pathToFileURL(checker).href);

test("checkOptions: real defaults are accepted and pinned", () => {
  const o = checkOptions([]);
  assert.equal(
    o.hostSource,
    "/home/ubuntu/Project/cadence/.cadence/wt/cad-970-independent-apps-structured-git",
  );
  assert.equal(o.toolRoot, "/home/ubuntu/Project/cadence");
});

test("checkOptions: backend/proxy/token/env/port/host options all refuse", () => {
  for (const flag of [
    "--backend", "--proxy", "--token", "--api",
    "--secret", "--credential", "--env", "--port", "--host",
  ]) {
    assert.throws(() => checkOptions([flag, "x"]), /Unsupported option/, flag);
  }
});

test("checkOptions: relative paths refuse; absolute paths accepted", () => {
  assert.throws(() => checkOptions(["--host-source", "relative/path"]));
  assert.throws(() => checkOptions(["--tool-root", ".."]));
  assert.equal(checkOptions(["--host-source", "/abs/ok"]).hostSource, "/abs/ok");
  assert.equal(checkOptions(["--tool-root", "/abs/ok"]).toolRoot, "/abs/ok");
});

test("checkOptions: dangling flag refuses", () => {
  assert.throws(() => checkOptions(["--host-source"]), /Missing value/);
});
