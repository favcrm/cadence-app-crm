---
app: crm
title: CRM
version: '0.7.1'
summary: Customer records, notes, activity, segments and scoped campaign workflows; sending stays an operator-run host action.
needs:
  connections: []
  requires:
    contracts: {app-screens: [1], screen-records: [1], screen-startup: [1], app-storage: [1]}
listing:
  tagline: Run customer records and campaigns with an agent you can audit
  category: customers
  tags: [email, crm]
  publisher:
    name: Cadence
  about: CRM keeps your customer list, notes and segments, drafts reviewed campaign content and prepares an audience through host-owned controls. At the operator’s chosen autonomy, a scoped agent can create and update customers, add notes, build rule or selected-member segments, apply its email proposal, approve content and freeze the audience. The final test and send stay guarded host actions.
  can:
    - Keep customer records with tags, consent, notes and a static or rule-based segment
    - Draft one reviewed email brief per run
    - Apply an assistant draft, approve content and freeze the exact audience
    - Run record writes autonomously at the operator’s chosen autonomy level
    - Keep unsubscriptions and send history for good
  screenshots: []
  setup: []
  data:
    stores:
      - Your customer list, segments and unsubscribes
      - Campaign content, audiences and send history
      - Reviewed email-brief text
    personal: true
---

# CRM — customer workspace and campaigns

This development bundle preserves the installed app identity `crm` and
carries app-owned Customers, Segments and Campaigns screens, including
CSV and email composition, under `screens/crm/`. Shared controls come from
the pinned host-owned screen UI SDK. Backend domain execution, scoped
data authority, credential custody, approval controls and sends stay
host-owned; the CAD-811 domain/migration extraction is not complete.

The package requires `app-screens`, `screen-records`, `screen-startup` and `app-storage` v1. Its declaration orders two
static inline scripts: `runtime.js` contains
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
3. For the declared `app-actions` proposal, include only its listed fields;
   its input does not contain consent, identity or revision fields. The host
   applies the proposal through its action policy; the proposal does not grant
   consent. Hosted `records.update` uses a different contract and requires the
   current revision.
4. After the operation, verify the durable receipt before reporting success.
5. A static segment is an explicit member list (`segments.save_static`); a
   rule segment keeps the existing predicate grammar. `segments.delete` keeps
   the revision log.
6. `campaigns.apply` applies a pending assistant proposal to the draft;
   `campaigns.approve` pins the exact content revision and `audiences.prepare`
   freezes the audience. These are host-authorized internal actions; the
   host decides whether the current autonomy policy runs them directly.
7. Where the host advertises `customers.notes.create`, `customers.notes.list`
   and `customers.notes.delete`, they append, read and soft-delete plain-text
   notes. A declaration alone does not make those actions available. A note
   never changes the profile digest, a segment or a frozen audience.
8. `sends.list` and `sends.show` are read-only. This bundle declares no send
   or SMTP action; the final send remains the host operator's guarded action.

Upload is not import or consent. There is no consent inference and no sending
from this app.

### Hosted agent tools

When the host offers `app_describe` and `app_call`, discover the installed
CRM's current operations and storage fields before using them. Use
`records.list` and `records.show` to find the exact customer and its current
revision. `records.create` and `records.update` put fields inside `profile`;
an update includes the revision returned by `records.show`. A hosted write is
staged for the owner's review, not proof that a record changed. Read the
resulting status and record after approval; a stale revision must be read
again rather than overwritten. The host's current grants and approval policy,
not this guidance or a selected customer, determine access.

`records.show` history describes recorded profile changes, not every customer
interaction. When a supporting host returns `history_next_cursor`, pass it as
`history_cursor` to `records.show` to request older visible changes. Older hosts
may report `history_truncated` without a cursor; then only recent changes are
available. Protected history can also omit changes from before access was
enabled. Do not claim the returned activity is complete or infer that no other
interaction occurred.

Consent notes require a recorded method; a withdrawal without a note does not.
Consent entries and profile-change entries are separate evidence, even when
their revision numbers match.

