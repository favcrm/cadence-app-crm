# .github/workflows

- `ci.yml` (CAD-962, workflow name `package`) — read-only packaging CI: bundle
  shape check, unit tests, a byte-identical double build and archive
  verify/extract. Runs on PRs, pushes to main, the merge queue and manual
  dispatch. Actions pinned to commit SHAs per project convention.

No release or publication workflow exists yet.
