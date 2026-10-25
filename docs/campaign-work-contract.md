# Campaign work metadata and the scoped read contract (CRM-12)

The CRM source records who a campaign is assigned to, who assigned it and
when, its due date, its lifecycle status, a blocked reason and the revision
it was written against. It does not copy content, proposals, approvals,
test-send facts or send history, and it holds no approval, send or publish
authority. This note is the app-side contract; the paired host must serve
the same shapes before a caller can read them (see **Host pairing**).

## Source discovery

Discovery is declarative, never an app-name branch. `app/app.md` requires
the `crm-campaign-work` v1 contract:

```yaml
needs:
  requires:
    contracts: {app-screens: [1], screen-records: [1], screen-startup: [1], crm-campaign-work: [1]}
```

A host that supports the contract lists every installed package whose
manifest requires it, and reads each one under the installation/context
scope the host already proved. `app/screens/crm/screens.json` declares the
two operations a source serves:

| Operation | Kind | Purpose |
|---|---|---|
| `campaign-work.show` | read | Recorded facts for one campaign |
| `campaign-work.save` | write | Record assignment, due date, status, blocked reason |

A host that does not know the contract or the operations must refuse the
package (unknown requirement/operation) rather than mount a screen whose
work actions would be inert.

## Identity

A campaign is identified by the source-qualified quadruple, never by the
campaign id alone:

```
identity = crm:<install_id>:<context_id or ->:<campaign_id>
```

`install_id` and `context_id` come from the host-derived scope; the app
never accepts them in a body, form field or chat message. Two
installations may hold the same campaign id and their identities never
collide. The canonical link is `crm:campaigns/<campaign_id>`; it is an
address only and is meaningful only beside the source identity.

## Read: `campaign-work.show`

Request (closed body):

```json
{ "campaign_id": "welcome" }
```

Reply — recorded facts only; `next_decision` is never serialized:

```json
{
  "contract": "crm-campaign-work/v1",
  "source": { "app": "crm", "install_id": "inst-1", "context_id": "ctx-1" },
  "campaign_id": "welcome",
  "work": {
    "revision": 3,
    "content_revision": 7,
    "assignee": "Ada Chen",
    "assigned_by": "operator",
    "assigned_at": "2026-10-25T09:00:00.000Z",
    "due_at": "2026-11-01",
    "status": "blocked",
    "blocked_reason": "waiting on legal",
    "updated_at": "2026-10-26T10:30:00.000Z"
  },
  "content": { "revision": 7, "digest": "sha256:…" }
}
```

`work` is `null` when the campaign has no recorded work row; `content` is
`null` when no content revision is saved yet. Values are bounded:

| Field | Shape |
|---|---|
| `revision` | integer ≥ 1; the write CAS token |
| `content_revision` | integer ≥ 1 or `null`; the content revision the write saw |
| `assignee`, `assigned_by` | plain single-line text, 1–80 chars, no `<>\`{}` or control characters; `null` = not recorded |
| `assigned_at`, `updated_at` | ISO-8601 UTC instant |
| `due_at` | `YYYY-MM-DD` naming a real calendar day, or `null` |
| `status` | `planned`, `in_progress`, `blocked`, `done`, `cancelled`, or `null` |
| `blocked_reason` | plain text 1–200 chars; only with `blocked` |

An unknown field anywhere refuses the reply. Attribution, revisions, the
content revision and `next_decision` are refused at the write boundary, so
a caller can never forge them.

## Write: `campaign-work.save`

Request (closed body; at least one value field required):

```json
{
  "campaign_id": "welcome",
  "expected_revision": 3,
  "assignee": "Ada Chen",
  "due_at": "2026-11-01",
  "status": "blocked",
  "blocked_reason": "waiting on legal"
}
```

- `expected_revision` is mandatory. The first write for a campaign sends
  `0`; any other mismatch is a stale write and is refused — no silent
  retry, no overwrite, no merge.
- `assignee: null` unassigns. `due_at: null`, `status: null` and
  `blocked_reason: null` clear the value.
- Changing `assignee` (including clearing it) records `assigned_by` and
  `assigned_at` from the authenticated caller. Leaving `blocked` clears
  the blocked reason. Every accepted write increments `revision`, stamps
  `updated_at` and re-binds `content_revision` to the live content.
- `blocked_reason` without `status: "blocked"` refuses. Editing only the
  reason of an already-blocked row therefore sends `status: "blocked"` with
  it; the panel's patch builder does that, so a reason-only edit is a valid
  CAS write rather than a refused one.

Reply: the same facts shape as `campaign-work.show`, after the write.

## Read contract response

`campaignWorkRead(...)` (this repository, `src/domain/campaignWork.ts`)
projects facts into the caller-facing response. It is the reference
implementation the paired host adapts; the same tests are the conformance
vectors.

