# Cadence CRM App

Public repository: https://github.com/favcrm/cadence-app-crm.
App identity stays `crm`; repository names do not change installation or data identities.

## Customer workspace in 0.5.0

Open a customer to replace the list with the profile at any frame width.
**All customers** returns to the list without losing its filters, page or
selection. Activity entries open a detail drawer from the profile.

## Owner-only sections in 0.7.1

Customers are member-readable; Segments and Campaigns (and the `segments`, `segment`,
`campaigns`, `campaign` canvas views) are owner-only. When a member's first `.list`/`.show`
read of such a section is refused `owner_required`, the single `serviceCall` path records it
(`src/bridge/ownerGate.ts`) and that section shows "Only workspace owners can view segments." /
"...campaigns." with the hint "Ask a workspace owner if you need this." (English, zh-TW and
zh-HK; text only), with no partial data and no further reads. Customers keep loading in the
same mount; every other refusal is handled as before. The dev preview answers those reads
this way with `?owner=required`.

## Deal-linked touchpoints in 0.8.0

In a customer profile's **Activity & Notes**, a touchpoint can optionally name
one of that customer's deals. The activity list shows the saved association.
Storage migration 010 adds nullable `touchpoints.deal_id`; customer-only
touchpoints remain valid. Merging customers moves the deal and touchpoint to
the target without changing their link.

## Chat canvas

The bridge declares `screen-surfaces.v1` and `screen-canvas.v1` (app-kit 0.7.0). When the
host mounts CRM read-only in the board chat canvas (`surface.readOnly`), the screen treats
the viewer as read-only and drops the member-only "Read-only view" wording, because the host
already says "Open in CRM to edit". Create, edit, bulk, approve and send controls are hidden;
reads, navigation and Copy email stay. Customer profiles use the same main
pane in the canvas and the full app.

## Read-only wording in zh-TW and zh-HK (0.4.5)

Every "Read-only view." string has zh-TW and zh-HK text in `localeCatalog.ts` (`zhTW`, `zhHK`).
The two drawer notes that were built by string interpolation (and so never translated) are now
whole keys. `tests/unit/readonly_locale.test.mjs` fails if a read-only string or any `t("...")`
literal lacks either entry. The board host only sends `en` or `zh-TW` today; zh-HK is ready in
the catalog for when it sends it.

## Canvas views with filters in 0.4.4

CRM declares five views in `screens.json` next to `navigation` (app-kit 0.8.0,
`screen-route-params.v1`, opted in with `routeParams: true`), each with an English and a
zh-TW label. Only filters the lists already apply are declared (`scripts/crm_views.mjs`
is the one source for the build and the verifier):

| view | params | applied as |
| --- | --- | --- |
| `customers` | `q` | the server search (name, email or tag), so it reaches the whole list |
| `segments` | `q` | the list's name/id search |
| `campaigns` | `q` | the list's name/subject/id search |
| `segment`, `campaign` | `id` | opens that segment or campaign (a valid id; otherwise the list) |

The assistant opens one with
`canvas_open {app:"crm", view:"customers", params:{q:"vip"}}`.
The screens read `route.params` when they open: a value the list cannot use (an unknown
`consent`, text over 200 characters, a bad id) is ignored and the default stays, and without
params the list is as it was. When the user changes a filter it is written back with
`screen.route.patch {params}` so the link and canvas title follow; choosing another section
clears the params. The host's `records.list` takes only `query`, `limit` and `cursor`, so the list's consent,
source and tag filters narrow the loaded page only and are not params (a known gap until a
server-side field filter exists; `q` already matches tags). There is no sort, status or segment
filter on Customers and none on Campaigns, so none is declared. No storage migration, write or new required host capability
beyond `screen-route-params.v1`. CI checks the bundle with Cadence `v0.5.1`, the first release
whose checker admits screen `views`; the publish workflow's `CADENCE_TARGET_VERSION` must be
`v0.5.1` or later before a release carrying them is tagged. The preview opens a route with
`?section=customers&p.q=vip`.

## Canvas padding in 0.4.3

Below 1100px wide (the board chat canvas) the screen keeps a modest inner padding (16px inline,
12px block; 12px inline under 36rem) instead of sitting flush against the canvas edges, the same
rule as Accounting ACC-22. Tag chips keep words whole: they wrap between chips, and a tag too
long for the row ends in an ellipsis. These rules apply without changes to
storage or capabilities.

## Local development

Use the Node version in `screen-ui.lock.json` and pnpm version in `package.json`.
The shared screen SDK archive is committed; the released app-kit receiver is
vendored at `app-kit/` and pinned by `app-kit.lock.json`; no Cadence checkout or
SDK rebuild is needed.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Bun 1.4.3 runs the screen unit and contract tests (`pnpm test`); the publisher
test still runs under Node.

Open the printed `/dev/preview/` URL (it defaults to `localhost`; app-kit rejects
HTTP IP-literal parents). For Cadence versions supporting package development:

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
- `app-kit/` is the released receiver vendored from `favcrm/cadence`;
  `app-kit.lock.json` pins the source commit and every file.
- `app/` is the installable package, including generated screen assets, app declarations and
  the app-owned `app-storage.json` + `storage/*.json` schema plan.
- `dev/preview/` is local-only tooling; it is not a production host or part of the screen build.
- `scripts/build_screen.mjs` and `scripts/verify_screen.mjs` retain the existing SDK/provenance and authority checks.
- Cadence retains shell/chat, authenticated scope, persistence, credential custody, approvals and effects.

```sh
pnpm typecheck
pnpm build
pnpm verify
pnpm test
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

Package CI and the read-only release qualification job verify the checked-in
screen and compare it byte-for-byte against a pinned build in a temporary
directory. The OIDC publisher requires the exact qualified, unchanged `app/`
tree before inspection; it does not build or replace anything. After a screen
source or toolchain change, run `pnpm build` and commit `app/screens/crm/`.

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

The catalogue re-verifies the uploaded bytes, canonical digest and identity,
then lists that exact version immediately: a successful publish records it as
`published` in the directory, with no separate review or promotion step. The
publisher requires that confirmation — `publication: published`, a `published`
or `unchanged` status, and the exact id, version, digest, repository and commit
it sent — and prints an idempotent replay as already listed. A
staged rollout is handled honestly: an older deployed API still stores the
bundle as an unlisted `draft`, so the publisher exits nonzero and says to
deploy the candidate API first rather than reporting a green workflow for a
draft. Deploy that API before tagging; an old API or a configured legacy
publication URL fails closed. Nested files retain root-relative, forward-slash
upload keys on every platform, and publisher checkout credentials are not
persisted.

Listing is not installation. Each hosted tenant installs or updates to exactly
that release through its own owner's consent-aware path with the exact digest;
a published catalogue version by itself grants no host, tenant, customer or
provider action. Nothing here rolls out the Cadence host, installs on a tenant,
performs customer/provider actions or Live Publishes today.

Package CI also runs `node --test tests/unit/publish-candidate.test.mjs` with a
checksum-pinned released Cadence v0.3.2 scanner for real credential rejection,
upload binding, endpoint, hosted-only metadata, release-identity and
publication-response checks (listed `published` versus an older API's unlisted
`draft`, with the exact echoed id/version/digest). Local publisher tests need
the real CLI on `PATH`; no fake scanner is used.
The v0.3.2 scanner pin does not qualify storage: actual publication still needs
an exact released checker containing grammar v2 and the target hosted runtime.
