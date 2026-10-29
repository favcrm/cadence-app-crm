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
  **New customer** is the sole creation action in the toolbar; the CSV import
  screen is no longer exposed by the app. Host import services are unchanged.
- Segments: create, edit and duplicate rules; counts use the current local customers.
- Campaigns: choose **Blank** or **Paste HTML**, edit/save revisions and clone
  drafts without copying live sender/audience state. Saving never creates an
  approval; **Send N emails** approves the current revision when the send is
  confirmed, and the campaign UI has no separate content-approval step. The
  send freezes its audience as part of that one approval: there is no separate
  snapshot action anywhere in the campaign UI.
  Subject/preheader validation is shared with the real editor in both modes,
  including direct local saves; it is not host authorization.
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

## Reusable list controls

Use the committed `@cadence/screen-ui` package for `Button`, `Select`, `Field`,
`DataTable`, and theme tokens. The authoritative compact-list design guidance is
`ui/screen-ui/DESIGN.md` in the Cadence source repository (CAD-1774).
The currently pinned CRM archive predates that file. Consult the CAD-1774
source change until it merges and a package release includes it; do not assume
the guide is already present in `node_modules`.

Customers, Segments and Campaigns implement that composition through
`crm-list-controls` / `crm-list-toolbar` in `src/features/crm/crm-layout.css`.
The dev preview imports the same controls and app CSS as the installed screen,
not a separate visual system. Density overrides remain local to the list
composition; shared primitive CSS stays authoritative for other forms.

`src/features/crm/ListPager.tsx` supplies the shared Previous / page selector /
Next presentation, with 20 rows per page. Callers retain data ownership:

- Customers uses the host's cursor API. The selector offers visited pages,
  Next discovers another page, and search resets the cursor history.
  There is no invented total count or arbitrary unseen-page jump.
- Segments and Campaigns search and page the arrays returned by their existing
  list calls. Counts describe those loaded records, not an additional server
  total. Segment audience counts are fetched for the displayed page.
- Campaign search includes saved names, subjects and IDs; pending assistant
  drafts remain a separate, search-filtered review section.

These are reusable CRM compositions, not a second SDK. Publishing a common
list-density API for other apps belongs in the shared SDK source and release
process; do not edit `node_modules` or copy primitives into the preview.

## Detail drawers

Customer and Segment details always open inside the CRM frame (CRM-14), the
same way Social Content draws its drawers: a frame-wide scrim and a right-hand
`DrawerShell` from `@cadence/screen-ui` that spans the full frame height,
`min(30rem, 100vw)` wide, so a narrow frame gets a full-width sheet. The header
(kicker, title, close) and the footer stay put; only the body scrolls. While a
drawer is open the document behind it does not scroll and Tab stays inside it.
Escape keeps menu/edit/detail ordering; Escape, the scrim and the close control
return to the list and restore focus to the opener row. Opening a row sets the
record route, so direct routes and Back work. CRM sends no host drawer request.

## Compact CRM polish

The pinned `@cadence/screen-ui` archive exports no Badge/Chip component and no
base rule for the app's existing `.chip` markup. Keep one app-scoped
`.crm .chip` composition in `src/features/crm/crm-layout.css` using the core
compact-badge treatment; feature CSS still owns tone, consent and send-state
colours. Non-interactive outlet headings (`h1`-`h4` with
`data-outlet-heading`) opt out of the full-width native ring for their
programmatic focus; buttons, links and inputs keep their keyboard outlines.

`.crm-diag summary` places its disclosure marker inside the content box, so
the toggle arrow aligns with the padded content instead of the card border or
the page gutter. The Overview's Content approval, Test email and Final send
disclosures are direct children of the tab panel rather than cards;
`.crm-guard-diag` adds the cards' 1rem inline-start inset so those summaries
line up with the card content. Audience's Advanced disclosure, Activity's
Technical details and the Email advanced disclosure inherit the same rule.
Expanded content takes a half-rem gap below its summary, and the test-send
and final-send panels keep the standard card border: their distinction comes
from their content and confirmations, not tinted chrome.

Single-line CRM fields (`.crm .field:not(textarea)`) share the Select
trigger's 2rem height, 12px label scale and 0.75rem inline inset; list
toolbars keep their 1.75rem controls and textareas keep their multi-line
height.

