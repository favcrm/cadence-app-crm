# CRM UI ownership and host boundary

Development in progress under CRM-1, paired with Cadence CAD-811. The metadata and fixtures on main are not an implemented CRM screen.

The intended app-owned surface is Customers, Segments and Campaigns, including the existing CSV and email-composer flows. The app consumes the actual host-owned `@cadence/screen-ui` controls and resource hooks; it does not vendor their implementation or import the board's API, session, router, settings or chat modules.

The paired host change proposes `screen-records.v1` over the existing opaque app-screen runtime. It supplies a closed operation set, server-derived installation/context scope and current session/mount/digest/permission checks. The frame receives no board credentials, action token, SMTP secret or confirmation token. Approvals, credential configuration and sends require authoritative host-drawn controls. Existing backend revisions, consent validation and effect safeguards remain authoritative.

Routing stays app-owned behind a closed host query adapter. Customer data and search state are not persisted in browser storage/history. Eligible ordinary read observations can be retained in bounded host session/scope memory while fresh authorized reads run; cached data never authorizes a write or approval.

Email previews need an inert host-owned surface because the app sandbox forbids nested frames. The app owns composition and preview content; the host owns isolation and placement without weakening the app CSP.

## Ordered static production partition

The existing pinned React 19.2.8 framework is built once into `runtime.js`.
`client.js` keeps the existing CRM UI and tree-shaken compiled SDK, with exactly
four static externals: `react`, `react-dom`, `react-dom/client` and
`react/jsx-runtime`. They map to `CadenceCrmRuntime` exports in the same opaque
app frame. The production module graph has one React root shared by ReactDOM
and ReactDOMClient, no framework/scheduler implementation in the client, and
no dynamic imports. The emitted client IIFE receives those four local exports;
there is no parent runtime, remote script or asset loader.

The declaration orders `startup: ["runtime.js", "client.js"]`, with the entry
last, and the manifest demands `screen-startup: [1]` alongside the existing
screen contracts. The paired host must validate every declared asset before
emitting both scripts inline with its existing nonce and unchanged CSP. Without
startup, legacy non-entry JavaScript remains inert. Unsupported capability,
invalid order, missing/duplicate assets, unsafe inline text or failed integrity
must refuse rather than partially activate. Digest changes require fresh
approval and mounting; this is not an in-place runtime update mechanism.

Candidate development build raw UTF-8 sizes: runtime 191,081 bytes, client 229,959 bytes,
CSS 33,698 bytes; assets total 454,738 bytes and manifest 2,662 bytes. Existing
393,216-byte JavaScript, 131,072-byte other-asset, 524,288-byte total and
16,384-byte manifest caps are unchanged. Offline verification checks all script
bodies for `</script`, `<!--` and `-->` before packaging; none occur in these
outputs. Before the form-adapter candidate, two unchanged-input builds produced
byte-identical assets, manifest and archive. These are build/integrity results only: actual host-rendered frame
size against its unchanged 786,432-byte cap and runtime/lifecycle acceptance
remain independent pending checks.

A frame-local form adapter is installed once at bootstrap. Document-bubble click
and unmodified, non-composing, non-repeated Enter in single-line text/number inputs
dispatch a validated submit event to existing React handlers, including associated
drawer footer buttons. A disabled first submitter is never skipped. Shared controls,
sandbox restrictions and native fenced mutations remain unchanged; no native form
navigation is invoked. This is a candidate for independent installed create/edit,
validation and click/Enter acceptance, not a proven root-cause fix. Forms without a
submit button and input-type submit/image controls are outside this bounded adapter.

The shared UI export now pins genuine committed candidate source in paired host draft PR #992, with its toolchain and archive bytes verified reproducibly. That source is not yet reviewed or approved for release; a release must verify its actual reviewed source rather than treat candidate provenance as approval. Native CRM stays available until the actual replacement and unchanged-host package update/rollback checks pass. Full CAD-811 backend domain/migration independence remains a separate unmet outcome; this UI extraction does not assert it is complete.
