import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = fileURLToPath(new URL("../../.github/scripts/publish.mjs", import.meta.url));
const COMMIT = "b".repeat(40);

// The publisher is a top-level script, so publication responses are exercised
// by preloading this stub into the spawned process. It replaces global fetch
// only; OIDC, endpoint, upload and scanner checks still run for real.
const FETCH_STUB = `
import { appendFileSync, readFileSync } from "node:fs";

const queue = JSON.parse(readFileSync(process.env.STUB_RESPONSES, "utf8"));
globalThis.fetch = async (input, init = {}) => {
  const next = queue.shift();
  if (!next) throw new Error("unexpected fetch: " + String(input));
  appendFileSync(
    process.env.STUB_REQUEST_LOG,
    JSON.stringify({
      url: String(input),
      method: init.method ?? "GET",
      authorization: init.headers?.authorization ?? null,
      body: typeof init.body === "string" ? init.body : null,
    }) + "\\n",
  );
  return new Response(JSON.stringify(next.body), {
    status: next.status ?? 200,
    headers: { "content-type": "application/json" },
  });
};
`;

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
    "templates/shared.md": "template\n",
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
    GITHUB_SHA: COMMIT,
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
    inspect: () =>
      spawnSync("cadence", ["--state-dir", join(root, "inspection-state"), "app", "check", "app"], {
        cwd: root,
        env,
        encoding: "utf8",
      }),
    writeUpload: (content) => {
      const path = join(root, "upload.json");
      writeFileSync(path, content);
      return path;
    },
    writeManifest: (text) => writeFileSync(join(root, "app", "app.md"), text),
    // Runs the real publisher past DRY_RUN with a stubbed fetch, so the
    // catalogue's answer decides the exit status and console output.
    runPublication: (responses) => {
      const stub = join(root, "fetch-stub.mjs");
      writeFileSync(stub, FETCH_STUB);
      const responsesPath = join(root, "responses.json");
      writeFileSync(responsesPath, JSON.stringify(responses));
      const log = join(root, "requests.ndjson");
      writeFileSync(log, "");
      return spawnSync(process.execPath, [script], {
        cwd: root,
        env: {
          ...env,
          DRY_RUN: "",
          ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/oidc",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
          NODE_OPTIONS: `--import=${pathToFileURL(stub).href}`,
          STUB_RESPONSES: responsesPath,
          STUB_REQUEST_LOG: log,
        },
        encoding: "utf8",
      });
    },
    requests: () =>
      readFileSync(join(root, "requests.ndjson"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

test("a supplied upload cannot replace the inspected members", (t) => {
  const f = fixture(t);
  const path = f.writeUpload(JSON.stringify({
    files: { ...f.files, "app.md": MANIFEST + "Different bytes.\n" },
  }));
  assert.notEqual(f.run({ APP_UPLOAD_JSON: path }).status, 0);
});

test("a supplied upload preserves normalized nested members without imposing JSON whitespace", (t) => {
  const f = fixture(t);
  const path = f.writeUpload(JSON.stringify({ files: f.files }));
  const result = f.run({ APP_UPLOAD_JSON: path });
  assert.equal(result.status, 0, result.stderr);
});

test("duplicate upload keys cannot hide uninspected credential-bearing bytes", (t) => {
  const f = fixture(t);
  const credential = ["gh", "p_", "a".repeat(36)].join("");
  const path = f.writeUpload(
    `{"files":{"app.md":${JSON.stringify(credential)}},"files":${JSON.stringify(f.files)}}`,
  );
  const result = f.run({ APP_UPLOAD_JSON: path });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.includes(credential), false);
  assert.equal(result.stderr.includes(credential), false);
});

test("a real native content refusal cannot publish credential-bearing members", (t) => {
  const f = fixture(t);
  const credential = ["gh", "p_", "a".repeat(36)].join("");
  f.writeManifest(MANIFEST + credential + "\n");
  const inspected = f.inspect();
  assert.equal(inspected.status, 3, inspected.stderr);
  const report = JSON.parse(inspected.stdout);
  assert.equal(report.refusal.code, "app_check_content");
  f.writeReport(report);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.includes(credential), false);
  assert.equal(result.stderr.includes(credential), false);
});

