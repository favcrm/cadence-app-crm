# .github/workflows

- `ci.yml` (CAD-962, workflow name `package`) — read-only packaging CI: bundle
  shape check, unit tests, a byte-identical double build and archive
  verify/extract. Runs on PRs, pushes to main, the merge queue and manual
  dispatch. Actions pinned to commit SHAs per project convention.
- `publish.yml` (AOS-376 / AOS-390 / AOS-384) — tag-driven, OIDC-only
  publication of one immutable **draft** candidate. The exact pinned native
  checker supplies only the canonical digest/inventory; a hosted-only package
  (e.g. CRM's `app-storage: [1]`) may be refused with exit 3 and is still
  publishable as metadata. Identity, title, summary and listing are parsed from
  the real `app.md` by the pinned complete YAML parser; there is no native
  install-check, daemon or compatibility claim. The catalogue re-verifies the
  bytes, digest and identity, and cannot recommend/install/canary the release:
  the demo owner's hosted install plus an operator promotion is required. No
  long-lived catalogue token or Git/clone publication fallback.
