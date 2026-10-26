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
