# Packaging and installing the `app/` bundle (CAD-962)

`scripts/package_app.py` builds the unchanged `app/` tree into a
deterministic release archive under `dist/` (ignored by Git) plus a
SHA256 sidecar. Python 3.10+ standard library only; this choice does
not select a plugin execution runtime, SDK or toolchain.

```sh
python3 scripts/package_app.py check   --source app           # offline shape check
python3 scripts/package_app.py build   --source app --outdir dist   # archive + .sha256
python3 scripts/package_app.py verify  dist/crm-0.3.0.tar.gz        # digest + member shape
python3 -m unittest discover -s tests/unit -v                        # tool tests
```

## What the checks do and do not prove

`check`/`build`/`verify` mirror the *shape* rules the v0 host loader
applies in `src/issue/app.rs` (`bundle_files` + `parse_manifest`):
required `app.md` and `workflows/`, the five v0 top-level dirs
(`workflows/`, `rubrics/`, `templates/`, `views/`, `bindings/`), the
bounded `screens/crm/` screen and — for a storage-bearing app — flat
`storage/<tag>.json` members, root descriptors (`app-actions.json`,
`app-assistant.json`, `app-chat.json`, `app-storage.json`), flat
dirs, no symlinks, no dotfiles, no unknown top-level entries,
tag-shaped names, bounded file count/size, and the manifest
frontmatter key allowlist (`app`, `title`, `version`, `needs`,
`summary`; `records`/`actions`/`ui`/`settings`/`actors` refuse as
later-stage). An A1 bundle is UTF-8 text only — every file (not just
`app.md`) is decoded on both the source and archive path.
`needs.views`/`needs.bindings` declarations and their descriptor files
are checked both ways on the archive exactly as on the source. Archive
members must be regular files or plain directories under the single
bundle root — non-regular types (links, devices, fifos), paths outside
the root, dot-directories and duplicate names refuse. Member names must
be canonical: `.`/`..`/`//` components and non-trailing empty parts are
rejected on the raw string *before* `PurePosixPath` normalization, so an
alias like `crm-0.1.0/./workflows/x.md` can never collide with and
overwrite the canonical file on extract. Per-file and aggregate size
bounds are enforced while reading, before any unbounded aggregation.
Malformed inputs (a non-ASCII sidecar, a corrupt zip local header, a
truncated/garbage archive) surface as clean `PackageError` refusals —
exit 1 with a short message, never a traceback.

A PASS here is **not** host validation. The tool does not run
`workflow check`, the secret guard, `uses:` slot cross-checks,
descriptor/bindings parsing or capability validation, and it never
claims a host accepted the bundle. Those run on the host at install.

## Installing: extracted bundle path

The loader installs a *bundle root* — a directory with `app.md` at the
top level (this repo's `app/`, or an extracted archive root
`crm-0.1.0/`). This repository root is **not** a valid direct install
source, and a git-URL install scans the clone root, so the `app/`
subdirectory is not addressable by URL — there is no supported
`#subdir` form. Install path:

```sh
# 1. Clone (or copy) the repo locally, then install the bundle root:
cadence app install /path/to/cadence-app-crm/app --project <key>

# 2. Or stage a release archive to a private temp dir and install the
#    extracted bundle root:
mkdir -p /tmp/crm-stage && cd /tmp/crm-stage
sha256sum -c crm-0.1.0.tar.gz.sha256          # sidecar integrity check
tar -xzf crm-0.1.0.tar.gz                     # member paths were shape-checked at build
cadence app install /tmp/crm-stage/crm-0.1.0 --project <key>
```

Install lands the app **unapproved**: nothing runs until the
operator's `cadence app approve` records the host-computed structural
bundle digest (`sha256:…`). The archive's `.sha256` sidecar is
transport-integrity evidence only — it is not that digest, not a
signature and not an approval.

## Determinism

Archive member mtimes are pinned to epoch 0, uid/gid/uname/gname are
zeroed, modes are fixed (644/755), members are written sorted and the
gzip header MTIME is zeroed, so identical inputs give byte-identical
archives. Byte identity is guaranteed within one Python version on
this platform; it is not claimed across Python versions or OSes. The
sidecar pins the archive bytes, so any divergence after publication
is detected by `verify` / `sha256sum -c`.

## Customer-chat descriptors (CRM 0.1.2)

`app/app-actions.json`, `app/app-assistant.json` and `app/app-chat.json`
are root descriptors admitted by exact name only (no wildcard). The
allowlist is `ROOT_DESCRIPTORS` in `scripts/package_app.py`, with each
contract marker in `DESCRIPTOR_CONTRACTS` (`app-chat/v1`,
`app-assistant/v1`, `app-actions/v1`). Actions and assistant are paired:
the host requires both. `app-chat.json` is the installed 0.1.0 chat
contract, kept byte-identical for upgrade compatibility. The package tool
checks bytes, JSON object shape and contract marker only; it does not parse
their semantics and is not install approval.

* Compatibility basis: the CAD-1415 host draft (`src/issue/app_action.rs`,
  `src/issue/app_assistant.rs`) on a local, uncommitted worktree. It is
  not on `main` and is not a full CRM domain independence claim.
* Legacy customer limits follow native `CustomerProfile`: `display_name` 120,
  `email` 254, `phone` 24, `source` 40, `tags` 16 items of 40. Consent,
  identity and revision are not writable.
* The archive's `.sha256` sidecar and the tool's PASS are integrity
  evidence only. Neither is the Cadence bundle digest, an approval, or a
  host acceptance.