On hosts with customer-level access, `records.show` may include
`record_access.can_write`. A false value means this caller cannot edit that
customer, even if the app declares `records.update`. Permissions can change;
the host rechecks them on every write. Older unprotected hosts omit the field.

For a protected table, `records.list` reports `record_access.create_id: "host"`;
the screen then omits `record_id` on create. This capability does not grant
access. On any host, if a create result is uncertain, check the customer list
before trying again; a new request can create a duplicate.

Workspace-visible customers remain readable to callers with the app's existing
read capability; visibility alone is not permission to write. A private customer
requires the agent's own live record grant. To update an existing customer, a
paired agent needs its own write grant, rechecked when an owner approves the
action; approval does not confer access.

Paired-agent CLI chat uses that agent's own live credential and grants; a
different agent's grant does not transfer. Ordinary browser chat does not yet
have a separate customer-access identity and cannot use protected customer data
through this path.

For a protected agent create, omit `record_id` and supply the intended human
workspace member as `record_owner_id` to `app_call`. The owner reviews the
request; the host verifies the assignee's current membership. The new customer
is private to that person, and creating it does not grant the agent access.

Contacts are entries in the customer's `contacts` array and share that
customer's access; they are not separate customers and do not carry independent
marketing consent. To add, correct or remove one, read the customer first,
preserve the other entries, and submit the complete revised array through
`records.update` with the current revision. Each entry has `name` and nullable
`title`, `email` and `phone`; at most 50 entries are supported. Validate email
and phone syntax before proposing them: the host's nested JSON schema enforces
types and lengths, not email or phone formats. Never infer consent from a
contact's details.

`custom_fields` is a customer-local object keyed by stable lowercase
letters, digits or underscores (1–40 characters; reserved object and host
bridge keys are excluded). Each value is `{label, type, value}` with `type` equal to `text`,
`number`, `boolean` or `date`; dates use `YYYY-MM-DD`. To change one, preserve
the other entries and submit the whole object with the current customer
revision. These fields share the customer's access. Coordinate keys and types
across the team: there is no workspace-wide definition registry or
cross-customer uniqueness policy. The host validates keys, value types, bounds
and calendar dates. Hosts predating this schema validation must be upgraded
before installing this version of the CRM.

In particular, do not assume `customers.notes.*` is callable through hosted
`app_call` merely because `app-assistant.json` declares it. Use only operations
the host advertises; a record update is not a substitute for logging a note.

The same discovery and read can be called from an authorized hosted CLI
without putting customer data in a shell command:

```sh
cadence --org "$ORG" platform call app_describe --input '{"app":"crm"}'
cadence --org "$ORG" platform call app_call --input '{"app":"crm","operation":"records.list","args":"{\"limit\":1}"}'
```

Do not infer marketing consent from a customer profile or note. Do not claim
contacts, custom fields, cross-app links or per-customer sharing exist unless
the installed host's discovered contract actually provides them.

## Campaign work metadata (CRM-12)

A saved campaign carries app-owned work metadata beside its content: the
assignee (the operator or agent name), who assigned it and when, a due
date, a lifecycle status and a blocked reason. The record is versioned by
its own revision, quoted as `expected_revision` on every write; the first
write sends 0 and any other mismatch is refused as stale instead of
overwriting a newer decision. Attribution is recorded by the source from
the authenticated caller, never from bundle or request text. A campaign
with no recorded row is *unassigned*: its content author is never treated
as the owner, and an absent due date or status stays unset.

The app computes `next_decision` from its existing send-readiness chain
(content drafted, audience frozen and valid, live sender, accepted test)
plus the recorded lifecycle — blocked and closed states win first. It is
never stored, so the checklist and the decision cannot drift apart.

Since 0.3.4 the package neither requires the `crm-campaign-work` v1 host
contract nor declares `campaign-work.show` / `campaign-work.save`: the
campaign Work card is gone, so the screen does not use campaign work.
`docs/campaign-work-contract.md` keeps the contract shapes for a future
return of the operations.


## App-owned storage schema

