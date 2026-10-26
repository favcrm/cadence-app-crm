// AOS-376 / AOS-390: publish one immutable catalogue candidate from a tag.
//
// OIDC is the only publication path. GitHub proves this repository, workflow
// and tag; the catalogue then checks them against the reviewed publisher for
// its app id and stores the bundle as a DRAFT candidate. Nothing here can
// recommend, install or canary a release — that takes the demo owner's install
// and an operator promotion on the platform side.
//
// Removed with that contract: the MARKETPLACE_TOKEN clone/PR/auto-merge
// fallback. It wrote bytes before comparing them and gave one long-lived token
// the ability to change the catalogue; the API's version + digest checks are
// the enforcement point now, and CI only moves bytes to the OIDC endpoint.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

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
    else out[relative(root, full)] = readFileSync(full, "utf8");
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

// --- Released bundle identity -------------------------------------------------
const check = readJson(process.env.APP_CHECK_JSON ?? "/tmp/app-check.json", "app check report");
if (check.ok !== true) refuse("app check did not pass: " + JSON.stringify(check.refusal ?? check));
const digest = check.digest;
const version = check.version;
const app = check.name;
if (!digest || !version || !app || !check.title || !check.summary || !check.listing)
  refuse("app check did not report manifest identity and listing; add `listing:` to app.md");

// The catalogue binds a publication to the exact tag of the version it
// carries. A branch or a moved dispatch ref is not a reviewed release.
const tag = "v" + version;
if (process.env.GITHUB_REF !== "refs/tags/" + tag)
  refuse(`this release must be published from refs/tags/${tag}`);
if (!process.env.GITHUB_REPOSITORY) refuse("GITHUB_REPOSITORY is required");
if (EXPECTED_REPOSITORY && process.env.GITHUB_REPOSITORY !== EXPECTED_REPOSITORY)
  refuse(`this publisher belongs to ${EXPECTED_REPOSITORY}, not ${process.env.GITHUB_REPOSITORY}`);

// The workflow's host install-check must describe the same bytes.
const installCheck = readJson(
  process.env.APP_INSTALL_CHECK_JSON ?? "/tmp/app-install-check.json",
  "install-check report",
);
if (installCheck.error || installCheck.compatibility?.compatible !== true)
  refuse(
    "install-check did not pass: " +
      JSON.stringify(installCheck.error ?? installCheck.compatibility),
  );
if (installCheck.digest !== digest) refuse("install-check digest does not match app check");

const compatibility = {
  host:
    typeof installCheck.compatibility?.host?.core === "string"
      ? installCheck.compatibility.host.core
      : null,
  compatible: true,
  ...(installCheck.compatibility?.contracts &&
  typeof installCheck.compatibility.contracts === "object" &&
  !Array.isArray(installCheck.compatibility.contracts)
    ? { contracts: installCheck.compatibility.contracts }
    : {}),
};

// --- Upload bytes -------------------------------------------------------------
// `APP_UPLOAD_JSON` publishes a bundle another checked script already built;
// otherwise the app directory itself is the bundle, exactly as reviewed.
const upload = UPLOAD_JSON
  ? readFileSync(resolve(UPLOAD_JSON), "utf8")
  : JSON.stringify({ files: bundleFiles(APP_DIR) }, null, 2) + "\n";
if (Buffer.byteLength(upload) > 4 * 1024 * 1024) refuse("upload.json exceeds 4 MiB");
const uploadSha256 = sha256(upload);

const artifact = `marketplace/releases/${app}/${version}/upload.json`;
const entry = {
  id: app,
  app,
  title: check.title,
  summary: check.summary,
  version,
  listing: check.listing,
  // Overwritten by the catalogue with the token's own repository/commit; never
  // trusted from here.
  source: { repo: process.env.GITHUB_REPOSITORY, commit: process.env.GITHUB_SHA, path: APP_DIR },
  artifact: { path: artifact, sha256: uploadSha256 },
  digest,
  compatibility,
};

if (process.env.DRY_RUN === "1") {
  console.log(JSON.stringify({ entry, uploadSha256, ref: process.env.GITHUB_REF }, null, 2));
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
    "It is not recommended or installable until the demo company's owner",
    "installs exactly this release and the platform records that result, then",
    "an operator promotes it. No token here can do either step.",
  ].join("\n"),
);
