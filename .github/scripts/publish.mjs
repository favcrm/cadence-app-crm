// AOS-376 / AOS-390 / AOS-384 / AOS-431: publish one verified catalogue release
// from a tag.
//
// OIDC is the only publication path. GitHub proves this repository, workflow
// and tag; the catalogue then checks them against the reviewed publisher for
// its app id, re-verifies the uploaded bytes/digest/identity, and lists that
// exact version as `published` immediately. There is no draft review or
// promotion step, and nothing here can install, roll out a Cadence host or
// perform a customer/provider action — publication is not installation.
//
// Staged rollout: an older deployed API still stores the bundle as an unlisted
// `draft` and answers with that state. This publisher then refuses (nonzero)
// and says the candidate API must be deployed first; it never prints or
// implies a completed publication for a draft.
//
// A success receipt must echo this verified release, this workflow's repository
// and commit, and a `published` or `unchanged` status; anything else is refused
// rather than reported as a completed publication.
//
// The native `app check` report supplies only the canonical bundle digest and
// inventory. A hosted-only package (for example, one declaring
// `app-storage: [1]`) is honestly refused by the native validator; that
// refusal is accepted as metadata-only and never rewritten into a
// compatibility or native-install success. Identity, title, summary and
// listing are parsed from the actual `app.md` with the pinned complete YAML
// parser, not from a second metadata file or a regex.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";

const APP_DIR = process.env.APP_DIR ?? "app";
const UPLOAD_JSON = process.env.APP_UPLOAD_JSON ?? "";
const EXPECTED_REPOSITORY = process.env.EXPECTED_REPOSITORY ?? "";
const PUBLISH_URL =
  process.env.CATALOGUE_PUBLISH_URL ?? "https://api-v2.agenticos.hk/public/apps/candidates";

function refuse(message) {
  console.error("publish refused: " + message);
  process.exit(1);
}

let destination;
try {
  destination = new URL(PUBLISH_URL);
} catch {
  refuse("a candidate endpoint URL is required");
}
if (
  destination.protocol !== "https:" ||
  destination.pathname !== "/public/apps/candidates" ||
  destination.username ||
  destination.password ||
  destination.search ||
  destination.hash
)
  refuse("only the HTTPS candidate endpoint is supported; legacy publication is unsafe");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bundleFiles(dir, out = {}, root = dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) bundleFiles(full, out, root);
    else out[relative(root, full).split(sep).join("/")] = readFileSync(full, "utf8");
  }
  return out;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return refuse(`${label} is missing or not JSON`);
  }
}

function manifestDocument(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") refuse("app.md must start with a --- frontmatter fence");
  const end = lines.findIndex(
    (line, index) => index > 0 && (line === "---" || line.startsWith("--- ")),
  );
  if (end < 0) refuse("app.md frontmatter has no closing --- fence");
  try {
    return parseYaml(lines.slice(1, end).join("\n"), { uniqueKeys: true });
  } catch (error) {
    return refuse(
      "app.md frontmatter is not valid YAML: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

/** A bounded JSON-compatible value from the parsed manifest. */
function plainJson(value, depth = 0) {
  if (depth > 16) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 4096 && value.every((item) => plainJson(item, depth + 1));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const entries = Object.entries(value);
    return entries.length <= 128 && entries.every(([, item]) => plainJson(item, depth + 1));
  }
  return false;
}

function identityText(value, field, limit) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > limit ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  )
    refuse(`app.md ${field} must be 1–${limit} printable characters`);
  return value;
}

// --- Manifest identity and listing -------------------------------------------
const manifest = manifestDocument(
  readFileSync(resolve(APP_DIR, "app.md"), "utf8"),
);
if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
  refuse("app.md frontmatter must be a YAML mapping");
const app = identityText(manifest.app, "app", 32);
if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(app)) refuse("app.md app is not an app id");
const title = identityText(manifest.title, "title", 120);
const version = identityText(manifest.version, "version", 40);
if (!/^\d+\.\d+\.\d+$/.test(version)) refuse("app.md version must be X.Y.Z");
const summary = identityText(manifest.summary, "summary", 160);
const listing = manifest.listing;
if (
  !listing ||
  typeof listing !== "object" ||
  Array.isArray(listing) ||
  Object.keys(listing).length === 0 ||
  !plainJson(listing)
)
  refuse("app.md listing must be a non-empty JSON-compatible mapping");

