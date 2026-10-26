# .github/workflows

- `ci.yml` (CAD-962, workflow name `package`) — read-only packaging CI: bundle
  shape check, unit tests, a byte-identical double build and archive
  verify/extract. Runs on PRs, pushes to main, the merge queue and manual
  dispatch. Actions pinned to commit SHAs per project convention.
- `publish.yml` (AOS-376 / AOS-390) — tag-driven release publication. Proves
  the tag, manifest, bundle digest and host install-check, then delivers one
  immutable **draft** candidate to the catalogue over GitHub OIDC from
  `.github/scripts/publish.mjs`. It cannot recommend, install or canary the
  release: the demo company's owner installs that exact version, the platform
  records the result, and an operator promotes it. The Cadence qualification
  host is an exact version (input or `CADENCE_TARGET_VERSION`), never "latest".
  There is no long-lived catalogue token and no Git/clone publication fallback.