test("publication fails closed when its independent credential scanner is unavailable", (t) => {
  assert.notEqual(fixture(t).run({ PATH: "" }).status, 0);
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

const OIDC = { body: { value: "oidc-token" } };

function published(f, extra = {}) {
  return {
    body: {
      ok: true,
      data: {
        id: "test-app",
        version: "1.2.3",
        digest: f.report.digest,
        publication: "published",
        repository: "synthetic/app",
        commit: COMMIT,
        status: "published",
        ...extra,
      },
    },
  };
}

test("trusted publication reports the listed version only after a published confirmation", (t) => {
  const f = fixture(t);
  const result = f.runPublication([OIDC, published(f)]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /publication: published/);
  assert.match(result.stdout, /listed this exact version/);
  assert.doesNotMatch(result.stdout, /draft/i);
  const requests = f.requests();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://api-v2.agenticos.hk/public/apps/candidates");
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].authorization, "Bearer oidc-token");
  const body = JSON.parse(requests[1].body);
  assert.equal(body.entry.id, "test-app");
  assert.equal(body.entry.version, "1.2.3");
  assert.equal(body.entry.digest, f.report.digest);
  assert.equal(body.entry.source.commit, COMMIT);
  assert.equal(Object.hasOwn(body.entry, "compatibility"), false);
});

test("an idempotent replay is reported as already listed, not as a fresh publication", (t) => {
  const f = fixture(t);
  const result = f.runPublication([OIDC, published(f, { status: "unchanged" })]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already listed/);
  assert.doesNotMatch(result.stdout, /Published test-app/);
  assert.doesNotMatch(result.stdout, /draft/i);
});

test("an older API that stores an unlisted draft cannot report a completed publication", (t) => {
  const f = fixture(t);
  const result = f.runPublication([
    OIDC,
    {
      body: {
        ok: true,
        data: {
          id: "test-app",
          version: "1.2.3",
          digest: f.report.digest,
          publication: "draft",
        },
      },
    },
  ]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Published test-app/);
  assert.doesNotMatch(result.stdout, /publication: published/);
  assert.match(result.stderr, /unlisted draft/);
  assert.match(result.stderr, /deploy the candidate API/);
});

test("a success body without a published state cannot report a completed publication", (t) => {
  const f = fixture(t);
  const result = f.runPublication([
    OIDC,
    {
      body: {
        ok: true,
        data: { id: "test-app", version: "1.2.3", digest: f.report.digest },
      },
    },
  ]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Published test-app/);
  assert.match(result.stderr, /did not confirm a listed publication/);
});

test("a published confirmation for a different release cannot report success", (t) => {
  const f = fixture(t);
  const result = f.runPublication([OIDC, published(f, { version: "1.2.4" })]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Published test-app/);
  assert.match(result.stderr, /different release/);
});

test("a terminal catalogue refusal is not reported as a published release", (t) => {
  const f = fixture(t);
  const result = f.runPublication([
    OIDC,
    { status: 409, body: { ok: false, error: { code: "immutable_release" } } },
  ]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Published test-app/);
  assert.match(result.stderr, /\(409\)/);
  assert.match(result.stderr, /immutable_release/);
});

test("a confirmation from a different repository cannot claim this workflow's provenance", (t) => {
  const f = fixture(t);
  const result = f.runPublication([OIDC, published(f, { repository: "other/app" })]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /published to the catalogue directory/);
  assert.match(result.stderr, /different repository or commit/);
});

test("a confirmation from a different commit cannot claim this workflow's provenance", (t) => {
  const f = fixture(t);
  const result = f.runPublication([OIDC, published(f, { commit: "c".repeat(40) })]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /published to the catalogue directory/);
  assert.match(result.stderr, /different repository or commit/);
});

test("a confirmation without a publication status cannot report a fresh publication", (t) => {
  const f = fixture(t);
  const response = published(f);
  delete response.body.data.status;
  const result = f.runPublication([OIDC, response]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /published to the catalogue directory/);
  assert.match(result.stderr, /did not confirm a publication status/);
});

test("an unrecognized publication status cannot report a fresh publication", (t) => {
  const f = fixture(t);
  const result = f.runPublication([OIDC, published(f, { status: "queued" })]);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /published to the catalogue directory/);
  assert.match(result.stderr, /did not confirm a publication status/);
});