This package owns its logical storage schema. `app-storage.json` declares
`app-storage/v1` at `schema_version` 6 with six ordered migrations under
`storage/`; each migration's `sha256` is the exact raw-byte digest of that
file. A host refuses this package if a migration is missing or its bytes
differ from the declared hash, and `needs.requires.contracts` must list
`app-storage: [1]` for the descriptor to install at all. The descriptor
also declares `record_kind: "customer"`, the records bridge kind (native
`kind: customer`), so no host heuristic infers it from the app or table
name.

Schema v1 creates the app tables `customers`, `segments`, `campaigns` and
`proposals` with the fields the current CRM uses, including the
`proposals.campaign_id` relation, its index and a `synthetic` flag that
keeps seeded legacy rows distinguishable. Schema v2 adds persisted,
nullable `phone` and `source` columns to `customers` plus a
`customers_phone` index. The customer form collects phone but leaves
`source` to authorized platform and agent operations; profile and consent
edits omit it so a partial update preserves any stored value. Schema v3 adds
an optional `customer_type` (`person` or `organization`) and an optional
website. Both kinds remain customers; a person representing an organization is
a separate contact, not a second name for that organization. Schema v4 adds a
bounded `contacts` array to the customer record; schema v5 adds typed
`custom_fields`. Schema v6 adds the `notes` table (`customer_id`, `body`,
`archived_at`) indexed by `notes_customer_id` and `notes_archived_at` with
`search_columns: ["body"]` and `immutable_columns: ["customer_id"]` declared
under `tables.notes`. The bundle also declares `records.aggregate` and
`records.batch` alongside `table`, `filters`, `sort`, `fields` and
`omit_fields` selectors on record calls, and ships an agent skill package
under `skills/crm/`. Contacts, custom fields and notes inherit the workspace
record policy. Cross-app links are not implemented by these fields.
`campaigns` and `proposals` declare the host
absolute `record_bytes` budget (262144) so existing large content is not
refused; other tables keep the generic 16 KiB record default. The
host-owned `id`, `context_id`, `revision`,
`created_at` and `updated_at` columns stay host-allocated and are never
declared here.

Credentials and effect authority stay out of app-owned tables. SMTP
credentials, approval gates, audience-freeze and send authority and actual
sends remain host-owned; this bundle declares no send or SMTP operation.

Blank email and phone fields are sent as explicit `null`, so an update clears
those values instead of preserving older ones.
Columns carry `format`/`json_schema` declarations and the root
`record_write_schema` declares that an update which moves either consent
channel from not granted to granted must report provenance; the host
validates these server-side, so browser shaping is not authority. The
customer timeline uses an explicit `consent_history` when present and
otherwise projects the generic before/after journal (with reported
provenance), because the host reports no derived consent semantics.
The activity drawer shows changed customer fields only when the current
profile and both journal snapshots contain them. Missing or withheld values
are not inferred; the host remains responsible for authorizing history.
`record_search_columns` names the text/json columns the host generic
search may use — `display_name`, `email`, `tags`, `phone` and `source` —
so tag-only queries do not silently become name-only queries; the host
resolves them through the declared schema, never by CRM table-name logic.

Native Cadence has no app-storage execution runtime: a native host refuses
the syntactically valid `app-storage: [1]` contract instead of installing
this package, and a host older than the contract refuses the requirement
and the `app-storage.json`/`storage/` members. Only a hosted v2 runtime
with the real app-storage adapter can install and execute this schema. The
packaging checks in this repository validate member shape and exact
migration hashes; they do not prove schema execution, installation,
migration or update. See `docs/packaging.md` for the schema-v1 staging
recipe used to exercise a package-only v1 → v2 upgrade.

## What a brief is, and is not

A successful review records reviewed draft text only. The bundle
declares no publication slot, no capability slot and no send
capability, and no step requests an outward mutation. Turning a brief
into campaign content, binding SMTP, the test send, the audience freeze
and the campaign send approval are operator actions on the installation
governed by host authorization, documented in the CRM guide. Never
present an approved brief as an approved campaign or a sent email.
