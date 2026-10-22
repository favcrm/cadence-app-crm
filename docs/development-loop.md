# Shared independent-app development loop

CRM and Social Content use the same development approach: edit the app repository -> hot-reloaded visual fixture preview -> selected isolated-daemon integration checks -> package install/update/rollback rehearsal on an unchanged compatible host.

## Fixture preview

Install the pinned dependencies with `pnpm install --frozen-lockfile`, then run
`pnpm dev` or `cadence app dev --package .`. The latter requires a Cadence CLI
with package-dev support; older CLIs can use `pnpm dev` without a host upgrade.
Open the printed `/dev/preview/` URL. The default loopback port is 3186;
`CADENCE_APP_PORT=3193 pnpm dev` or `cadence app dev --package . --port 3193`
selects another port in 3110–3199. Both paths reject non-loopback hosts.

The runner uses the existing Vite/React toolchain and committed screen-ui SDK.
It imports the real `src/main.tsx` in a development frame and speaks the existing
MessageChannel bridge; production screen, authorization and sandbox code are
unchanged. There is no copied Field/DataTable/chat renderer, daemon or API proxy.
Edits to screens, fixture data and styles hot reload; stop with Ctrl-C.

Customers (including search/details), Segments (including fixture membership counts)
and Campaigns (including draft/email browsing) use synthetic `.invalid` records.
Section/detail links and browser back/forward retain the selected view.
The email surface is an inert sandboxed frame with external resources disabled.
All writes, imports, chat, sender setup, approvals and sends remain unavailable.
No synthetic approval or delivery receipt is created; the UI stays read-only.
No host state, PM path, provider key or installation is needed. No live API request
is forwarded. Preview success proves local rendering and navigation only.

## Isolated integration

A future, separately reviewed adapter connects to an owned temporary daemon through supported host authentication and installation/context-scoped APIs. Use temporary state and ports 3110–3199. Host custody retains identity, credentials, permissions, approvals and effects. Do not turn the fixture runner into an API proxy. This mode is not implemented here.

## Unchanged-host rehearsal

Build the artifact, install it, and update package-owned domain behavior without rebuilding the host. Prove integrity/compatibility refusal, data and history preservation, invalidation of stale approvals, isolation, interrupted migration/update recovery and rollback. Adding a field alone is insufficient to prove independently changed CRM behavior. This rehearsal remains pending.

Cadence coordinates shared contracts and tooling; both app repositories consume them. Separate repositories and successful HTTP connections do not establish functional independence.
