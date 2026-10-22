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

The development chrome reserves the same major areas as the real workspace:
sidebar and header, assistant on the left, CRM workspace on the right. It uses
the committed SDK's theme tokens without importing the authenticated host shell.
At narrow widths, navigation opens as a drawer and Assistant/Workspace switches
between the same mounted panes, preserving the local chat draft.

The real app action buttons operate on browser-memory fixtures:
- Customers: create, edit and record local consent; search and detail views.
- Segments: create, edit and duplicate rules; counts use the current local customers.
- Campaigns: choose **Blank** or **Paste HTML**, edit/save revisions and clone
  drafts without copying live sender/audience state. Saving never creates an approval.
- **Reset local data** asks before discarding all local changes and the chat draft.
  Reload also resets the data; nothing is stored in localStorage or on a server.

Imports, sender setup, AI chat, assistant proposals, approvals and sends are not
implemented by the local adapter and remain refused. The chat panel is an honest
offline state, not fake conversation history. Choosing Assistant draft in the real
campaign form can create a local draft but cannot send its brief to an assistant;
use Blank/Paste HTML for a complete offline creation flow.

Section/detail/new-view links and browser back/forward retain the selected view.
Local update requests reject stale revisions. The local email renderer is a
bounded approximation, not the production email pipeline: it uses an empty
sandbox and restrictive resource CSP, strips active HTML and links, and creates
no delivery receipt. All synthetic digests/observations are fixture data only.
No host state, PM path, provider key or installation is needed. No live API request
is forwarded. This proves local layout and action flows, not backend authority.

## Isolated integration

A future, separately reviewed adapter connects to an owned temporary daemon through supported host authentication and installation/context-scoped APIs. Use temporary state and ports 3110–3199. Host custody retains identity, credentials, permissions, approvals and effects. Do not turn the fixture runner into an API proxy. This mode is not implemented here.

## Unchanged-host rehearsal

Build the artifact, install it, and update package-owned domain behavior without rebuilding the host. Prove integrity/compatibility refusal, data and history preservation, invalidation of stale approvals, isolation, interrupted migration/update recovery and rollback. Adding a field alone is insufficient to prove independently changed CRM behavior. This rehearsal remains pending.

Cadence coordinates shared contracts and tooling; both app repositories consume them. Separate repositories and successful HTTP connections do not establish functional independence.
