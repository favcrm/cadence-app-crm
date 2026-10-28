# .github/workflows

- `ci.yml` (CAD-962, workflow name `package`) — read-only packaging CI: bundle
  shape check, unit tests, a byte-identical double build and archive
  verify/extract. Runs on PRs, pushes to main, the merge queue and manual
  dispatch. Actions pinned to commit SHAs per project convention.
  Publisher boundary tests use the real released Cadence v0.3.2 secret scanner,
  with its archive checksum pinned in CI. This is not storage qualification.
- `publish.yml` (AOS-376 / AOS-390 / AOS-384 / AOS-431) — tag-driven,
  OIDC-only publication of one verified release, listed as `published`
  immediately. The exact pinned native checker supplies only the canonical
  digest/inventory; a hosted-only package (e.g. CRM's `app-storage: [1]`) may be
  refused with exit 3. That stage code can also wrap a secret rejection, so it
  never grants safety or compatibility. Identity, title, summary and listing are
  parsed from the real `app.md` by the pinned complete YAML parser; there is no
  native install-check, daemon or compatibility claim. The catalogue
  re-verifies the bytes, digest and identity and lists the version; the
  publisher requires `publication: published`, a `published`/`unchanged` status
  and the exact id/version/digest plus its own repository/commit in the receipt.
  An older deployed API answers `draft`, which is an unlisted release: the
  publisher then exits nonzero and asks for the candidate API to be deployed,
  so a staged rollout never reports success for a draft. Listing is not
  installation — a hosted tenant still installs that exact digest through its
  owner's consent path. No long-lived catalogue token or Git/clone publication
  fallback.

The publisher always runs the real `cadence secret scan` over every exact
uploaded member, including `DRY_RUN=1`. Each invocation uses fresh isolated
state, not an operator allowlist; a missing CLI, invalid receipt, scanner error
or blocking finding refuses before OIDC or upload. The pinned native CLI must
be on `PATH` for local publisher checks. An `APP_UPLOAD_JSON` override must be
unambiguous JSON containing exactly the inspected files and bytes; duplicate
keys, ignored fields and substitutions refuse. No credential value or raw
scanner diagnostic is printed.

Publication still requires an exact released checker containing grammar v2,
selected through `cadence_version` or `CADENCE_TARGET_VERSION`. The separate
v0.3.2 CI scanner pin does not supply that release prerequisite.
