# CRM dev fixture definitions (CAD-974)

This `dev/` directory holds **app-owned, fixture-only development content**
for the CRM package. It is not part of the installable `app/` bundle, is not
an installed app, and proves nothing about rendering, HMR, installation or
live actions — those are separate, later slices.

## Contents

| File | What it is |
|---|---|
| `app-views-v1.json` | App-owned `app-views/v1` descriptor: `customers`, `segments`, `campaigns` tables, `customer-detail` detail, `customer-form` disabled form preview. |
| `fixtures.json` | Synthetic fixture rows as `{ populated: {…}, empty: {…} }` scenarios keyed by declared view id — populated rows exercise real content, empty rows exercise the empty state. Never shipped in a descriptor or bundle. |

## Contract check

The only supported validation runs the **canonical** Cadence
`app-views/v1` grammar, not a copy:

```sh
node scripts/check_app_views.mjs
```

The checker refuses unless the explicitly selected host checkout is at the
pinned revision `5577dea81ef3b39134199ed7b7c5541235baae4a` **and** the two
canonical source files' bytes match `git show <pin>:<path>` — a moved or
dirty worktree fails. The pinned checkout supplies
`contracts/app-views/v1/app-view.schema.json` and
`ui/src/features/app-shell/app-views/contract.ts`; the tool root
(`/home/ubuntu/Project/cadence`) supplies only its installed
`ui/node_modules` TypeScript compiler. No vendored validator, no
hand-copied schema, no fake PASS.

Options: `--host-source <abs path>` (default the CAD-970 trusted lane),
`--tool-root <abs path>` (default `/home/ubuntu/Project/cadence`). Any other
option refuses.

### Companion: published JSON Schema validation

The canonical `parseAppView` covers every rule the schema expresses plus
the consumer-only cross-references. If you additionally want the published
JSON Schema itself machine-checked against the descriptor, run Python
`jsonschema` (≥ 4.x) against the pinned schema file — the schema is *not*
loaded by the Node check because the app repo ships no validator:

```sh
HOST=/home/ubuntu/Project/cadence/.cadence/wt/cad-970-independent-apps-structured-git
python3 -c "
import json, jsonschema, sys
schema = json.loads(open(f'$HOST/contracts/app-views/v1/app-view.schema.json').read())
cls = jsonschema.validators.validator_for(schema)
cls.check_schema(schema)
inst = json.load(open('dev/app-views-v1.json'))
cls(schema).validate(inst)
print('schema OK')
"
```

Both checks are complementary: schema = grammar shape, canonical consumer =
grammar shape plus bounds/cross-references/forbidden keys.

## Fixture shape

`fixtures.json` carries exactly two scenarios:

- `populated` — one or more real synthetic rows per non-form view,
  including unicode, long and inert-markup cells.
- `empty` — `[]` per non-form view, exercising the empty state.

Every key under a scenario must name a declared view; unknown keys refuse.
Form views carry `[]` only — the canonical `fixtureRows` refuses any rows
on a fieldless form, so the checker asserts emptiness without invoking it.

## Boundary

The descriptor is data: it declares views, fields and columns only. It
carries no executable surface, URL, scope, actor, authority, credential or
storage key — the canonical `scanUnsafe`/`parseAppView`/`fixtureRows` gate
refuses all of them at every level. The form view is a disabled preview by
contract; it declares no submit target. The renderer lives in the trusted
host and is imported directly — nothing here copies Field/DataTable/CSS or
builds a DOM sink.

All contact addresses use the reserved `example.invalid` domain; every
record is synthetic; no real customer data or send authority exists here.
