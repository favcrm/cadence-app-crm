# Packaging and installing the `app/` bundle (CAD-962)

`scripts/package_app.py` builds the unchanged `app/` tree into a
deterministic release archive under `dist/` (ignored by Git) plus a
SHA256 sidecar. Python 3.10+ standard library only; this choice does
not select a plugin execution runtime, SDK or toolchain.

```sh
python3 scripts/package_app.py check   --source app           # offline shape check
python3 scripts/package_app.py build   --source app --outdir dist   # archive + .sha256
python3 scripts/package_app.py verify  dist/crm-0.1.0.tar.gz        # digest + member shape
python3 -m unittest discover -s tests/unit -v                        # tool tests
```

## What the checks do and do not prove

`check`/`build`/`verify` mirror the *shape* rules the v0 host loader
applies in `src/issue/app.rs` (`bundle_files` + `parse_manifest`):
required `app.md` and `workflows/`, only the five known top-level dirs
(`workflows/`, `rubrics/`, `templates/`, `views/`, `bindings/`), flat
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
the root, dot-directories and duplicate/normalized names refuse; per-file
and aggregate size bounds are enforced while reading, before any
unbounded aggregation.

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

## Still missing (separate scope)

* Host-side execution of `app install`/`app approve` against this
  bundle — not run here; see release acceptance in
  `docs/repository-layout.md`.
* The action/domain/migration contract and the app-views/app-bindings
  descriptor work (`app/views/`, `app/bindings/` are planned).
* The two-version install/update/isolation/rollback rehearsal.
