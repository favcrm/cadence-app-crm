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
- `app/` is the installable package, including generated screen assets and app declarations.
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
variable (or `cadence_version` input when dispatched on the release tag), runs
package and host install checks, and uses GitHub OIDC to deliver a **draft**
to `/public/apps/candidates`. There is no `latest` host fallback, long-lived
catalogue PAT or Git/PR publisher fallback.

Deploy the prepared AgenticOS candidate API before enabling this publisher.
An old API or a configured legacy publication URL fails closed, before stable
publication. The package's nested paths are preserved in its upload.

The Demo owner then qualifies the exact candidate using AgenticOS's
`tools/tenant-board/app-candidate.mjs` (`plan`, `release`, or observation-only
`resume`). Owner CLI credentials stay outside publisher CI. Only an exact
observed Demo install unlocks publication; other hosted tenants update through
the consent-aware app fleet workflow. Nothing here rolls out the Cadence host
or performs customer/provider actions.
