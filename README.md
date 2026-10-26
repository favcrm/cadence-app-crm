# Cadence CRM App

Public repository: https://github.com/favcrm/cadence-app-crm.
App identity stays `crm`; repository names do not change installation or data identities.

## Local development

Use the Node version in `screen-ui.lock.json` and pnpm version in `package.json`.
The shared screen SDK archive is committed; no Cadence checkout or SDK rebuild is needed.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed `/dev/preview/` URL. For Cadence versions supporting package development:

```sh
cadence app dev --package . --port 3186
```

This runs the actual Customers, Segments and Campaigns source with the committed
`@cadence/screen-ui` SDK, surrounded by a local workspace header, sidebar and assistant
panel. Create/edit customers and segments, create Blank or Paste HTML campaigns,
edit/save campaign revisions and clone drafts against browser-memory fixtures.
Reload or **Reset local data** discards changes. Source edits hot reload.

The outer chrome approximates the Cadence workspace layout; it is not an authenticated
host session. Chat is an offline panel with a draft field, not a simulated AI.
Imports, sender setup, chat, approvals and sends remain unavailable. No daemon,
installation, credentials or live data is involved.
If a port is occupied, choose another in 3110–3199:

```sh
CADENCE_APP_PORT=3193 pnpm dev
```

See [development-loop.md](docs/development-loop.md) for behavior and limits.

## Ownership and shipping

- `src/` owns CRM screens and typed bridge clients; shared controls come from the versioned SDK.
- `app/` is the installable package, including generated screen assets, app declarations and
  the app-owned `app-storage.json` + `storage/*.json` schema plan.
- `dev/preview/` is local-only tooling; it is not a production host or part of the screen build.
- `scripts/build_screen.mjs` and `scripts/verify_screen.mjs` retain the existing SDK/provenance and authority checks.
- Cadence retains shell/chat, authenticated scope, persistence, credential custody, approvals and effects.

```sh
pnpm typecheck
pnpm build
pnpm verify
python3 scripts/package_app.py check --source app
```

Local fixture success is not installation, live API, domain/migration independence,
update/isolation/rollback or production evidence. Native host guards and sandbox contracts
are unchanged. Use [packaging.md](docs/packaging.md) for packaging and
[crm-ui-extraction.md](docs/crm-ui-extraction.md) for the shipped screen contract.

## Release delivery

The manifest's plain `X.Y.Z` version and matching `vX.Y.Z` tag identify an
immutable app release. Source, catalogue publication and live installation are
different states; a merged commit is not evidence of a deployed app.

The `publish` workflow requires an exact `CADENCE_TARGET_VERSION` repository
variable (or `cadence_version` input on the release tag) and installs that
pinned native checker only for the canonical bundle digest and inventory. A
hosted-only package — CRM 0.3.0 declares `app-storage: [1]` — is honestly
refused by the native validator; exit 3 with a digest/inventory report is
accepted as metadata only. Identity, title, summary and listing come from the
actual `app.md` through the pinned complete YAML parser, never from a second
metadata file. There is no native install-check or daemon step, no
`compatible: true` claim, no `latest` fallback, no long-lived catalogue PAT and
no Git/PR publisher fallback.

That content-refusal code also wraps blocked credentials; it is not a safety
receipt. Before diagnostics or OIDC, the publisher independently runs the real
`cadence secret scan` on every exact uploaded member with isolated temporary
state and no inherited operator allowlist. Missing tools, invalid receipts,
scanner errors and blocking findings fail closed, including `DRY_RUN=1`.
`APP_UPLOAD_JSON` must contain exactly the inspected files and bytes:
duplicate keys, ignored fields and substitutions refuse before upload.

The catalogue re-verifies the uploaded bytes, canonical digest and identity
before storing an immutable **draft** at `/public/apps/candidates`. Deploy the
prepared AgenticOS candidate API first; an old API or a configured legacy
publication URL fails closed. Nested files retain root-relative, forward-slash
upload keys on every platform, and publisher checkout credentials are not
persisted.

The Demo owner then qualifies the exact candidate using AgenticOS's
`tools/tenant-board/app-candidate.mjs` (`plan`, `release`, or observation-only
`resume`). Owner CLI credentials stay outside publisher CI. A published draft
is not recommended and not installable; the owner must install exactly that
release on a hosted host deployed under separate authority. Only an exact
observed Demo install unlocks publication; other hosted tenants update through
the consent-aware app fleet workflow. Nothing here rolls out the Cadence host,
performs customer/provider actions or Live Publishes today.

Package CI also runs `node --test tests/unit/publish-candidate.test.mjs` with a
checksum-pinned released Cadence v0.3.2 scanner for real credential rejection,
upload binding, endpoint, hosted-only metadata and release-identity checks.
Local publisher tests need the real CLI on `PATH`; no fake scanner is used.
The v0.3.2 scanner pin does not qualify storage: actual publication still needs
an exact released checker containing grammar v2 and the target hosted runtime.
