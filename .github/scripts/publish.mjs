// AOS-376: turn a version release into a reviewed-by-CI marketplace PR.
// The tenant's install/approve is the product gate; this script only moves bytes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const APP_DIR = "app";
const REPO = process.env.GITHUB_REPOSITORY ?? "favcrm/cadence-app-works";
const ISSUE = process.env.PUBLISH_ISSUE ?? "AOS-376";
const MARKETPLACE = "agenticos-stack/agenticos-v2";
const token = process.env.MARKETPLACE_TOKEN;
const dryRun = process.env.DRY_RUN === "1";
const localMarketplace = process.env.MARKETPLACE_DIR;

function sh(cmd, args, cwd, env = {}) {
  return execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] }).toString();
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const check = JSON.parse(readFileSync(process.env.APP_CHECK_JSON ?? "/tmp/app-check.json", "utf8"));
if (!check.ok) throw new Error("app check refused: " + JSON.stringify(check.refusal ?? check));
const digest = check.digest;
const version = check.version;
const app = check.name;
if (!digest || !version || !app || !check.title || !check.summary || !check.listing) {
  throw new Error(
    "app check did not report the manifest identity and listing; " +
      "add `listing:` to app.md and run a Cadence build that reports it",
  );
}
// The workflow runs the target host's install-check before this step. Keep
// the two reports honest when both are supplied: the same bytes, the same
// digest, and an explicit compatible result.
const installCheckPath = process.env.APP_INSTALL_CHECK_JSON;
if (!installCheckPath) {
  throw new Error(
    "install-check report is required; run `cadence app catalog install-check` " +
      "against the target host before publishing",
  );
}
{
  const installCheck = JSON.parse(readFileSync(installCheckPath, "utf8"));
  if (installCheck.error || installCheck.compatibility?.compatible !== true) {
    throw new Error(
      "install-check refused: " +
        JSON.stringify(installCheck.error ?? installCheck.compatibility ?? installCheck),
    );
  }
  if (installCheck.digest !== digest) {
    throw new Error("install-check digest does not match app check");
  }
}

const files = {};
for (const full of walk(APP_DIR).sort()) files[relative(APP_DIR, full)] = readFileSync(full, "utf8");
const upload = JSON.stringify({ files }, null, 2) + "\n";
const artifact = `marketplace/releases/${app}/${version}/upload.json`;
const entry = {
  id: app,
  app,
  title: check.title,
  summary: check.summary,
  version,
  listing: check.listing,
  source: { repo: REPO, commit: process.env.GITHUB_SHA, path: APP_DIR },
  artifact: { path: artifact, sha256: sha256(upload) },
  digest,
};

function applyTo(dir) {
  mkdirSync(join(dir, "marketplace/releases", app, version), { recursive: true });
  writeFileSync(join(dir, artifact), upload);
  const manifestPath = join(dir, "marketplace/apps.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const index = manifest.apps.findIndex((a) => a.id === app);
  const current = index >= 0 ? manifest.apps[index] : null;
  const artifactPath = join(dir, artifact);
  const sameBytes = statSync(artifactPath, { throwIfNoEntry: false }) && sha256(readFileSync(artifactPath)) === sha256(upload);
  if (current && current.version === version && current.digest === digest && current.artifact?.sha256 === sha256(upload) && sameBytes) {
    console.log("marketplace already carries this version, digest and artifact; nothing to do");
    return false;
  }
  const json = JSON.stringify(entry, null, 2) + "\n";
  if (index >= 0) manifest.apps[index] = entry;
  else manifest.apps.push(entry);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return true;
}

if (dryRun) {
  console.log(JSON.stringify({ entry, artifactSha256: sha256(upload), files: Object.keys(files) }, null, 2));
  process.exit(0);
}

if (localMarketplace) {
  if (applyTo(localMarketplace)) console.log("wrote the marketplace files under " + localMarketplace);
  process.exit(0);
}

// npm-style trusted publishing: GitHub proves the repository/commit with a
// short-lived OIDC token; the catalogue needs no PAT and derives the source.
if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
  const requestUrl = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  requestUrl.searchParams.set("audience", "agenticos-catalogue");
  const tokenResponse = await fetch(requestUrl, {
    headers: { authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!tokenResponse.ok) throw new Error("OIDC token request failed: " + tokenResponse.status);
  const { value } = await tokenResponse.json();
  const response = await fetch(
    process.env.CATALOGUE_PUBLISH_URL ?? "https://api-v2.agenticos.hk/public/apps/publish",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${value}` },
      body: JSON.stringify({ upload, entry }),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error("publish refused: " + JSON.stringify(result));
  console.log(JSON.stringify(result));
  process.exit(0);
}

if (!token) throw new Error("MARKETPLACE_TOKEN is required (contents + pull-requests on " + MARKETPLACE + ")");
const dir = mkdtempSync(join(tmpdir(), "marketplace-"));
const url = `https://x-access-token:${token}@github.com/${MARKETPLACE}.git`;
sh("git", ["clone", "--depth=1", "--branch", "staging", url, dir], process.cwd());
if (!applyTo(dir)) process.exit(0);
sh("git", ["-c", "user.name=cadence-release-bot", "-c", "user.email=release-bot@favcrm.local", "checkout", "-b", `publish/${app}-${version}`], dir);
sh("git", ["add", "-A"], dir);
sh("git", ["-c", "user.name=cadence-release-bot", "-c", "user.email=release-bot@favcrm.local", "commit", "-m", `Publish ${app} ${version}`], dir);
sh("git", ["push", "origin", `publish/${app}-${version}`], dir, { GH_TOKEN: token });
const title = `Publish ${app} ${version}`;
const body = `Automated release from ${REPO}@${process.env.GITHUB_SHA}.\n\n- Bundle: ${artifact} (sha256:${entry.artifact.sha256})\n- Digest: ${digest}\n- Review is the tenant install/approve; the marketplace CI gates the merge.\n\nIssue: ${ISSUE}`;
const pr = sh("gh", ["pr", "create", "--repo", MARKETPLACE, "--base", "staging", "--head", `publish/${app}-${version}`, "--title", title, "--body", body], dir, { GH_TOKEN: token }).trim();
console.log(pr);
try {
  sh("gh", ["pr", "merge", pr, "--repo", MARKETPLACE, "--auto", "--merge"], dir, { GH_TOKEN: token });
  console.log("auto-merge enabled");
} catch (error) {
  console.log("auto-merge unavailable; the PR is open for CI and normal merge: " + error.message);
}
