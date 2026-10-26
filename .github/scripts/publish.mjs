// AOS-376 / AOS-390 / AOS-384: publish one immutable catalogue candidate
// from a tag.
//
// OIDC is the only publication path. GitHub proves this repository, workflow
// and tag; the catalogue then checks them against the reviewed publisher for
// its app id, re-verifies the uploaded bytes/digest/identity, and stores the
// bundle as a DRAFT candidate. Nothing here can recommend, install or canary a
// release — that takes the demo owner's install and an operator promotion on
// the platform side.
//
// The native `app check` report supplies only the canonical bundle digest and
// inventory. A hosted-only package (for example, one declaring
// `app-storage: [1]`) is honestly refused by the native validator; that
// refusal is accepted as metadata-only and never rewritten into a
// compatibility or native-install success. Identity, title, summary and
// listing are parsed from the actual `app.md` with the pinned complete YAML
// parser, not from a second metadata file or a regex.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";

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
if (EXPECTED_REPOSITORY && process.env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY)
  refuse(`this publisher belongs to ${EXPECTED_REPOSITORY}, not ${process.env.GITHUB_REPOSITORY}`);

// `APP_UPLOAD_JSON` publishes a bundle another checked script already built;
// otherwise the app directory itself is the bundle, exactly as reviewed.
const upload = UPLOAD_JSON
  ? readFileSync(resolve(UPLOAD_JSON), "utf8")
  : JSON.stringify({ files }, null, 2) + "\n";
if (Buffer.byteLength(upload) > 4 * 1024 * 1024) refuse("upload.json exceeds 4 MiB");
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
  // the catalogue re-verifies the actual bundle before the immutable draft.
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
  refuse("catalogue refused the candidate: " + JSON.stringify(result));

console.log(JSON.stringify(result, null, 2));
if (result.data?.publication !== "draft")
  refuse("the catalogue did not store this release as an unrecommended candidate");
console.log(
  [
    `Published ${app} ${version} as an immutable draft candidate.`,
    `Digest ${digest}; upload sha256 ${uploadSha256}.`,
    "No native execution or host-compatibility claim was made.",
    "It is not recommended or installable until the demo company's owner",
    "installs exactly this release on a hosted host and the platform records",
    "that result, then an operator promotes it. No token here can do either step.",
  ].join("\n"),
);
