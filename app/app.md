---
app: crm
title: CRM
version: '0.2.0'
summary: Static and rule-based customer segments, scoped campaign content approval and audience freezing; sending stays operator-run host action.
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
read tools `customers.search`, `customers.show`, segment list/show/preview/
save, `segments.save_static`, `segments.delete`, campaign list/show/
create_draft, `campaigns.apply`, `campaigns.discard`, `campaigns.approve`,
`audiences.prepare`, `audiences.show`, `sends.list`, `sends.show`,
`email.draft`, `customer.tags.update`, `customers.notes.list`,
`customers.notes.create` and `customers.notes.delete`) and two customer
actions in `app-actions.json`: `crm.customer.create` (create, requires
`display_name`; fields `email`, `phone`, `tags`, `source`) and
`crm.customer.update` (partial update of
`display_name`/`email`/`phone`/`tags`/`source`). The chat context
declarations in `app-chat.json` are unchanged from the installed 0.1.0
contract. Both action files are checked by the host at install; the host owns
storage, guards, approvals and every write. The host registry is authoritative:
the bundle only declares IDs and schemas, and an undeclared action is refused.

Agent procedure:

1. Search or show customers first; read the current `revision` before any update.
2. If a search is ambiguous, ask the operator to select one customer. Never guess.
3. Propose exactly one reviewed change with the exact field values. Only the
   listed fields are writable; no consent, identity or revision fields exist.
   The host applies the change through its action policy; consent stays unknown
   on create and is preserved on update.
4. After the operation, verify the durable receipt before reporting success.
5. A static segment is an explicit member list (`segments.save_static`); a
   rule segment keeps the existing predicate grammar. `segments.delete` keeps
   the revision log.
6. `campaigns.apply` applies a pending assistant proposal to the draft;
   `campaigns.approve` pins the exact content revision and `audiences.prepare`
   freezes the audience. These are host-authorized internal actions; the
   host decides whether the current autonomy policy runs them directly.
7. A note is plain text on the customer timeline: `customers.notes.create`
   appends, `customers.notes.list` reads and `customers.notes.delete` soft-deletes.
   A note never changes the profile digest, a segment or a frozen audience.
8. `sends.list` and `sends.show` are read-only. This bundle declares no send
   or SMTP action; the final send remains the host operator's guarded action.

Upload is not import or consent. There is no consent inference, no custom
attributes and no sending from this app.

## What a brief is, and is not

A successful review records reviewed draft text only. The bundle
declares no publication slot, no capability slot and no send
capability, and no step requests an outward mutation. Turning a brief
into campaign content, binding SMTP, the test send, the audience freeze
and the campaign send approval are operator actions on the installation
governed by host authorization, documented in the CRM guide. Never
present an approved brief as an approved campaign or a sent email.
