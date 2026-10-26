# Repository layout and release boundary — draft ADR

Decision: use `cadence-app-<slug>` for separately versioned app repositories, beginning with
`favcrm/cadence-app-crm`; retain the installed app slug `crm`. This is a proposed Cadence
project convention, not a claim of an ecosystem-wide standard.

`app/` is the deployable bundle root. The existing loader expects `app.md` and known bundle
content such as `workflows/`, `rubrics/`, `views/app-views-v1.json`, `bindings/app-bindings-v1.json`
and the bounded `screens/crm/` assets. A storage-bearing app additionally declares
`needs.requires.contracts.app-storage: [1]` and carries `app-storage.json` with flat
`storage/<tag>.json` migrations. Native Cadence has no app-storage execution runtime and
refuses that requirement; only a hosted v2 runtime with the real adapter executes the plan.
A packaging PASS validates member shape and exact migration hashes only — it does not prove
schema execution, installation or update. Declare descriptors/companions only when both
package content and compatible host contracts have been validated.

`src/` contains app-specific source authored here; `tests/` separates unit, pinned-host
contract, and lifecycle acceptance. `scripts/` packages validated release inputs into ignored
`dist/`. The domain execution mechanism and migration format/integrity envelope are fixed by
the AOS-384 app-storage/v1 contract documented in `docs/packaging.md`; changing them needs a
new contract major. No SDK or compatibility version is invented by this scaffold.

Shared visual components remain in Cadence. The app uses them through a versioned host
contract; it must not vendor copies of the host sidebar, chat, Field, DataTable or drawers.
A dedicated CRM frontend may only be shipped once the host supports that extension mechanism.
The current descriptor renderer is read-only; forms/actions and campaign domain behavior
still need explicit contracts. CRM metadata extraction does not replace that work.

Release acceptance:

1. Build a CRM artifact independently and pin its version, integrity and compatible host API.
2. Install v1 on an unchanged compatible host using supported operator paths.
3. Verify real scoped CRM reads and writes, CSV/segments/campaign workflow, desktop/narrow UI.
4. Install a CRM-only v1.1 update with no host source edits or rebuild; preserve installation,
   data, connections and valid approval/effect history.
5. Prove two installations stay isolated; incompatible/tampered packages refuse activation.
6. Rehearse migration, interrupted update recovery, backup and rollback without duplicate effects.

Keep the present CRM operational until this acceptance passes. Independent review and
production rollout are separate delivery gates. Never include real customer records,
credentials or production state in this repository.
