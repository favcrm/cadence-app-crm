#!/usr/bin/env node
/**
 * CAD-974 canonical contract check for CRM dev fixture definitions.
 *
 * Validates dev/app-views-v1.json and dev/fixtures.json against the REAL
 * canonical app-views/v1 validator read from the pinned Git objects of an
 * explicitly selected trusted Cadence host checkout — never a vendored,
 * hand-copied or worktree-modified source.
 *
 * The pinned host checkout supplies, via `git show <rev>:<path>`:
 *   contracts/app-views/v1/app-view.schema.json     (the published schema)
 *   ui/src/features/app-shell/app-views/contract.ts  (parseAppView / fixtureRows)
 * The tool root supplies only the TypeScript compiler from its installed
 * ui/node_modules — it never contributes contract logic.
 *
 * Usage:
 *   node scripts/check_app_views.mjs [--host-source <abs path>]
 *                                    [--tool-root  <abs path>]
 *
 * Default --host-source is the assigned CAD-970 trusted checkout. The
 * script refuses unless `git rev-parse HEAD` there equals the pinned
 * revision AND the exact bytes of the two canonical files match
 * `git show <pinned>:<path>` — a dirty or substituted worktree fails.
 * --tool-root defaults to /home/ubuntu/Project/cadence.
 *
 * Exit 0 = every check passed and was reported. Exit 1 = any refusal.
 *
 * What this proves: the CRM descriptor and its synthetic rows satisfy
 * the exact canonical grammar and strict consumer rules the trusted
 * host enforces, checked against immutable Git-object bytes. What it
 * does NOT prove: rendering, HMR, installation, live actions, or any
 * host acceptance — those are separate slices.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const APP_ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const DESCRIPTOR_FILE = resolve(APP_ROOT, "dev/app-views-v1.json");
const FIXTURES_FILE = resolve(APP_ROOT, "dev/fixtures.json");

/** The only host source this check is reviewed against. */
const PINNED_HOST_SOURCE =
  "/home/ubuntu/Project/cadence/.cadence/wt/cad-970-independent-apps-structured-git";
const PINNED_HOST_REV = "5577dea81ef3b39134199ed7b7c5541235baae4a";
const DEFAULT_TOOL_ROOT = "/home/ubuntu/Project/cadence";

/** Canonical files, as Git paths inside the host checkout. */
const CANONICAL_SCHEMA = "contracts/app-views/v1/app-view.schema.json";
const CANONICAL_CONTRACT = "ui/src/features/app-shell/app-views/contract.ts";

/* ------------------------------- options ------------------------------ */
export function checkOptions(args = []) {
  const o = { hostSource: PINNED_HOST_SOURCE, toolRoot: DEFAULT_TOOL_ROOT };
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i], v = args[i + 1];
    if (v === undefined) throw new Error(`Missing value for ${k}`);
    if (k === "--host-source" && isAbsolute(v)) o.hostSource = v;
    else if (k === "--tool-root" && isAbsolute(v)) o.toolRoot = v;
    else throw new Error(`Unsupported option ${k}`);
  }
  return o;
}

/** Throw a bounded refusal — the caller's `finally` still cleans up. */
function refuse(msg) {
  throw new Error(`REFUSED: ${msg}`);
}
function ok(msg) {
  console.log(`  ok  ${msg}`);
}
let passed = 0;
function assert(cond, msg) {
  if (!cond) refuse(msg);
  passed++;
}

/* ------------------ pinned Git-object canonical reads ------------------ */