* Install path is the extracted bundle root (`crm-0.1.2/`). The git
  subdirectory is not an install source.
* Lifecycle, install, browser QA and independent review of this version are
  not run by this tool and are pending.

## App-owned storage (CRM 0.3.0, AOS-384)

`app/app-storage.json` is a root member declaring `app-storage/v1`, and
`app/storage/<tag>.json` are the ordered migrations. The descriptor is
closed: `contract`, `app`, `record_kind` (the records bridge kind —
`customer`, preserving the native `kind: customer`), `schema_version`,
`compatible_schema_versions`, `default_table`, and
`migrations[{version,path,sha256}]`; each `sha256` is
the exact raw-byte digest of that migration file. `app.md` must declare
`needs.requires.contracts.app-storage: [1]`. `record_write_schema` is
optional; when present it is a bounded standard JSON Schema declaration
over `{operation,before,after,provenance}`. `record_search_columns` is
also optional: a bounded unique list of text/json columns of
`default_table` (validated against the accumulated migration plan) that
the host's generic record search may use. The schema-v2 package lists
`display_name`, `email`, `tags`, `phone` and `source`; the v1 fixture
lists only the three columns schema 1 declares. This tool checks member
shape and bounds only — the host's app-storage validation owns keyword
admission and execution. `check`/`build`/`verify`
refuse a missing or altered migration, a declared-but-absent plan, an
undeclared extra `storage/` member, a descriptor app that differs from the
manifest, non-contiguous versions, unknown or destructive operations,
duplicate names, host base columns, and a non-null added column without a
default. A PASS is offline member/hash grammar only.

Native Cadence has no app-storage execution runtime. A native host refuses
the syntactically valid `app-storage: [1]` requirement instead of
installing this package; a host older than the contract also refuses the
root member and `storage/` directory. Only a hosted v2 runtime with the
real adapter installs or executes this schema. Nothing here proves schema
execution, migration, installation or update.

The plan declares `customers`, `segments`, `campaigns` and `proposals`,
including the `synthetic` boolean (default false) that keeps seeded legacy
rows distinguishable, and the `proposals.campaign_id` relation with its
index. Schema v2 adds nullable `phone` (24) and `source` (40) to
`customers` plus a `customers_phone` index, using the existing
`records.create`/`records.update` profile; no new bridge operation or
screen design is introduced. Host-owned `id`, `context_id`, `revision`,
`created_at` and `updated_at` are never declared. SMTP credentials,
approval/effect authority and sends stay host-owned and are not app
tables.

Length bounds cover the union of accepted native and hosted inputs so
adoption cannot truncate or reject real rows: `display_name` 200 (native
`CustomerProfile` allows 120, the hosted import accepts 200), `email` 254,
`phone` 24, `source` 40, segment name 80, campaign name 240, subject 150,
preheader 200, identifiers and actor 64. `proposals.state` accepts the
native `pending`, `applied` and `discarded` values. `create_table` may
declare `record_bytes` up to 262144 — the host absolute record limit; the
generic default stays 16 KiB. `campaigns` and `proposals` declare 262144 so
existing large content is not refused at the record boundary.

Columns may also declare `format` (`email`, `phone` or `tag` on a text
column) and `json_schema` (a bounded standard JSON Schema on a json
column). This package uses `email`/`phone`/`tag` for
`customers.email`/`phone`/`source`, a tags array schema (≤16 unique 1–40
character `[A-Za-z0-9_-]` values) and a consent object schema (`email` and
`sms`, each `granted`/`denied`/`unknown`/`null`). `record_write_schema`
requires reported provenance when an update moves either channel from not
granted to granted; a create keeps provenance optional. The host executes
these declarations inside the write transaction — browser shaping alone is
never the authority.

### Schema-v1 staging recipe (package-only v1 → v2 proof)

`tests/fixtures/app-storage-v1/` carries a `schema_version: 1` descriptor
and a byte-identical copy of `001-initial.json`. Stage a v1 bundle from
the current tree so the manager can exercise a real package-only upgrade on
an unchanged host:

```sh
rm -rf /tmp/crm-v1 /tmp/crm-v1-dist && cp -r app /tmp/crm-v1
cp tests/fixtures/app-storage-v1/app-storage.json /tmp/crm-v1/app-storage.json
rm /tmp/crm-v1/storage/002-customer-phone-source.json
sed -i "s/^version: '0.3.0'/version: '0.2.1'/" /tmp/crm-v1/app.md
python3 scripts/package_app.py check --source /tmp/crm-v1
python3 scripts/package_app.py build --source /tmp/crm-v1 --outdir /tmp/crm-v1-dist
python3 scripts/package_app.py build --source app --outdir dist
```

Install `/tmp/crm-v1-dist/crm-0.2.1.*` (schema_version 1) on the hosted v2
runtime, create or adopt real records, then install `dist/crm-0.3.0.*` on
the same unchanged host. Expect only migration 2 pending, the `phone` and
`source` columns plus `customers_phone` index to appear, and installation
id, record ids, revisions, consent and `synthetic` values to stay intact.
The `0.2.1` label is a staging artifact for the upgrade path, not a
re-release of 0.2.1 and not a release claim.

## Still missing (separate scope)

* Host-side execution of `app install`/`app approve` against this
  bundle — not run here; see release acceptance in
  `docs/repository-layout.md`.
* Native app-storage execution and the action/domain contract plus the
  app-views/app-bindings descriptor work (`app/views/`,
  `app/bindings/` are planned).
* The two-version install/update/isolation/rollback rehearsal.