// --- Native report: canonical digest and inventory only -----------------------
const check = readJson(process.env.APP_CHECK_JSON ?? "/tmp/app-check.json", "app check report");
if (!check || typeof check !== "object" || Array.isArray(check))
  refuse("app check report is not an object");
if (check.ok !== true && check.ok !== false)
  refuse("app check report has no ok verdict");
if (
  check.ok === false &&
  (!check.refusal ||
    check.refusal.code !== "app_check_content" ||
    typeof check.refusal.message !== "string" ||
    check.refusal.message.length === 0)
)
  refuse("app check refused before metadata content; no digest/inventory to publish");
if (check.ok === true) {
  if (check.name !== app || check.version !== version)
    refuse("app check identity does not match app.md");
}
const digest = check.digest;
if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest))
  refuse("app check report has no canonical sha256 digest");
if (!Array.isArray(check.files) || check.files.length === 0)
  refuse("app check report has no bundle inventory");

const inventory = new Map();
for (const entry of check.files) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    refuse("app check inventory entry is not an object");
  const path = entry.path;
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    refuse("app check inventory path is not a normalized relative path");
  if (inventory.has(path)) refuse("app check inventory repeats a path");
  if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
    refuse("app check inventory has no byte count");
  inventory.set(path, entry.bytes);
}

// --- Bundle bytes -------------------------------------------------------------
const files = bundleFiles(APP_DIR);
const paths = Object.keys(files).sort();
if (
  inventory.size !== paths.length ||
  paths.some((path) => !inventory.has(path))
)
  refuse("app check inventory does not describe this bundle's files");
for (const path of paths) {
  if (inventory.get(path) !== Buffer.byteLength(files[path], "utf8"))
    refuse(`app check inventory byte count differs for ${path}`);
}

// The catalogue binds a publication to the exact tag of the version it
// carries. A branch or a moved dispatch ref is not a reviewed release.
const tag = "v" + version;
if (process.env.GITHUB_REF !== "refs/tags/" + tag)
  refuse(`this release must be published from refs/tags/${tag}`);
if (!process.env.GITHUB_REPOSITORY) refuse("GITHUB_REPOSITORY is required");
if (!process.env.GITHUB_SHA) refuse("GITHUB_SHA is required");
if (EXPECTED_REPOSITORY && process.env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY)
  refuse(`this publisher belongs to ${EXPECTED_REPOSITORY}, not ${process.env.GITHUB_REPOSITORY}`);

// `APP_UPLOAD_JSON` publishes a bundle another checked script already built;
// otherwise the app directory itself is the bundle, exactly as reviewed.
const upload = UPLOAD_JSON
  ? readFileSync(resolve(UPLOAD_JSON), "utf8")
  : JSON.stringify({ files }, null, 2) + "\n";
if (Buffer.byteLength(upload) > 4 * 1024 * 1024) refuse("upload.json exceeds 4 MiB");

// Inspect the exact payload, not just APP_DIR. Duplicate/ignored JSON members
// could otherwise transfer bytes that no validator saw.
let payload;
try {
  payload = JSON.parse(upload);
  const document = parseDocument(upload, { uniqueKeys: true });
  if (document.errors.length !== 0 || document.warnings.length !== 0)
    refuse("upload.json contains ambiguous keys");
} catch {
  refuse("upload.json is not unambiguous JSON");
}
if (
  !payload ||
  typeof payload !== "object" ||
  Array.isArray(payload) ||
  Object.keys(payload).length !== 1 ||
  !payload.files ||
  typeof payload.files !== "object" ||
  Array.isArray(payload.files) ||
  Object.keys(payload.files).length !== paths.length ||
  paths.some((path) => payload.files[path] !== files[path])
)
  refuse("upload.json does not contain exactly the inspected bundle members");

