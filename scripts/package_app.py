#!/usr/bin/env python3
"""Deterministic packaging and verification for the ``app/`` bundle.

CAD-962: builds the unchanged ``app/`` tree into a versioned
``.tar.gz`` release archive plus a SHA256 sidecar under ``dist/``, or
verifies a previously built archive against the bundle.

Scope and honesty notes:

* This tool packages the bundle *bytes* only. The SHA256 sidecar is an
  integrity digest of the archive — it is NOT the Cadence host bundle
  digest (`sha256:...` from `app approve`), never a signature, and no
  authorization or approval evidence.
* The structural checks mirror the *shape* rules the v0 host loader
  applies in `src/issue/app.rs` (`bundle_files` + `parse_manifest`):
  required `app.md`, required `workflows/`, the five known top-level
  dirs, flat dirs only, no symlinks, no dotfiles, no unknown top-level
  entries, tag-shaped names, bounded file count and sizes, and the
  manifest frontmatter key allowlist. They run offline and do NOT
  reimplement workflow checks, the secret guard, slot cross-checks or
  descriptor parsing — a PASS here is not host validation.
* The release archive installs through the *extracted bundle path*:
  extract to a private directory and run
  `cadence app install <extracted-bundle-dir> --project <key>`. The
  current loader installs a bundle root (`app.md` at the top level);
  this repository root is NOT a valid direct install source because
  the bundle lives under `app/`, and a git URL install scans the clone
  root — no `#subdir` form exists. See docs/repository-layout.md.
* Determinism: archive member mtimes are normalized to a fixed epoch,
  uid/gid/uname/gname are zeroed, and entries are written sorted, so
  repeated builds of identical inputs are byte-identical. Byte
  identity is not guaranteed across Python versions or platforms.

Only the Python standard library is used; this choice does not select
an app execution runtime.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import stat
import sys
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

# --- Host v0 loader shape bounds (src/issue/app.rs) -------------------
# Mirrors bundle_files()/parse_manifest() constants. If the host
# contract moves, update these and the docs; do not weaken a check to
# force a build.

MANIFEST = "app.md"
TOP_DIRS = ("workflows", "rubrics", "templates", "views", "bindings")
MANIFEST_KEYS = ("app", "title", "version", "needs", "summary")
GATED_KEYS = ("records", "actions", "ui", "settings", "actors")
NEEDS_KEYS = ("connections", "capabilities", "views", "bindings")
VIEW_CONTRACT = "app-views/v1"
BINDING_CONTRACT = "app-bindings/v1"
VIEWS_FILE = "app-views-v1.json"
BINDINGS_FILE = "app-bindings-v1.json"
MAX_FILE_BYTES = 256 * 1024  # plan::MAX_PLAN_BYTES
MAX_FILES = 128
MAX_APP_BYTES = 2 * 1024 * 1024
TAG_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,31}\Z")
# Matches 1.y.z with each component a non-negative integer (no "+"
# accepted by int() either — the leading digit class blocks it).
VERSION_RE = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+\Z")

# Tar member metadata normalized for byte-identical rebuilds.
EPOCH = 0
SIDECAR_SUFFIX = ".sha256"
ALLOWED_FORMATS = ("tar.gz", "zip")


class PackageError(Exception):
    """A refused input or failed check — printed to stderr, exit 1."""


@dataclass(frozen=True)
class Manifest:
    """Fields this tool deliberately reads from `app.md` frontmatter.

    `app`, `title`, `version` are required strings; `summary` is an
    optional one-line string; `connections` is the declared slot list
    under `needs:`; `view_contract`/`binding_contract` are the declared
    `needs.views.contract`/`needs.bindings.contract` values. Anything
    else is parsed only enough to enforce the key allowlists.
    """

    app: str
    title: str
    version: str
    summary: str | None
    connections: tuple[str, ...]
    view_contract: str | None
    binding_contract: str | None


# --- Minimal YAML frontmatter parser ---------------------------------
#
# The host parses frontmatter with serde_yaml. Packaging needs only the
# declared fields, so a deliberately small subset is parsed instead of
# vendoring a YAML dependency: plain scalars (quoted or unquoted) at
# top level, and a `needs:` mapping holding a `connections:` flow list
# (`[]` or `[a, b]`) and `views:`/`bindings:` maps with one `contract:`
# scalar each. Frontmatter outside this subset is refused rather than
# silently misread — the bundle must stay in the shape the host's full
# parser also accepts.


def _split_front(text: str, rel: str = MANIFEST) -> tuple[str, str]:
    """Split `---` fenced frontmatter like the host's parse::split_front.

    Returns (yaml, body). Refuses a missing open or closing fence.
    """
    stripped = text.removeprefix("\ufeff")
    if not (stripped.startswith("---\n") or stripped.startswith("---\r\n")):
        raise PackageError(
            f"{rel} must start with a '---' frontmatter fence — "
            "frontmatter `app`, `title`, `version` and the agent guide are required"
        )
    after_open = 5 if stripped.startswith("---\r\n") else 4
    rest = stripped[after_open:]
    for m in re.finditer(r"---", rest):
        idx = m.start()
        before_ok = idx == 0 or rest[idx - 1] == "\n"
        after = rest[idx + 3 :]
        after_ok = (
            after == ""
            or after.startswith("\n")
            or after.startswith("\r\n")
            or after.startswith(" ")
        )
        if before_ok and after_ok:
            yaml = rest[:idx]
            # The fence's own line ending, then one blank separator
            # line — same rule as the host's parse::split_front.
            body = after
            if body.startswith("\r\n"):
                body = body[2:]
            elif body.startswith("\n"):
                body = body[1:]
            if body.startswith("\n"):
                body = body[1:]
            elif body.startswith("\r\n"):
                body = body[2:]
            return yaml, body
    raise PackageError(f"{rel}: frontmatter has no closing '---' fence")


def _unquote(value: str, where: str) -> str:
    """Read one YAML plain/single/double-quoted scalar."""
    value = value.strip()
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1].replace("''", "'")
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        # Double-quoted scalars support backslash escapes; only the ones
        # a manifest realistically carries are decoded, and an unknown
        # escape refuses instead of guessing.
        inner = value[1:-1]
        out = []
        i = 0
        escapes = {"n": "\n", "t": "\t", '"': '"', "\\": "\\", "0": "\0"}
        while i < len(inner):
            ch = inner[i]
            if ch == "\\":
                i += 1
                if i >= len(inner) or inner[i] not in escapes:
                    raise PackageError(f"{where}: unsupported escape in quoted scalar")
                out.append(escapes[inner[i]])
            else:
                out.append(ch)
            i += 1
        return "".join(out)
    if value == "" or value.startswith(("{", "[", "#", "!", "&", "*", "|", ">")):
        raise PackageError(f"{where}: expected a plain scalar value")
    # A `#` only starts a comment after whitespace.
    value = re.sub(r"\s+#.*\Z", "", value).strip()
    if value in ("~", "null", "Null", "NULL"):
        raise PackageError(f"{where}: expected a non-empty scalar, got null")
    return value


def _flow_strings(value: str, where: str) -> list[str]:
    """Parse `[a, b]` or `[]` into a list of plain scalars."""
    value = value.strip()
    if not (value.startswith("[") and value.endswith("]")):
        raise PackageError(
            f"{where} is a list of slot names — [publish, cms]"
        )
    inner = value[1:-1].strip()
    if not inner:
        return []
    out = []
    for tok in inner.split(","):
        tok = _unquote(tok.strip(), where)
        out.append(tok)
    return out


def parse_manifest(text: str) -> Manifest:
    """Parse `app.md` frontmatter under the v0 key allowlists.

    Deliberately extracts `app`, `title`, `version`, `summary`,
    `needs.connections`, `needs.views.contract` and
    `needs.bindings.contract`. Unknown or later-stage keys refuse.
    """
    yaml, _body = _split_front(text)
    fields: dict[str, str | None] = {}
    needs: dict[str, str] = {}
    in_needs = False
    # Indent of `needs:` children; `needs.views:`/`needs.bindings:` may
    # carry one nested `contract:` line deeper than that indent.
    needs_child_indent: int | None = None
    needs_sub: str | None = None
    for raw_line in yaml.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indented = raw_line[0] in (" ", "\t")
        line = raw_line.strip()
        if not indented:
            in_needs = False
            needs_sub = None
            if ":" not in line:
                raise PackageError(
                    f"{MANIFEST} frontmatter line is not a `key: value` — {line!r}"
                )
            key, _, value = line.partition(":")
            key = key.strip()
            if key in GATED_KEYS:
                raise PackageError(
                    f"{MANIFEST} frontmatter key '{key}' is a later stage "
                    "(A2/A3) — v0 installs app.md + workflows/ + optional "
                    "rubrics/, templates/, views/ only"
                )
            if key not in MANIFEST_KEYS:
                raise PackageError(
                    f"{MANIFEST} frontmatter key '{key}' is unknown — v0 knows "
                    f"{', '.join(MANIFEST_KEYS)}; anything else can never be installed"
                )
            if key == "needs":
                if value.strip() and value.strip() != "{}":
                    raise PackageError(
                        f"{MANIFEST} `needs:` is a mapping — v0 knows "
                        "needs.connections, needs.capabilities, needs.views, "
                        "needs.bindings"
                    )
                in_needs = True
                continue
            fields[key] = _unquote(value, f"{MANIFEST} `{key}:`")
        elif in_needs:
            indent = len(raw_line) - len(raw_line.lstrip())
            if needs_child_indent is None:
                needs_child_indent = indent
            if ":" not in line:
                raise PackageError(
                    f"{MANIFEST} `needs:` entry is not a `key: value` — {line!r}"
                )
            key, _, value = line.partition(":")
            key = key.strip()
            if indent > needs_child_indent:
                if needs_sub is None or key != "contract":
                    raise PackageError(
                        f"{MANIFEST} `needs.{needs_sub}` knows only `contract`"
                        if needs_sub
                        else f"{MANIFEST} frontmatter: nested content is only "
                        "supported under `needs.views`/`needs.bindings`"
                    )
                needs[needs_sub] = f"contract:{value.strip()}"
                continue
            needs_sub = None
            if key not in NEEDS_KEYS:
                raise PackageError(
                    f"{MANIFEST} `needs.{key}` is unknown — v0 knows "
                    "needs.connections, needs.capabilities, needs.views, "
                    "needs.bindings"
                )
            needs[key] = value.strip()
            if value.strip() == "" and key in ("views", "bindings"):
                needs_sub = key  # may carry a nested `contract:` line
        else:
            raise PackageError(
                f"{MANIFEST} frontmatter: nested content is only supported "
                "under `needs:`"
            )

    def need(key: str, what: str) -> str:
        value = fields.get(key)
        if value is None or not value.strip():
            raise PackageError(f"{MANIFEST} needs `{key}:` — {what}")
        return value.strip()

    app = need("app", "the app name — the folder it installs as")
    _check_tag(app, "app name")
    title = need("title", "one line naming the app")
    version = need("version", "a version string like 0.1.0")
    for key, cap in (("title", 120), ("version", 40)):
        value = title if key == "title" else version
        if len(value) > cap or any(ord(c) < 0x20 or ord(c) == 0x7F for c in value):
            raise PackageError(
                f"{MANIFEST} `{key}:` — ≤{cap} chars, no control characters"
            )
    summary = fields.get("summary")
    if summary is not None:
        summary = summary.strip()
        if not summary:
            summary = None
        elif len(summary) > 160 or any(ord(c) < 0x20 or ord(c) == 0x7F for c in summary):
            raise PackageError(
                f"{MANIFEST} `summary:` — ≤160 chars, no control characters"
            )

    connections: list[str] = []
    view_contract = None
    binding_contract = None
    if "views" in needs:
        view_contract = _needs_contract(needs["views"], "views", VIEW_CONTRACT)
    if "bindings" in needs:
        binding_contract = _needs_contract(needs["bindings"], "bindings", BINDING_CONTRACT)
    if "capabilities" in needs:
        # The shape mirror does not decode capability declarations —
        # the host validates them — but an empty flow map is still a
        # declared empty set and valid.
        if needs["capabilities"] not in ("{}", ""):
            raise PackageError(
                f"{MANIFEST} `needs.capabilities` declarations are validated "
                "by the host; this packaging check accepts only an empty "
                "`needs.capabilities: {{}}` (or its absence)"
            )
    if "connections" in needs:
        for slot in _flow_strings(needs["connections"], f"{MANIFEST} `needs.connections`"):
            _check_tag(slot, "connection slot")
            if slot in connections:
                raise PackageError(f"connection slot '{slot}' is declared twice")
            connections.append(slot)

    return Manifest(
        app=app,
        title=title,
        version=version,
        summary=summary,
        connections=tuple(connections),
        view_contract=view_contract,
        binding_contract=binding_contract,
    )


def _needs_contract(value: str, key: str, expected: str) -> str:
    """Read `contract: <value>` out of a `needs.<key>` inline/block map."""
    value = value.strip()
    if value.startswith("{"):
        inner = value.strip("{}").strip()
        parts = dict(
            p.strip().split(":", 1) for p in inner.split(",") if p.strip()
        )
        contract = parts.get("contract", "").strip()
        if set(parts) != {"contract"} or not contract:
            raise PackageError(f"{MANIFEST} `needs.{key}` knows only `contract`")
    elif value.startswith("contract:"):
        contract = value.split(":", 1)[1].strip()
    elif value == "" or value == "{":
        raise PackageError(
            f"{MANIFEST} `needs.{key}` is a mapping — `contract: {expected}`"
        )
    else:
        raise PackageError(f"{MANIFEST} `needs.{key}` knows only `contract`")
    contract = contract.strip("'\"")
    if contract != expected:
        raise PackageError(
            f"{MANIFEST} `needs.{key}.contract` is exactly `{expected}` — "
            "the contract the bundle's descriptor/companion file declares"
        )
    return contract


def _check_tag(name: str, what: str) -> None:
    if not TAG_RE.match(name):
        raise PackageError(
            f"{what} '{name}' — 1-32 lowercase letters, digits or hyphens"
        )


def _check_version_semver(version: str, path: Path | None = None) -> None:
    """Release naming wants `0.1.0` semantics: exactly three ints.

    The host only requires a non-empty ≤40-char version string; the
    archive name is stricter on purpose so a release is always
    sortable. A manifest version outside semver is rejected by
    `build`/`verify` with a clear error, not silently renamed.
    """
    if not VERSION_RE.match(version):
        raise PackageError(
            f"{MANIFEST} version '{version}' — release archives need a "
            "major.minor.patch version like 0.1.0 (the host accepts any "
            "short string; the archive name is deliberately stricter)"
        )


# --- Bundle file inventory (mirrors host bundle_files shape rules) ----


def bundle_files(root: Path) -> list[str]:
    """Return the sorted relative file list of a valid bundle tree.

    Mirrors `bundle_files()` in the host loader: the root is a real
    directory (never a symlink), `app.md` and `workflows/` are
    required, only TOP_DIRS are allowed beside it, dirs are flat,
    dotfiles/symlinks/non-regular files refuse, non-UTF-8 names
    refuse, and file count/size bounds apply.
    """
    try:
        st = os.lstat(root)
    except OSError as e:
        raise PackageError(f"cannot stat app source {root}: {e}") from e
    if stat.S_ISLNK(st.st_mode):
        raise PackageError(f"app source {root} is a symlink — an app is a real folder")
    if not stat.S_ISDIR(st.st_mode):
        raise PackageError(f"app source {root} is not a folder")

    files: list[str] = []
    dirs: list[str] = []
    manifest = False
    for entry in sorted(os.scandir(root), key=lambda e: e.name):
        name = entry.name
        _check_utf8_name(name, "app source")
        if name.startswith("."):
            if name == ".git":
                continue  # a clone's .git is never app content
            raise PackageError(f"app source entry '{name}': dotfiles are not app content")
        if entry.is_symlink():
            raise PackageError(
                f"app source entry '{name}': a symlink — an app folder holds "
                "real files only"
            )
        if entry.is_file(follow_symlinks=False):
            if name == MANIFEST:
                manifest = True
                files.append(name)
                continue
            raise PackageError(
                f"app source entry '{name}' — v0 knows app.md, workflows/, "
                "rubrics/, templates/, views/, bindings/; everything else refuses"
            )
        if entry.is_dir(follow_symlinks=False):
            if name in TOP_DIRS:
                dirs.append(name)
                continue
            raise PackageError(
                f"app source entry '{name}' — v0 knows app.md, workflows/, "
                "rubrics/, templates/, views/, bindings/; everything else refuses"
            )
        raise PackageError(f"app source entry '{name}': not a regular file")

    if not manifest:
        raise PackageError(
            f"app source {root} has no app.md — frontmatter `app`, `title`, "
            "`version` and the agent guide are required"
        )
    if "workflows" not in dirs:
        raise PackageError(
            "an app needs workflows/ — the workflows it bundles; an app with "
            "none installs nothing runnable"
        )

    for top in dirs:
        for entry in sorted(os.scandir(root / top), key=lambda e: e.name):
            name = entry.name
            rel = f"{top}/{name}"
            _check_utf8_name(name, top)
            if name.startswith("."):
                raise PackageError(f"app source entry '{rel}': dotfiles are not app content")
            if entry.is_symlink():
                raise PackageError(
                    f"app source entry '{rel}': a symlink — an app folder "
                    "holds real files only"
                )
            if entry.is_dir(follow_symlinks=False):
                raise PackageError(
                    f"app source entry '{rel}': v0 app dirs are flat — no nested folders"
                )
            if not entry.is_file(follow_symlinks=False):
                raise PackageError(f"app source entry '{rel}': not a regular file")
            if top == "workflows":
                if not name.endswith(".md"):
                    raise PackageError(
                        f"app source entry '{rel}': workflows are plan-template "
                        "files ending in .md"
                    )
                _check_tag(name[: -len(".md")], "workflow name")
            if top == "views" and name != VIEWS_FILE:
                raise PackageError(
                    f"app source entry '{rel}': views/ holds exactly {VIEWS_FILE}"
                )
            if top == "bindings" and name != BINDINGS_FILE:
                raise PackageError(
                    f"app source entry '{rel}': bindings/ holds exactly {BINDINGS_FILE}"
                )
            files.append(rel)

    if len(files) > MAX_FILES:
        raise PackageError(f"app carries {len(files)} files — at most {MAX_FILES}")
    total = 0
    for rel in files:
        size = os.lstat(root / rel).st_size
        if size > MAX_FILE_BYTES:
            raise PackageError(f"{rel} is {size} bytes — a file is at most {MAX_FILE_BYTES}")
        total += size
        if total > MAX_APP_BYTES:
            raise PackageError(f"app is over {MAX_APP_BYTES} bytes of content — split it")
    files.sort()
    return files


def _check_utf8_name(name: str, where: str) -> None:
    try:
        name.encode("utf-8")
    except UnicodeEncodeError as e:
        raise PackageError(f"{where} carries a file name that is not UTF-8") from e


def read_manifest(root: Path) -> Manifest:
    try:
        text = (root / MANIFEST).read_text(encoding="utf-8")
    except OSError as e:
        raise PackageError(f"cannot read {root / MANIFEST}: {e}") from e
    except UnicodeDecodeError as e:
        raise PackageError(f"{MANIFEST}: not UTF-8 text — an A1 app carries text only") from e
    manifest = parse_manifest(text)
    if manifest.view_contract and f"views/{VIEWS_FILE}" not in bundle_files(root):
        raise PackageError(
            f"app.md declares `needs.views` but the bundle carries no "
            f"views/{VIEWS_FILE} — the declaration and the descriptor file "
            "install together or not at all"
        )
    if manifest.binding_contract:
        if f"bindings/{BINDINGS_FILE}" not in bundle_files(root):
            raise PackageError(
                f"app.md declares `needs.bindings` but the bundle carries no "
                f"bindings/{BINDINGS_FILE}"
            )
        if not manifest.view_contract:
            raise PackageError(
                "app.md declares `needs.bindings` but not `needs.views` — a "
                "bindings companion requires the descriptor it maps"
            )
    # The reverse pairing: a descriptor/companion file without its
    # manifest declaration can never install.
    files = bundle_files(root)
    if f"views/{VIEWS_FILE}" in files and not manifest.view_contract:
        raise PackageError(
            f"views/{VIEWS_FILE} is present but app.md never declares "
            "`needs.views.contract` — an undeclared descriptor can never install"
        )
    if f"bindings/{BINDINGS_FILE}" in files and not manifest.binding_contract:
        raise PackageError(
            f"bindings/{BINDINGS_FILE} is present but app.md never declares "
            "`needs.bindings.contract`"
        )
    return manifest


# --- Archive writers ---------------------------------------------------


def _tar_info(name: str, data: bytes, dir_: bool = False) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.mtime = EPOCH
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    if dir_:
        info.type = tarfile.DIRTYPE
        info.mode = 0o755
        info.size = 0
    else:
        info.type = tarfile.REGTYPE
        info.mode = 0o644
        info.size = len(data)
    return info


def _member_names(prefix: str, files: list[str]) -> list[str]:
    """Archive member names: sorted dirs first, then files."""
    dirnames = sorted({f"{top}" for top in TOP_DIRS if any(f.startswith(top + "/") for f in files)})
    members = [f"{prefix}{d}/" for d in dirnames]
    members += [f"{prefix}{rel}" for rel in files]
    return members


def write_tar_gz(dest: Path, prefix: str, contents: list[tuple[str, bytes]]) -> None:
    """Write a deterministic .tar.gz rooted at `prefix`.

    `contents` is the sorted (relpath, bytes) file list. Directory
    entries are explicit so extraction never depends on host tar
    behaviour. Fixed mtime/uid/gid/uname/gname/mode make rebuilds
    byte-identical.
    """
    files = [rel for rel, _ in contents]
    data = dict(contents)
    # gzip.GzipFile(mtime=0, filename="") pins the gzip header too —
    # tarfile's own "w:gz" embeds the wall clock in the header MTIME
    # field, which would make two builds seconds apart differ.
    with dest.open("wb") as fh:
        with gzip.GzipFile(filename="", fileobj=fh, mode="wb", mtime=EPOCH) as gz:
            with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tf:
                for member in _member_names(prefix, files):
                    if member.endswith("/"):
                        tf.addfile(_tar_info(member, b"", dir_=True))
                    else:
                        tf.addfile(
                            _tar_info(member, data[member[len(prefix):]]),
                            io.BytesIO(data[member[len(prefix):]]),
                        )


def write_zip(dest: Path, prefix: str, contents: list[tuple[str, bytes]]) -> None:
    """Write a deterministic .zip rooted at `prefix` (DEFLATED)."""
    files = [rel for rel, _ in contents]
    data = dict(contents)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for member in _member_names(prefix, files):
            info = zipfile.ZipInfo(member, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 0
            if member.endswith("/"):
                info.external_attr = (0o40755 << 16) | 0x10
                zf.writestr(info, b"")
            else:
                info.external_attr = 0o100644 << 16
                zf.writestr(info, data[member[len(prefix):]])


def read_contents(root: Path, files: list[str]) -> list[tuple[str, bytes]]:
    contents = []
    for rel in files:
        path = root / rel
        data = path.read_bytes()
        if len(data) > MAX_FILE_BYTES:
            raise PackageError(f"{rel} is {len(data)} bytes — a file is at most {MAX_FILE_BYTES}")
        contents.append((rel, data))
    return contents


# --- Sidecar -----------------------------------------------------------


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_sidecar(archive: Path) -> Path:
    """Write `<archive>.sha256` — `sha256  filename` — integrity only."""
    digest = sha256_hex(archive.read_bytes())
    sidecar = archive.with_name(archive.name + SIDECAR_SUFFIX)
    sidecar.write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    return sidecar


def read_sidecar(archive: Path) -> str:
    sidecar = archive.with_name(archive.name + SIDECAR_SUFFIX)
    try:
        line = sidecar.read_text(encoding="ascii").strip()
    except OSError as e:
        raise PackageError(f"cannot read {sidecar}: {e}") from e
    parts = line.split()
    if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]) or parts[1] != archive.name:
        raise PackageError(
            f"{sidecar.name}: expected `<64-hex>  {archive.name}` — refusing "
            "a malformed or mismatched sidecar"
        )
    return parts[0]


# --- Safe archive reading (never extractall) ---------------------------


def _archive_members(archive: Path) -> list[tuple[str, bytes]]:
    """Read a release archive into memory with path checks.

    Every member must be a regular file or directory under the single
    bundle root: no absolute paths, no `..`, no links, no duplicate
    names. The archive's own metadata is never trusted as authority —
    names are validated before any byte is used.
    """
    members: list[tuple[str, bytes]] = []
    seen: set[str] = set()
    if archive.name.endswith(".zip"):
        try:
            zf = zipfile.ZipFile(archive)
        except zipfile.BadZipFile as e:
            raise PackageError(f"{archive.name}: not a zip archive — {e}") from e
        with zf:
            for info in zf.infolist():
                _check_member_path(info.filename, archive.name)
                if info.is_dir():
                    continue
                if info.filename in seen:
                    raise PackageError(f"{archive.name}: duplicate member {info.filename}")
                seen.add(info.filename)
                if info.file_size > MAX_FILE_BYTES:
                    raise PackageError(
                        f"{archive.name}: {info.filename} is {info.file_size} bytes — "
                        f"a file is at most {MAX_FILE_BYTES}"
                    )
                members.append((info.filename, zf.read(info)))
        return members

    try:
        tf = tarfile.open(archive, mode="r:*")
    except (tarfile.TarError, OSError) as e:
        raise PackageError(f"{archive.name}: cannot read archive — {e}") from e
    with tf:
        for info in tf:
            _check_member_path(info.name, archive.name)
            if info.isdir():
                continue
            if not info.isreg():
                raise PackageError(
                    f"{archive.name}: member {info.name} is not a regular file "
                    "(links/devices refuse)"
                )
            if info.name in seen:
                raise PackageError(f"{archive.name}: duplicate member {info.name}")
            seen.add(info.name)
            if info.size > MAX_FILE_BYTES:
                raise PackageError(
                    f"{archive.name}: {info.name} is {info.size} bytes — "
                    f"a file is at most {MAX_FILE_BYTES}"
                )
            fh = tf.extractfile(info)
            if fh is None:
                raise PackageError(f"{archive.name}: cannot read member {info.name}")
            members.append((info.name, fh.read()))
    return members


def _check_member_path(name: str, archive_name: str) -> PurePosixPath:
    if not name or "\\" in name:
        raise PackageError(f"{archive_name}: bad member name {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or name.startswith("/"):
        raise PackageError(f"{archive_name}: absolute member path {name!r} refuses")
    if any(part in ("..", "") for part in path.parts):
        raise PackageError(f"{archive_name}: member path {name!r} escapes or is empty")
    return path


def verify_archive(archive: Path) -> dict:
    """Verify a built archive: sidecar digest + member shape + manifest.

    Returns a result dict for the report. Fails on the first problem
    with a genuine nonzero exit.
    """
    expected = read_sidecar(archive)
    actual = sha256_hex(archive.read_bytes())
    if actual != expected:
        raise PackageError(
            f"{archive.name}: SHA256 mismatch — archive {actual[:12]}… vs "
            f"sidecar {expected[:12]}… (integrity check failed)"
        )

    members = _archive_members(archive)
    if not members:
        raise PackageError(f"{archive.name}: archive carries no files")
    # The archive is rooted at a single prefix dir holding the bundle
    # files directly (prefix + relpath). Find that prefix from app.md.
    manifest_members = [n for n, _ in members if PurePosixPath(n).name == MANIFEST]
    if len(manifest_members) != 1:
        raise PackageError(
            f"{archive.name}: expected exactly one {MANIFEST} at the bundle "
            f"root, found {len(manifest_members)}"
        )
    manifest_member = manifest_members[0]
    prefix = manifest_member[: -len(MANIFEST)]
    if not prefix or not prefix.endswith("/") or prefix.count("/") != 1:
        raise PackageError(
            f"{archive.name}: {MANIFEST} must sit at the archive root's "
            "single top directory"
        )
    rels = []
    for name, _data in members:
        if not name.startswith(prefix):
            raise PackageError(
                f"{archive.name}: member {name} is outside the bundle root {prefix}"
            )
        rels.append(name[len(prefix):])
    rels.sort()

    # Re-run the bundle shape checks on the member names: this is the
    # same allowlist bundle_files enforces on a real tree.
    _check_member_tree(rels, archive.name)

    manifest_text = dict(members)[manifest_member].decode("utf-8")
    try:
        manifest = parse_manifest(manifest_text)
    except PackageError as e:
        raise PackageError(f"{archive.name}: {e}") from e
    _check_version_semver(manifest.version)

    # The archive name pins `<app>-<version>` — name/bytes cannot drift.
    base = archive.name
    for suffix in (".tar.gz", ".zip"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    if base != f"{manifest.app}-{manifest.version}":
        raise PackageError(
            f"{archive.name}: archive name is '{base}' but the manifest "
            f"declares app={manifest.app} version={manifest.version}"
        )
    return {
        "archive": archive.name,
        "sha256": actual,
        "files": len(rels),
        "app": manifest.app,
        "version": manifest.version,
        "integrity": "archive sha256 matches sidecar (integrity only — "
        "not a Cadence bundle digest, signature or approval)",
    }


def _check_member_tree(rels: list[str], archive_name: str) -> None:
    """Shape-check archive member rel-paths like bundle_files does."""
    files = []
    dirs = set()
    manifest = False
    for rel in rels:
        if rel == MANIFEST:
            manifest = True
            files.append(rel)
            continue
        parts = PurePosixPath(rel).parts
        if len(parts) != 2:
            raise PackageError(
                f"{archive_name}: member {rel} — v0 app dirs are flat, "
                "no nested folders"
            )
        top, name = parts
        if top not in TOP_DIRS:
            raise PackageError(
                f"{archive_name}: member {rel} — v0 knows app.md, workflows/, "
                "rubrics/, templates/, views/, bindings/; everything else refuses"
            )
        if name.startswith("."):
            raise PackageError(f"{archive_name}: member {rel} is a dotfile")
        dirs.add(top)
        if top == "workflows":
            if not name.endswith(".md"):
                raise PackageError(
                    f"{archive_name}: member {rel} — workflows end in .md"
                )
            _check_tag(name[: -len(".md")], "workflow name")
        if top == "views" and name != VIEWS_FILE:
            raise PackageError(f"{archive_name}: views/ holds exactly {VIEWS_FILE}")
        if top == "bindings" and name != BINDINGS_FILE:
            raise PackageError(f"{archive_name}: bindings/ holds exactly {BINDINGS_FILE}")
        files.append(rel)
    if not manifest:
        raise PackageError(f"{archive_name}: bundle root has no {MANIFEST}")
    if "workflows" not in dirs:
        raise PackageError(f"{archive_name}: bundle has no workflows/")
    if len(files) > MAX_FILES:
        raise PackageError(f"{archive_name}: {len(files)} files — at most {MAX_FILES}")


# --- Commands ------------------------------------------------------------


def default_source() -> Path:
    return Path(__file__).resolve().parent.parent / "app"


def cmd_build(args: argparse.Namespace) -> int:
    source: Path = args.source
    files = bundle_files(source)
    manifest = read_manifest(source)
    _check_version_semver(manifest.version)
    contents = read_contents(source, files)

    archive_name = f"{manifest.app}-{manifest.version}.{args.format}"
    prefix = f"{manifest.app}-{manifest.version}/"
    args.outdir.mkdir(parents=True, exist_ok=True)
    archive = args.outdir / archive_name
    if args.format == "tar.gz":
        write_tar_gz(archive, prefix, contents)
    else:
        write_zip(archive, prefix, contents)
    sidecar = write_sidecar(archive)

    result = {
        "archive": str(archive),
        "sidecar": str(sidecar),
        "sha256": sha256_hex(archive.read_bytes()),
        "files": len(files),
        "app": manifest.app,
        "version": manifest.version,
        "note": "archive sha256 is integrity evidence only — not the "
        "Cadence bundle digest, a signature or an approval",
    }
    print(json.dumps(result, indent=2))
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    result = verify_archive(args.archive)
    print(json.dumps(result, indent=2))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """Offline shape check of the bundle source — not host validation."""
    files = bundle_files(args.source)
    manifest = read_manifest(args.source)
    print(
        json.dumps(
            {
                "source": str(args.source),
                "app": manifest.app,
                "version": manifest.version,
                "files": files,
                "note": "offline shape check only — the host loader's full "
                "validation (workflow check, secret guard, slot "
                "cross-checks) did not run",
            },
            indent=2,
        )
    )
    return 0


def cmd_extract_for_test(archive: Path, dest: Path) -> None:
    """Extract via member-by-member copy with path checks (tests only).

    Deliberately NOT tarfile.extractall: member names were already
    path-checked by _archive_members; this writes only regular files
    under dest/<prefix>/.
    """
    members = _archive_members(archive)
    for name, data in members:
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="package_app.py",
        description="Deterministic packaging/verification for the app/ bundle "
        "(Python stdlib only; does not select an app runtime).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_build = sub.add_parser("build", help="build the versioned archive + .sha256 sidecar")
    p_build.add_argument("--source", type=Path, default=None,
                         help="bundle root (default: ../app beside this script)")
    p_build.add_argument("--outdir", type=Path, default=None,
                         help="output dir (default: ../dist beside this script)")
    p_build.add_argument("--format", choices=ALLOWED_FORMATS, default="tar.gz")
    p_build.set_defaults(fn=cmd_build)

    p_verify = sub.add_parser("verify", help="verify an archive against its sidecar and the bundle shape")
    p_verify.add_argument("archive", type=Path)
    p_verify.set_defaults(fn=cmd_verify)

    p_check = sub.add_parser("check", help="offline bundle shape check (not host validation)")
    p_check.add_argument("--source", type=Path, default=None)
    p_check.set_defaults(fn=cmd_check)

    args = parser.parse_args(argv)
    if getattr(args, "source", None) is None and args.cmd in ("build", "check"):
        args.source = default_source()
    if getattr(args, "outdir", None) is None and args.cmd == "build":
        args.outdir = Path(__file__).resolve().parent.parent / "dist"
    try:
        return args.fn(args)
    except PackageError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
