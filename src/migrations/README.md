# src/migrations

No TypeScript migration source belongs here. The package's app-owned logical
schema and its ordered, raw-byte-checksummed migrations live in
`app/app-storage.json` and `app/storage/<tag>.json`, declared under the
`app-storage/v1` contract (see `docs/packaging.md`).

Native Cadence has no app-storage execution runtime. A hosted v2 runtime with
the real adapter applies the plan inside its tenant transaction; this
repository's packaging checks validate member shape and exact migration hashes
only, not execution, install or recovery. A schema change is a new migration
file plus a descriptor update — never an edit to an applied migration.