// A Native content refusal can also mean a blocked credential. Its stage code
// is not a safety receipt. Scan every exact uploaded member independently,
// before either diagnostics or OIDC, with no inherited operator allowlist.
const scannerState = mkdtempSync(join(tmpdir(), "crm-publish-secrets-"));
let scanFailure = null;
try {
  for (const path of paths) {
    const scan = spawnSync("cadence", ["--state-dir", scannerState, "secret", "scan"], {
      input: payload.files[path],
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    let report = null;
    try {
      report = JSON.parse(scan.stdout ?? "");
    } catch {
      // A missing or malformed receipt never authorizes publication.
    }
    if (scan.status !== 0 || report?.blocking !== 0) {
      scanFailure =
        Number.isSafeInteger(report?.blocking) && report.blocking > 0
          ? `credential-shaped text found in ${path}`
          : `credential scanner unavailable or invalid for ${path}`;
      break;
    }
  }
} finally {
  rmSync(scannerState, { recursive: true, force: true });
}
if (scanFailure !== null) refuse(scanFailure);
const uploadSha256 = sha256(upload);

const artifact = `marketplace/releases/${app}/${version}/upload.json`;
const entry = {
  id: app,
  app,
  version,
  title,
  summary,
  listing,
  // Overwritten by the catalogue with the token's own repository/commit; never
  // trusted from here.
  source: { repo: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, path: APP_DIR },
  artifact: { path: artifact, sha256: uploadSha256 },
  digest,
  // Deliberately absent: this publisher makes no host-compatibility claim.
  // A native refusal (including unsupported `app-storage`) is metadata-only;
  // the catalogue re-verifies the actual bundle before it lists the version.
};

if (process.env.DRY_RUN === "1") {
  console.log(
    JSON.stringify(
      {
        entry,
        uploadSha256,
        ref: process.env.GITHUB_REF,
        native: { ok: check.ok, refusal: check.refusal?.code ?? null },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// --- Trusted publication -------------------------------------------------------
if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
  refuse("GitHub OIDC is required; this repository has no long-lived catalogue token");

const requestUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
requestUrl.searchParams.set("audience", "agenticos-catalogue");
const tokenResponse = await fetch(requestUrl, {
  headers: { authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
});
if (!tokenResponse.ok) refuse("OIDC token request failed: " + tokenResponse.status);
const { value } = await tokenResponse.json();
if (typeof value !== "string" || value.length === 0) refuse("OIDC token request returned no token");

const response = await fetch(PUBLISH_URL, {
  method: "POST",
  redirect: "error",
  headers: { "content-type": "application/json", authorization: `Bearer ${value}` },
  body: JSON.stringify({ upload, entry }),
});
const result = await response.json().catch(() => null);
if (!response.ok || !result || result.ok !== true)
  refuse("catalogue refused the release (" + response.status + "): " + JSON.stringify(result));

// The catalogue lists a verified release as `published`; anything else is not
// a completed publication. An older deployed API still answers `draft` and
// stored the bundle unlisted, so the rollout gate is an explicit refusal, not
// a warning on a green workflow.
const data = result.data;
const publication = data?.publication;
if (publication === "draft")
  refuse(
    "the deployed catalogue API stored this release as an unlisted draft; " +
      "deploy the candidate API that lists verified releases, then publish again",
  );
if (publication !== "published")
  refuse(
    "the catalogue did not confirm a listed publication: " +
      JSON.stringify(publication ?? null),
  );
if (data.id !== app || data.version !== version || data.digest !== digest)
  refuse("the catalogue confirmed a different release than this verified bundle");
// The success message claims this workflow's provenance, so the catalogue must
// echo the repository and commit it derived from the OIDC token.
if (data.repository !== process.env.GITHUB_REPOSITORY || data.commit !== process.env.GITHUB_SHA)
  refuse("the catalogue confirmed a different repository or commit than this workflow");
// Only a fresh listing or an exact idempotent replay is a completed
// publication; an absent or unknown status is not.
if (data.status !== "published" && data.status !== "unchanged")
  refuse("the catalogue did not confirm a publication status: " + JSON.stringify(data.status ?? null));

console.log(JSON.stringify(result, null, 2));
const listed =
  data.status === "unchanged"
    ? "already listed from this exact repository, commit and digest"
    : "published to the catalogue directory";
console.log(
  [
    `${app} ${version} is ${listed} (publication: published).`,
    `Digest ${digest}; upload sha256 ${uploadSha256}.`,
    "The catalogue listed this exact version after re-verifying the uploaded bytes, digest and identity.",
    "No native execution or host-compatibility claim was made.",
    "Listing is not installation: a hosted tenant installs exactly this digest",
    "through its owner's consent-aware install or update path. No token here",
    "rolls out a Cadence host or performs a customer/provider action.",
  ].join("\n"),
);