function gitShow(hostDir, gitPath) {
  try {
    return execFileSync(
      "git",
      ["show", `${PINNED_HOST_REV}:${gitPath}`],
      { cwd: hostDir, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (e) {
    refuse(`cannot read ${PINNED_HOST_REV}:${gitPath} from ${hostDir}: ${e.message}`);
  }
}

/**
 * Verify the host checkout is exactly the pinned revision AND that the
 * two canonical source files' worktree bytes match the pinned Git objects
 * byte-for-byte. A moved HEAD or a dirty/substituted worktree file both
 * refuse. All git invocations use execFile argv — no shell interpolation.
 */
export function verifyHostPin(hostSource) {
  const real = realpathSync(hostSource);
  let rev;
  try {
    rev = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: real,
      encoding: "utf8",
    }).trim();
  } catch (e) {
    refuse(`cannot resolve host source revision at ${real}: ${e.message}`);
  }
  if (rev !== PINNED_HOST_REV) {
    refuse(
      `host source ${real} is at ${rev}, expected pinned ${PINNED_HOST_REV}. ` +
        `Validate against the reviewed checkout, not a moved tree.`,
    );
  }
  // Worktree bytes must equal the pinned Git-object bytes — a dirty or
  // substituted canonical file refuses even when HEAD is correct.
  for (const p of [CANONICAL_SCHEMA, CANONICAL_CONTRACT]) {
    const worktree = readFileSync(resolve(real, p), "utf8");
    const pinned = gitShow(real, p);
    if (worktree !== pinned) {
      refuse(
        `canonical file ${p} differs from pinned object ${PINNED_HOST_REV}. ` +
          `The worktree is dirty or substituted — validate pinned bytes only.`,
      );
    }
  }
  return { real, rev };
}

/* ----------------- compile the pinned canonical contract --------------- */
function buildContract(host, toolRoot, workDir) {
  const schemaText = gitShow(host.real, CANONICAL_SCHEMA);
  const contractText = gitShow(host.real, CANONICAL_CONTRACT);
  const schema = JSON.parse(schemaText);
  if (schema.$id !== "urn:cadence:contracts:app-views:v1:descriptor") {
    refuse("pinned schema $id mismatch — not the published app-views/v1 schema");
  }

  // Resolve tsc from the tool root's installed ui/node_modules only.
  const toolRequire = createRequire(resolve(toolRoot, "ui/package.json"));
  let tscBin;
  try {
    tscBin = toolRequire.resolve("typescript/bin/tsc");
  } catch {
    refuse(
      `typescript not installed under ${toolRoot}/ui — ` +
        `run \`pnpm -C ${toolRoot}/ui install --frozen-lockfile\` first.`,
    );
  }

  // Write the *pinned-object* contract bytes into the caller's temp dir and
  // compile those — never the worktree file, which could be modified.
  const src = join(workDir, "contract.ts");
  writeFileSync(src, contractText, "utf8");
  try {
    execFileSync(
      process.execPath,
      [
        tscBin, src,
        "--outDir", workDir,
        "--module", "commonjs",
        "--target", "ES2022",
        "--moduleResolution", "node",
        "--strict", "--skipLibCheck", "--noEmitOnError",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    refuse(`pinned canonical contract.ts failed to compile: ${e.stderr || e.message}`);
  }
  const mod = join(workDir, "contract.js");
  if (!existsSync(mod)) refuse(`compiled contract.js not found under ${workDir}`);
  return { mod, schema };
}

/* ------------------------------ the checks ---------------------------- */
async function run(host, toolRoot) {
  // One temp dir owns the compiled contract; `finally` always cleans it.
  const workDir = mkdtempSync(join(tmpdir(), "cad974-contract-"));
  try {
    const { mod, schema } = buildContract(host, toolRoot, workDir);
    const contract = await import(pathToFileURL(mod).href);
    const {
      parseAppView,
      fixtureRows,
      describeAppView,
      AppViewContractError,
    } = contract;
    assert(
      typeof parseAppView === "function" && typeof fixtureRows === "function",
      "canonical contract module does not export parseAppView/fixtureRows",
    );
    ok(`pinned app-view.schema.json ($id verified) from ${PINNED_HOST_REV}`);

    /* -- 2. Descriptor parses through the canonical gate ----------------- */
    const rawDescriptor = JSON.parse(readFileSync(DESCRIPTOR_FILE, "utf8"));
    const descriptor = parseAppView(rawDescriptor);
    assert(descriptor.contract === "app-views/v1", "descriptor contract tag wrong");
    assert(descriptor.app === "crm", "descriptor app kind is not crm");
    assert(descriptor.views.length === 5, `expected 5 views, got ${descriptor.views.length}`);
    const ids = descriptor.views.map((v) => v.id).sort();
    assert(
      JSON.stringify(ids) ===
        JSON.stringify(["campaigns", "customer-detail", "customer-form", "customers", "segments"]),
      `unexpected view ids: ${ids.join(", ")}`,
    );
    ok("descriptor parses clean through canonical parseAppView (5 views)");

    /* -- 3. Fixture scenarios validate per non-form view ----------------- */
    const rawFixtures = JSON.parse(readFileSync(FIXTURES_FILE, "utf8"));
    const scenarios = { ...rawFixtures };
    delete scenarios.$comment;
    const scenarioKeys = Object.keys(scenarios).sort();
    assert(
      JSON.stringify(scenarioKeys) === JSON.stringify(["empty", "populated"]),
      `fixtures must carry exactly populated+empty scenarios; got ${scenarioKeys.join(", ")}`,
    );
    for (const scenarioName of ["populated", "empty"]) {
      const scenario = scenarios[scenarioName];
      if (typeof scenario !== "object" || scenario === null || Array.isArray(scenario)) {
        refuse(`scenario "${scenarioName}" must be an object of view-id → row-array`);
      }
      // Reject unknown view keys.
      for (const key of Object.keys(scenario)) {
        if (!descriptor.views.some((v) => v.id === key)) {
          refuse(`fixtures "${scenarioName}" declares rows for undeclared view "${key}"`);
        }
      }
      for (const view of descriptor.views) {
        const rows = scenario[view.id];
        if (view.kind === "form") {
          // A form declares no fields: canonical fixtureRows refuses any
          // rows. Require an explicit empty array — never invoke the
          // validator to claim a form-row "pass".
          if (!Array.isArray(rows)) {
            refuse(`form view "${view.id}" in "${scenarioName}" must be an array`);
          }
          if (rows.length !== 0) {
            refuse(`form view "${view.id}" in "${scenarioName}" must be empty`);
          }
          continue;
        }
        if (!Array.isArray(rows)) {
          refuse(`view "${view.id}" in "${scenarioName}" must be a row array`);
        }
        const bound = fixtureRows(view, rows);
        if (scenarioName === "populated") {
          assert(bound.length > 0, `populated scenario "${view.id}" has zero rows`);
        } else {
          assert(bound.length === 0, `empty scenario "${view.id}" has ${bound.length} rows`);
        }
      }
      ok(`"${scenarioName}" scenario: all non-form views validate through fixtureRows`);
    }
    ok("fixture scenario shape and keys are strict (populated + empty; form empty)");

    /* -- 4. Real negative checks: parse a known-good baseline, then ------ */
    /* --    mutate exactly one field/key per refusal and assert path. ---- */
    const refusePath = (fn, value, wantPath, why) => {
      try {
        fn(value);
      } catch (e) {
        if (!(e instanceof AppViewContractError)) {
          refuse(`${why}: wrong error type ${String(e)}`);
        }
        if (wantPath && !e.path.startsWith(wantPath)) {
          refuse(`${why}: refused at ${e.path}, expected ${wantPath}`);
        }
        passed++;
        return;
      }
      refuse(`${why}: expected a refusal`);
    };

    // The accepted baseline is our real, already-parsed descriptor — deep
    // copy so a mutation can never corrupt the original.
    const baseline = () => JSON.parse(JSON.stringify(rawDescriptor));
    // First prove the baseline itself is accepted (no unrelated refusal).
    parseAppView(baseline());
    ok("accepted descriptor baseline parses before mutation");

    // 4a. Forbidden action/authority keys at descriptor root.
    for (const key of ["action", "effect", "install_id", "actor", "scope", "url", "href", "script"]) {
      const d = baseline();
      d[key] = "send";
      refusePath(parseAppView, d, "$", `descriptor key "${key}" must refuse`);
    }
    ok("descriptor-root forbidden keys refuse at $ (action/effect/install_id/actor/scope/url/href/script)");

    // 4b. Forbidden key nested inside a declared field.
    {
      const d = baseline();
      d.views[0].fields[0].url = "https://evil.invalid";
      refusePath(parseAppView, d, "$.views.0.fields", "url inside a field must refuse");
    }
    {
      const d = baseline();
      d.views[0].fields[0].action = "send";
      refusePath(parseAppView, d, "$.views.0.fields", "action inside a field must refuse");
    }
    ok("field-level forbidden keys refuse at $.views.N.fields (url, action)");

    // 4c. Wrong contract tag.
    {
      const d = baseline();
      d.contract = "app-views/v2";
      refusePath(parseAppView, d, "$.contract", "wrong contract tag must refuse");
    }
    ok("non-v1 contract tag refuses at $.contract");

    // 4d. Undeclared fixture-row keys / bad enum values refuse on the real view.
    const custView = descriptor.views.find((v) => v.id === "customers");
    refusePath(
      (v) => fixtureRows(custView, v),
      [{ name: "Ada", ghost_field: "x" }],
      "rows.0.ghost_field",
      "undeclared row key must refuse",
    );
    refusePath(
      (v) => fixtureRows(custView, v),
      [{ name: "Ada", tier: "superuser" }],
      "rows.0.tier",
      "undeclared enum value must refuse",
    );
    refusePath(
      (v) => fixtureRows(custView, v),
      [{ name: "Ada", url: "https://evil.invalid" }],
      "rows.0",
      "url row key must refuse",
    );
    ok("undeclared/authority-claiming fixture row keys refuse at rows.0.*");

    // 4e. Inert markup text stays data.
    const inert = fixtureRows(custView, [{ name: "<script>alert(1)</script>" }]);
    assert(
      inert[0].name === "<script>alert(1)</script>",
      "inert markup cell did not survive as plain text",
    );
    ok("inert markup in a fixture cell stays a plain string (no DOM sink)");

    /* -- 5. describeAppView reports without throwing --------------------- */
    const good = describeAppView(rawDescriptor);
    assert(good.ok === true, "describeAppView reports the real descriptor not-ok");
    const bad = describeAppView({ contract: "nope" });
    assert(bad.ok === false, "describeAppView reports a bad descriptor as ok");
    ok("describeAppView agrees: real descriptor ok, foreign tag refused");

    console.log(`\nPASS — ${passed} canonical contract checks passed against ${host.rev}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function main() {
  const o = checkOptions(process.argv.slice(2));
  const host = verifyHostPin(o.hostSource);
  console.log(`CRM app-views/v1 contract check (CAD-974)`);
  console.log(`host source : ${host.real} @ ${host.rev} (pinned)`);
  console.log(`tool root   : ${o.toolRoot}`);
  await run(host, o.toolRoot);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message ?? String(e));
    process.exit(1);
  });
}
