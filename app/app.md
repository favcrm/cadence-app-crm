---
app: crm
title: CRM
version: '0.1.6'
summary: Draft one independently reviewed email brief from pasted facts; customer records, campaign content, SMTP custody and sending stay operator-run host actions.
needs:
  connections: []
  requires:
    contracts: {app-screens: [1], screen-records: [1], screen-startup: [1]}
---

# CRM — reviewed email briefs

This development bundle preserves the installed app identity `crm` and
carries app-owned Customers, Segments and Campaigns screens, including
CSV and email composition, under `screens/crm/`. Shared controls come from
the pinned host-owned screen UI SDK. Backend domain execution, scoped
data authority, credential custody, approval controls and sends stay
host-owned; the CAD-811 domain/migration extraction is not complete.

The package requires `app-screens`, `screen-records` and `screen-startup`
v1. Its declaration orders two static inline scripts: `runtime.js` contains
the existing production React/ReactDOM/JSX implementation; `client.js` uses
that same app-local instance. No parent runtime or network loader is used.
Older hosts must refuse the unknown startup capability, not run a client
without its runtime. These requirements do not prove host readiness or
runtime acceptance, and this development package is not a release or
native CRM cutover. The `email-brief` workflow still turns pasted facts
into one reviewed email brief text artifact.

An approved brief is text for a person to read. It is not campaign
content: applying content to a campaign, approving it, freezing an
audience, binding an SMTP connection, running a test send and approving
a send are separate operator verbs on the installation, each with its
own digest and approval. The workflow never requests customer, content,
SMTP or send mutations, and the manifest declares no capability that
could carry one; host authorization governs every actual action on the
installation regardless of what any bundle text asks for.

## Set up once

From a trusted Cadence source checkout, install this directory and read
the returned installation ID and bundle digest. Approve that exact
digest:

```sh
cadence app catalog install workspace-apps/crm
cadence app catalog approve INSTALL_ID --digest BUNDLE_DIGEST
```

Use two different registered workers in the same registered PM group: a
writer and a reviewer. Supply their aliases and the owner PM on every
run; nothing in this bundle selects workers or grants provider
authority.

Optionally create an app context holding `brand_voice` and
`protected_terms` string defaults in a JSON file such as
`{"brand_voice":"Calm, plain English","protected_terms":"HK$88/month"}`:

```sh
cadence app context create INSTALL_ID --label "Default voice" --defaults ./context-defaults.json --request-id UNIQUE_REQUEST_ID
```

Context defaults resolve per run like other workspace apps; the frozen
snapshot pins the effective values before approval. A context is
optional.

## New email brief

Create an `email-brief` run with `subject`, `audience`, `facts`,
`writer` and `reviewer` (`brand_voice` and `protected_terms` are
optional). Inputs come from a JSON file of strings, for example
`{"subject":"Spring launch follow-up","audience":"Customers due a renewal reminder","facts":"Plan renews 1 July. Price stays HK$88/month. Reply to change plan.","writer":"WRITER_ALIAS","reviewer":"REVIEWER_ALIAS"}`.
Inputs are single-line: paste facts as plain text with spaces between
original lines, retaining exact names, prices, dates, URLs and
disclaimer wording. A URL alone is not facts; do not fetch one.

```sh
cadence app run create INSTALL_ID --workflow email-brief --inputs ./inputs.json --owner-pm OWNER_PM --request-id UNIQUE_REQUEST_ID
cadence app run show RUN_ID
cadence app run approve RUN_ID --digest SNAPSHOT_DIGEST
cadence app run dispatch RUN_ID
```

The writer returns one run-owned text artifact through the
authenticated result envelope in its kickoff. The independent reviewer
fetches that exact artifact, verifies its SHA256 and returns `approve`
or `revise` pinned to the digest. A rejected brief stays failed; create
a new run.

## Customer chat (app-assistant and app-actions)

The bundle declares its assistant actions in `app-assistant.json` (the
read tools `customers.search`, `customers.show`, and the existing legacy
segment, campaign, draft and tag declarations, retained unchanged for
installed compatibility) and two customer actions in `app-actions.json`:
`crm.customer.create` (create, requires `display_name`; fields `email`,
`phone`, `tags`, `source`) and `crm.customer.update` (partial update of
`phone`/`tags`). The chat context declarations in `app-chat.json` are
unchanged from the installed 0.1.0 contract. Both action files are checked
by the host at install; the host owns storage, guards, approvals and every
write. The legacy assistant declarations are host-compatibility metadata
retained from the installed contract; this bundle adds no handler for them,
and any write-effect entry among them is subject to host authorization only.

Agent procedure:

1. Search or show customers first; read the current `revision` before any update.
2. If a search is ambiguous, ask the operator to select one customer. Never guess.
3. Propose exactly one reviewed change with the exact field values. Only the
   listed fields are writable; no consent, identity or revision fields exist.
4. Only the operator's native approval (allow once) writes. Show the
   authoritative before/after preview from the host. Create leaves consent
   unknown; update preserves existing consent.
5. After approval, verify the durable receipt before reporting success.

Upload is not import or consent. There is no standing allow, no custom
attributes, no bulk operation and no sending from this app.

## What a brief is, and is not

A successful review records reviewed draft text only. The bundle
declares no publication slot, no capability slot and no send
capability, and no step requests an outward mutation. Turning a brief
into campaign content, binding SMTP, the test send, the audience freeze
and the campaign send approval are operator actions on the installation
governed by host authorization, documented in the CRM guide. Never
present an approved brief as an approved campaign or a sent email.