The Email tab keeps one editing surface: the visual canvas. The saved host
render is no longer shown in the tab — the test send remains the real check.
The canvas hint was removed, leaving only the host-footer line, and the toolbar
keeps modes and block inserts on the left with Desktop/Mobile on the right. HTML mode is just the source field plus the existing plain-text
disclosure: the sanitization alert and the live HTML preview are gone, while
the host still strips unsupported markup at save. The
canvas and the `Email settings` rail sit side by side on wide screens (a
20rem rail), with subject, preheader, sender preview and sample first name in
the rail — the inbox/canvas shows only the From/To line and the body blocks.
The toolbar is modes, block inserts and Desktop/Mobile. An empty assistant-proposal slot
renders nothing, so the tab starts at the panel top like the other tabs. On wide screens the editor canvas fills the remaining window height
(`min-height: calc(100dvh - 9rem)` on the layout, the stage as the flexible
row), so the editor never ends as a short strip; the settings rail stays
top-aligned and the stacked layout keeps its content height. The save bar and saved
notice, the campaign list and header chips, the activity timeline and the clone
dialog no longer mention content approval; dead approval translations were
removed with them.

Campaign Overview's `Send checks` checklist shows the operator steps — drafted
email, live sender and accepted test — with one action per unmet step. The send
confirmation shows the audience preview and its frozen/valid state with one
link per unmet check (`Open audience`, `Send a test`) plus the content revision
it commits. There is no separate content-approval step: **Prepare send**
approves the current revision, then the daemon commits it with the freeze,
sender and test into one send digest the operator approves. The same
`sendReadiness` data gates prepare, so the confirmation cannot disagree with
the daemon.

The preview chrome keeps the core identity while removing repeated title and
assistant copy. An assistant-header icon collapses the panel to a 2.75rem
desktop rail; focus moves to the visible counterpart, both controls retain
`aria-expanded`/`aria-controls`, and the hover/keyboard hint dismisses with
Escape. Collapse styling is desktop-only, so the narrow Assistant/Workspace
selection and chat draft survive resizes; every toggle dispatches
`preview-layout` so host-positioned email previews realign. Browser-memory,
offline, draft-only and reset disclosures remain honest. The sender follow-up
still reads the existing scope projection and only calls the advertised
`smtp.manage` slot; its refusal never looks like success. A setup-error copy
localization follow-up is tracked as CRM-7.

New zh-TW copy from this polish lives in the existing `localeCatalog.ts` subset
and falls back to English when absent. The pre-existing `{count} draft` badge
key and one interpolated approval-title fragment remain English because they
were outside this polish's key set.

Verified in the local fixture preview: 38 route/tab/missing-record states plus
the four Blank/HTML creation-modal alternatives at 1440 and 390px; accepted
28px desktop / 36px narrow list controls with 12px list gaps; customer,
segment and campaign create/edit/save/audience/freeze/duplicate flows;
cursor and array pagination with 21 records each through the UI; search reset
and empty/clear/tag/consent filters; visible offline approval and freeze
refusals, with the fixture's synthetic live sender completing the sender check
while the test send still refuses on the unsupported host slot and the final
send stays disabled; campaign headers carry no redundant Details disclosure (the
id stays in Activity -> Technical details); assistant hint/Escape, 44px rail focus,
resize/mobile navigation and chat draft; six per-frame drawer open/close cases
across desktop/tablet/narrow with stable primary bounds, node/window identity,
a genuine 170px primary scroll and focus retention; dark/reduced-motion, long
names at three widths, and full warning-copy wrapping. The zh-TW override and
the advertised `smtp.manage` path were also exercised against fixture-only page
overrides; the adapter refusal at the unchanged boundary remains real.
`pnpm build` and `pnpm verify` passed (506791 bytes, SDK pin unchanged). No
native/core/bridge/host code changed; the dev fixture gained only a synthetic
sender binding and render echo, with no live send. No CI, merge, install or
deploy ran. This is local fixture and source evidence, not live integration or full
production QA.

## Isolated integration

A future, separately reviewed adapter connects to an owned temporary daemon through supported host authentication and installation/context-scoped APIs. Use temporary state and ports 3110–3199. Host custody retains identity, credentials, permissions, approvals and effects. Do not turn the fixture runner into an API proxy. This mode is not implemented here.

## Unchanged-host rehearsal

Build the artifact, install it, and update package-owned domain behavior without rebuilding the host. Prove integrity/compatibility refusal, data and history preservation, invalidation of stale approvals, isolation, interrupted migration/update recovery and rollback. Adding a field alone is insufficient to prove independently changed CRM behavior. This rehearsal remains pending.

Cadence coordinates shared contracts and tooling; both app repositories consume them. Separate repositories and successful HTTP connections do not establish functional independence.