```json
{
  "contract": "crm-campaign-work/v1",
  "state": "ok",
  "source": { "app": "crm", "install_id": "inst-1", "context_id": "ctx-1" },
  "identity": "crm:inst-1:ctx-1:welcome",
  "campaign": { "id": "welcome", "link": "crm:campaigns/welcome" },
  "revision": 3,
  "content_revision": 7,
  "content": { "revision": 7, "digest": "sha256:…" },
  "assignment": { "assignee": "Ada Chen", "assigned_by": "operator", "assigned_at": "2026-10-25T09:00:00.000Z" },
  "due_at": "2026-11-01",
  "lifecycle": { "status": "blocked", "blocked_reason": "waiting on legal", "updated_at": "2026-10-26T10:30:00.000Z" },
  "next_decision": { "key": "unblock", "label": "Unblock: waiting on legal", "reason": "waiting on legal" },
  "unavailable": [],
  "refusal": null
}
```

`state` is exactly one of:

| State | Meaning |
|---|---|
| `ok` | Recorded work exists and the readiness chain answered. |
| `unavailable` | No work row is recorded. Every unrecorded value is `null` **and** named in `unavailable`; content facts and `next_decision` still come from the campaign. |
| `partial` | A work row exists but `next_decision` could not be computed (readiness unreadable). `next_decision` is `null`; `unavailable` lists `next_decision`. |
| `forbidden` | The caller is not authorized for this source. No values, `refusal.code = "forbidden"`. |
| `stale` | The caller's `expected_revision` is not current. Only `revision`/`content_revision` are returned; no values, `refusal.code = "stale_revision"`. |

`forbidden` and `stale` carry no recorded values and no content facts:
`assignment`, `due_at`, `lifecycle`, `next_decision` and `content` are all
`null`. `stale` returns only the revision tokens (`revision`, and
`content_revision` from the work row) so a caller can retry against the
current row; `forbidden` returns neither.

`unavailable` is the exact list of recorded-value gaps: `assignee`,
`assigned_by`, `assigned_at`, `due_at`, `status` (and `blocked_reason` when
the status is `blocked` but no reason is recorded), plus `next_decision`
when it is not computable. A value that is not recorded is never filled
from content authorship, prose, UI state or another campaign.

## Next decision

`next_decision` is derived, never stored, so the Overview checklist and the
decision cannot disagree. Inputs are the four existing readiness answers
(draft, audience frozen and valid, live sender, accepted test — the same
chain behind `sendReadiness`) plus the recorded lifecycle:

1. `status` is `done` or `cancelled` → `closed`.
2. `status` is `blocked` or a blocked reason is recorded → `unblock`.
3. Otherwise the first unmet readiness gate, in order:
   `draft` → `audience` → `sender` → `test` → else `send`.
4. A readiness answer that is not recorded yields `unknown` rather than a
   failed check. Callers that cannot read the chain pass `null` and get
   `partial` with `next_decision: null`.

Assignment is not a readiness gate, so an unassigned campaign still shows
the campaign's next decision.

## Panel behavior

The campaign-work panel applies the same rules to its own reads and writes:

- A read failure other than "no metadata" (transport, 503, malformed reply)
  renders an explicit alert with **Retry** for writable *and* read-only
  viewers. It never falls back to empty fields or an "Unassigned" summary.
  A host that does not advertise the operations, or a caller refused access,
  gets its own unavailable note instead of a form.
- A refused value (bad due date, bad assignee) shows its message and leaves
  the controls usable; validation happens before the busy state, so the form
  is never stuck.
- A stale save (409) writes nothing, re-reads the current row, keeps the
  operator's typed values on screen and shows a persistent conflict notice
  naming the current revision. The operator reviews and saves again; there
  is no silent overwrite and no automatic retry.

## What this contract does not do

- No approval, send, publish, SMTP, credential or effect verb exists here.
- No new task store: the row references the campaign and content revision.
- No duplicate readiness logic: `next_decision` consumes the existing
  chain's answers.
- No inference of owner or lifecycle from content authorship.

## Host pairing

Everything above that reads or writes recorded work needs a paired host
change in the Cadence host (not this repository):

1. Two `ScreenOperation` variants — `campaign-work.show` and
   `campaign-work.save` — accepted by the install-time screen declaration
   parser, the closed verb tables and the screen-services dispatch, with
   the bodies above.
2. An installation/context-scoped store row keyed by
   `(context_id, campaign_id)` holding the fields in the table above, with
   revision CAS, same-transaction attribution from the authenticated
   caller and the content revision read inside the transaction.
3. A `crm-campaign-work` v1 entry in the host's supported-contract
   registry so `needs.requires.contracts` admits the package and
   source discovery can enumerate sources by contract.
4. A read adapter for authorized callers that applies
   `campaignWorkRead`'s state rules and returns the response shape above,
   including `forbidden` and `stale` refusals with no values.

Until that pairing lands, a host refuses this package at install (unknown
requirement/operations) instead of installing a screen whose campaign-work
actions cannot run. The app's normal checks (`pnpm typecheck`, `pnpm
build`, `pnpm verify`, `python3 scripts/package_app.py check --source
app`) and the focused tests in `tests/unit/campaign_work.test.mjs` and
`tests/contract/campaign_work_client.test.mjs` cover only the app side.
