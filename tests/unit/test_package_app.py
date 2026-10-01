"""Tests for scripts/package_app.py (CAD-962).

Run: python3 -m unittest discover -s tests/unit -v

Covers the rejection guards first (symlinks, path escapes, malformed
manifests, unknown/gated keys), then manifest metadata, exclusions,
byte-identical repeated builds and the changed-content digest. The
tests here exercise the offline packaging checks only — they are not
host validation.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "package_app.py"

spec = importlib.util.spec_from_file_location("package_app", SCRIPT)
pkg = importlib.util.module_from_spec(spec)
sys.modules["package_app"] = pkg  # dataclass resolution needs the module registered
spec.loader.exec_module(pkg)

APP_MD = """---
app: crm
title: CRM
version: '0.1.0'
summary: Test bundle.
needs:
  connections: []
---

# Guide

Body text.
"""


def make_bundle(root: Path, manifest: str = APP_MD, extra: dict[str, str] | None = None) -> Path:
    """Create a minimal valid bundle tree at root."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "app.md").write_text(manifest, encoding="utf-8")
    (root / "workflows").mkdir(exist_ok=True)
    (root / "workflows" / "w1.md").write_text("---\ntitle: t\n---\n\nbody\n", encoding="utf-8")
    (root / "rubrics").mkdir(exist_ok=True)
    (root / "rubrics" / "r1.md").write_text("rubric\n", encoding="utf-8")
    for rel, text in (extra or {}).items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return root


class RejectionGuardTests(unittest.TestCase):
    """Hostile inputs must refuse with a genuine nonzero exit."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def test_symlinked_bundle_root_refuses(self):
        real = make_bundle(self.dir / "real")
        link = self.dir / "link"
        link.symlink_to(real, target_is_directory=True)
        with self.assertRaises(pkg.PackageError):
            pkg.bundle_files(link)

    def test_symlinked_member_file_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "workflows" / "evil.md").symlink_to("/etc/hostname")
        with self.assertRaises(pkg.PackageError):
            pkg.bundle_files(bundle)

    def test_symlinked_top_dir_refuses(self):
        bundle = make_bundle(self.dir / "b")
        outside = self.dir / "outside"
        outside.mkdir()
        (outside / "x.md").write_text("x", encoding="utf-8")
        (bundle / "templates").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(pkg.PackageError):
            pkg.bundle_files(bundle)

    def test_missing_app_md_refuses(self):
        bundle = self.dir / "b"
        bundle.mkdir()
        (bundle / "workflows").mkdir()
        (bundle / "workflows" / "w.md").write_text("x", encoding="utf-8")
        with self.assertRaisesRegex(pkg.PackageError, "no app.md"):
            pkg.bundle_files(bundle)

    def test_missing_workflows_refuses(self):
        bundle = self.dir / "b"
        bundle.mkdir()
        (bundle / "app.md").write_text(APP_MD, encoding="utf-8")
        with self.assertRaisesRegex(pkg.PackageError, "workflows"):
            pkg.bundle_files(bundle)

    def test_dotfile_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / ".env").write_text("SECRET=x", encoding="utf-8")
        with self.assertRaisesRegex(pkg.PackageError, "dotfiles"):
            pkg.bundle_files(bundle)

    def test_nested_dotfile_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "workflows" / ".hidden.md").write_text("x", encoding="utf-8")
        with self.assertRaisesRegex(pkg.PackageError, "dotfiles"):
            pkg.bundle_files(bundle)

    def test_unknown_top_level_entry_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "extras.txt").write_text("x", encoding="utf-8")
        with self.assertRaisesRegex(pkg.PackageError, "everything else refuses"):
            pkg.bundle_files(bundle)

    def test_unknown_top_level_dir_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "src").mkdir()
        with self.assertRaisesRegex(pkg.PackageError, "everything else refuses"):
            pkg.bundle_files(bundle)

    def test_nested_dir_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "workflows" / "nested").mkdir()
        with self.assertRaisesRegex(pkg.PackageError, "flat"):
            pkg.bundle_files(bundle)

    def test_non_md_workflow_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "workflows" / "w2.txt").write_text("x", encoding="utf-8")
        with self.assertRaisesRegex(pkg.PackageError, ".md"):
            pkg.bundle_files(bundle)

    def test_bad_workflow_name_refuses(self):
        bundle = make_bundle(self.dir / "b")
        (bundle / "workflows" / "Bad Name.md").write_text("x", encoding="utf-8")
        with self.assertRaises(pkg.PackageError):
            pkg.bundle_files(bundle)

    def test_fifo_refuses(self):
        bundle = make_bundle(self.dir / "b")
        os.mkfifo(bundle / "workflows" / "pipe.md")
        with self.assertRaises(pkg.PackageError):
            pkg.bundle_files(bundle)

    def test_manifest_no_frontmatter_refuses(self):
        with self.assertRaises(pkg.PackageError):
            pkg.parse_manifest("no frontmatter\n")

    def test_manifest_missing_field_refuses(self):
        bad = APP_MD.replace("version: '0.1.0'\n", "")
        with self.assertRaisesRegex(pkg.PackageError, "version"):
            pkg.parse_manifest(bad)

    def test_manifest_unknown_key_refuses(self):
        bad = APP_MD.replace("summary:", "runtime:")
        with self.assertRaisesRegex(pkg.PackageError, "unknown"):
            pkg.parse_manifest(bad)

    def test_manifest_gated_key_refuses(self):
        bad = APP_MD.replace("summary:", "actions:")
        with self.assertRaisesRegex(pkg.PackageError, "later stage"):
            pkg.parse_manifest(bad)

    def test_manifest_bad_app_name_refuses(self):
        bad = APP_MD.replace("app: crm", "app: CRM App")
        with self.assertRaises(pkg.PackageError):
            pkg.parse_manifest(bad)

    def test_manifest_duplicate_connection_refuses(self):
        bad = APP_MD.replace("connections: []", "connections: [a, a]")
        with self.assertRaisesRegex(pkg.PackageError, "twice"):
            pkg.parse_manifest(bad)

    # --- R3: deliberate divergence guards (subset of serde_yaml) ---

    def test_manifest_null_needs_refuses(self):
        # `needs:` with a null scalar is a mapping error on the host.
        bad = APP_MD.replace("  connections: []", "")  # leaves bare `needs:`
        with self.assertRaisesRegex(pkg.PackageError, "needs"):
            pkg.parse_manifest(bad)

    def test_manifest_nonstring_app_refuses(self):
        bad = APP_MD.replace("app: crm", "app: 123")
        with self.assertRaisesRegex(pkg.PackageError, "string|app name"):
            pkg.parse_manifest(bad)

    def test_manifest_bool_title_refuses(self):
        bad = APP_MD.replace("title: CRM", "title: true")
        with self.assertRaisesRegex(pkg.PackageError, "string"):
            pkg.parse_manifest(bad)

    def test_manifest_duplicate_top_key_refuses(self):
        bad = APP_MD.replace("title: CRM", "title: CRM\ntitle: Dup")
        with self.assertRaisesRegex(pkg.PackageError, "twice"):
            pkg.parse_manifest(bad)

    def test_manifest_duplicate_needs_key_refuses(self):
        bad = APP_MD.replace(
            "  connections: []", "  connections: []\n  connections: [x]"
        )
        with self.assertRaisesRegex(pkg.PackageError, "twice"):
            pkg.parse_manifest(bad)

    def test_manifest_tab_indent_refuses(self):
        bad = APP_MD.replace("  connections: []", "\tconnections: []")
        with self.assertRaisesRegex(pkg.PackageError, "tab"):
            pkg.parse_manifest(bad)

    def test_manifest_null_capabilities_refuses(self):
        bad = APP_MD.replace("  connections: []", "  connections: []\n  capabilities:")
        with self.assertRaisesRegex(pkg.PackageError, "capabilities"):
            pkg.parse_manifest(bad)

    def test_manifest_unknown_needs_key_refuses(self):
        bad = APP_MD.replace("  connections: []", "  connections: []\n  migrations: []")
        with self.assertRaisesRegex(pkg.PackageError, "needs.migrations"):
            pkg.parse_manifest(bad)

    def test_manifest_bad_version_shape_refuses_build(self):
        bundle = make_bundle(
            self.dir / "b", APP_MD.replace("version: '0.1.0'", "version: v1")
        )
        with self.assertRaisesRegex(pkg.PackageError, "version"):
            pkg._check_version_semver(pkg.read_manifest(bundle).version)

    def test_archive_member_path_escape_refuses(self):
        for bad in ("../evil", "x/../../evil", "/abs/path", ".."):
            with self.assertRaises(pkg.PackageError, msg=bad):
                pkg._check_member_path(bad, "a.tar.gz")

    def test_archive_link_member_refuses(self):
        archive = self.dir / "evil.tar.gz"
        import io

        with tarfile.open(archive, "w:gz") as tf:
            info = tarfile.TarInfo("crm-0.1.0/app.md")
            data = APP_MD.encode()
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
            link = tarfile.TarInfo("crm-0.1.0/link")
            link.type = tarfile.SYMTYPE
            link.linkname = "/etc/passwd"
            tf.addfile(link)
        with self.assertRaisesRegex(pkg.PackageError, "not a regular file"):
            pkg._archive_members(archive)

    def test_malformed_sidecar_refuses(self):
        archive = self.dir / "crm-0.1.0.tar.gz"
        archive.write_bytes(b"x")
        (self.dir / "crm-0.1.0.tar.gz.sha256").write_text("not-a-digest\n", encoding="ascii")
        with self.assertRaisesRegex(pkg.PackageError, "malformed|expected"):
            pkg.read_sidecar(archive)

    def test_tampered_archive_refuses_verify(self):
        bundle = make_bundle(self.dir / "b")
        out = self.dir / "out"
        out.mkdir()
        rc = pkg.main(["build", "--source", str(bundle), "--outdir", str(out)])
        self.assertEqual(rc, 0)
        archive = out / "crm-0.1.0.tar.gz"
        archive.write_bytes(archive.read_bytes()[:-10] + b"tampered!!")
        with self.assertRaisesRegex(pkg.PackageError, "SHA256 mismatch"):
            pkg.verify_archive(archive)


class ManifestMetadataTests(unittest.TestCase):
    def test_real_app_md_parses_declared_fields(self):
        manifest = pkg.parse_manifest((REPO / "app" / "app.md").read_text(encoding="utf-8"))
        self.assertEqual(manifest.app, "crm")
        self.assertEqual(manifest.version, "0.1.0")
        self.assertEqual(manifest.title, "CRM")
        self.assertEqual(manifest.connections, ())
        self.assertIsNone(manifest.view_contract)
        self.assertIsNone(manifest.binding_contract)
        self.assertIsNotNone(manifest.summary)

    def test_version_semver_guard(self):
        pkg._check_version_semver("0.1.0")
        pkg._check_version_semver("10.20.30")
        for bad in ("0.1", "1", "v1.0.0", "1.0.0.0", "", "1.0.x"):
            with self.assertRaises(pkg.PackageError, msg=bad):
                pkg._check_version_semver(bad)

    def test_views_declaration_pairs_with_file(self):
        declared = APP_MD.replace(
            "  connections: []", "  connections: []\n  views:\n    contract: app-views/v1"
        )
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        bundle = make_bundle(tmp / "b", declared)
        # Declared but missing views/app-views-v1.json refuses.
        with self.assertRaisesRegex(pkg.PackageError, "needs.views"):
            pkg.read_manifest(bundle)
        # Adding the file makes the pair consistent.
        (bundle / "views").mkdir()
        (bundle / "views" / "app-views-v1.json").write_text("{}", encoding="utf-8")
        self.assertEqual(pkg.read_manifest(bundle).view_contract, "app-views/v1")


class BuildAndExclusionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.out = self.dir / "out"
        self.out.mkdir()

    def test_repeated_build_is_byte_identical(self):
        bundle = make_bundle(self.dir / "b")
        rc = pkg.main(["build", "--source", str(bundle), "--outdir", str(self.out)])
        self.assertEqual(rc, 0)
        first = (self.out / "crm-0.1.0.tar.gz").read_bytes()
        rc = pkg.main(["build", "--source", str(bundle), "--outdir", str(self.out)])
        self.assertEqual(rc, 0)
        second = (self.out / "crm-0.1.0.tar.gz").read_bytes()
        self.assertEqual(first, second, "repeated builds must be byte-identical")

    def test_repeated_build_from_same_bytes_identical(self):
        # Same bundle content in a *different* directory must give the
        # same archive — paths must not leak into the bytes.
        b1 = make_bundle(self.dir / "a" / "b")
        b2 = make_bundle(self.dir / "c" / "b")
        out1, out2 = self.dir / "o1", self.dir / "o2"
        out1.mkdir(); out2.mkdir()
        self.assertEqual(pkg.main(["build", "--source", str(b1), "--outdir", str(out1)]), 0)
        self.assertEqual(pkg.main(["build", "--source", str(b2), "--outdir", str(out2)]), 0)
        self.assertEqual(
            (out1 / "crm-0.1.0.tar.gz").read_bytes(),
            (out2 / "crm-0.1.0.tar.gz").read_bytes(),
        )

    def test_zip_build_is_byte_identical_and_verifies(self):
        bundle = make_bundle(self.dir / "b")
        self.assertEqual(
            pkg.main(
                ["build", "--source", str(bundle), "--outdir", str(self.out), "--format", "zip"]
            ),
            0,
        )
        archive = self.out / "crm-0.1.0.zip"
        first = archive.read_bytes()
        self.assertEqual(
            pkg.main(
                ["build", "--source", str(bundle), "--outdir", str(self.out), "--format", "zip"]
            ),
            0,
        )
        self.assertEqual(first, archive.read_bytes())
        result = pkg.verify_archive(archive)
        self.assertEqual(result["app"], "crm")
        self.assertEqual(result["version"], "0.1.0")
        with zipfile.ZipFile(archive) as zf:
            names = set(zf.namelist())
        self.assertIn("crm-0.1.0/app.md", names)
        self.assertIn("crm-0.1.0/workflows/w1.md", names)

    def test_tar_gz_header_mtime_is_zero(self):
        # tarfile "w:gz" embeds the wall clock in the gzip header MTIME
        # field — that alone breaks byte-identity across seconds.
        bundle = make_bundle(self.dir / "b")
        self.assertEqual(pkg.main(["build", "--source", str(bundle), "--outdir", str(self.out)]), 0)
        data = (self.out / "crm-0.1.0.tar.gz").read_bytes()
        self.assertEqual(data[:2], b"\x1f\x8b")
        self.assertEqual(int.from_bytes(data[4:8], "little"), 0, "gzip header MTIME must be 0")

    def test_changed_content_changes_digest(self):
        bundle = make_bundle(self.dir / "b")
        self.assertEqual(pkg.main(["build", "--source", str(bundle), "--outdir", str(self.out)]), 0)
        archive = self.out / "crm-0.1.0.tar.gz"
        first = archive.read_bytes()
        (bundle / "workflows" / "w1.md").write_text(
            "---\ntitle: t\n---\n\nCHANGED body\n", encoding="utf-8"
        )
        self.assertEqual(pkg.main(["build", "--source", str(bundle), "--outdir", str(self.out)]), 0)
        self.assertNotEqual(first, archive.read_bytes())

    def test_extract_shows_only_bundle_paths_identical_content(self):
        bundle = make_bundle(
            self.dir / "b",
            extra={"templates/note.md": "t\n"},
        )
        self.assertEqual(pkg.main(["build", "--source", str(bundle), "--outdir", str(self.out)]), 0)
        archive = self.out / "crm-0.1.0.tar.gz"
        dest = self.dir / "extract"
        dest.mkdir()
        pkg.cmd_extract_for_test(archive, dest)
        root = dest / "crm-0.1.0"
        extracted = sorted(
            str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()
        )
        self.assertEqual(extracted, sorted(str(p.relative_to(bundle)) for p in bundle.rglob("*") if p.is_file()))
        for rel in extracted:
            self.assertEqual((root / rel).read_bytes(), (bundle / rel).read_bytes())

    def test_repo_exclusions_not_in_archive(self):
        # Package the real repo app/: the archive must carry only
        # bundle paths — no scripts/, src/, tests/, docs/, .git, .env.
        self.assertEqual(pkg.main(["build", "--source", str(REPO / "app"), "--outdir", str(self.out)]), 0)
        archive = self.out / "crm-0.1.0.tar.gz"
        names = [n for n, _ in pkg._archive_members(archive)[0]]
        for name in names:
            rel = name.split("/", 1)[1]
            top = rel.split("/", 1)[0]
            self.assertIn(top, {"app.md", "workflows", "rubrics", "templates", "views", "bindings"})
            self.assertFalse(any(p.startswith(".") for p in rel.split("/")))
        self.assertIn("crm-0.1.0/app.md", names)
        self.assertIn("crm-0.1.0/workflows/email-brief.md", names)
        self.assertIn("crm-0.1.0/rubrics/email.md", names)

    def test_verify_real_archive(self):
        self.assertEqual(pkg.main(["build", "--source", str(REPO / "app"), "--outdir", str(self.out)]), 0)
        result = pkg.verify_archive(self.out / "crm-0.1.0.tar.gz")
        self.assertEqual(result["app"], "crm")
        self.assertEqual(result["version"], "0.1.0")
        self.assertEqual(result["files"], 3)


class VerifyParityTests(unittest.TestCase):
    """R2 regression: verify_archive must refuse what the source shape
    check and host loader refuse. Mirrors the PM probes at
    /tmp/crm-plugin-pm-0930/cad962/pm-review/probe_archive_verify.py."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        # Build a good archive from the real bundle as the base bytes.
        self.out = self.dir / "good"
        self.out.mkdir()
        self.assertEqual(
            pkg.main(["build", "--source", str(REPO / "app"), "--outdir", str(self.out)]), 0
        )
        self.original = {
            str(p.relative_to(REPO / "app")): p.read_bytes()
            for p in (REPO / "app").rglob("*")
            if p.is_file()
        }

    def _tar_with(self, label, mutate):
        d = self.dir / label
        d.mkdir()
        archive = d / "crm-0.1.0.tar.gz"
        import io as _io
        contents = dict(self.original)
        mutate(contents)
        with tarfile.open(archive, "w:gz") as tf:
            for rel, data in contents.items():
                info = tarfile.TarInfo("crm-0.1.0/" + rel)
                info.size = len(data)
                tf.addfile(info, _io.BytesIO(data))
        pkg.write_sidecar(archive)
        return archive

    def test_verify_refuses_non_utf8_file(self):
        archive = self._tar_with("nonutf8", lambda c: c.__setitem__("rubrics/bad.md", bytes([255])))
        with self.assertRaisesRegex(pkg.PackageError, "UTF-8"):
            pkg.verify_archive(archive)

    def test_verify_refuses_aggregate_over_2mib(self):
        def add(c):
            for i in range(9):
                c[f"rubrics/large-{i}.md"] = b"x" * (250 * 1024)
        archive = self._tar_with("agg", add)
        with self.assertRaisesRegex(pkg.PackageError, "over"):
            pkg.verify_archive(archive)

    def test_verify_refuses_declared_view_without_descriptor(self):
        def add(c):
            c["app.md"] = c["app.md"].replace(
                b"  connections: []", b"  connections: []\n  views:\n    contract: app-views/v1"
            )
        archive = self._tar_with("missing-view", add)
        with self.assertRaisesRegex(pkg.PackageError, "needs.views"):
            pkg.verify_archive(archive)

    def test_verify_refuses_undeclared_descriptor_file(self):
        archive = self._tar_with(
            "undeclared", lambda c: c.__setitem__("views/app-views-v1.json", b"{}")
        )
        with self.assertRaisesRegex(pkg.PackageError, "needs.views.contract"):
            pkg.verify_archive(archive)

    def test_verify_refuses_zip_symlink_member(self):
        archive = self.dir / "ziplink" / "crm-0.1.0.zip"
        archive.parent.mkdir()
        with zipfile.ZipFile(archive, "w") as zf:
            for rel, data in self.original.items():
                zf.writestr("crm-0.1.0/" + rel, data)
            info = zipfile.ZipInfo("crm-0.1.0/rubrics/link.md")
            info.create_system = 3
            info.external_attr = 0o120777 << 16  # unix symlink mode
            zf.writestr(info, "/outside")
        pkg.write_sidecar(archive)
        with self.assertRaisesRegex(pkg.PackageError, "not a regular file"):
            pkg.verify_archive(archive)

    def test_verify_refuses_dir_outside_prefix(self):
        archive = self.dir / "dirout" / "crm-0.1.0.tar.gz"
        archive.parent.mkdir()
        import io as _io
        with tarfile.open(archive, "w:gz") as tf:
            for rel, data in self.original.items():
                info = tarfile.TarInfo("crm-0.1.0/" + rel)
                info.size = len(data)
                tf.addfile(info, _io.BytesIO(data))
            extra = tarfile.TarInfo("sneaky/")
            extra.type = tarfile.DIRTYPE
            tf.addfile(extra)
        pkg.write_sidecar(archive)
        with self.assertRaisesRegex(pkg.PackageError, "outside"):
            pkg.verify_archive(archive)

    # --- R3: non-canonical path aliases refuse; extract can't overwrite ---

    def _tar_with_extra_member(self, label, member_name, payload=b"EVIL\n"):
        archive = self.dir / label / "crm-0.1.0.tar.gz"
        archive.parent.mkdir()
        import io as _io
        with tarfile.open(archive, "w:gz") as tf:
            for rel, data in self.original.items():
                info = tarfile.TarInfo("crm-0.1.0/" + rel)
                info.size = len(data)
                tf.addfile(info, _io.BytesIO(data))
            info = tarfile.TarInfo(member_name)
            info.size = len(payload)
            tf.addfile(info, _io.BytesIO(payload))
        pkg.write_sidecar(archive)
        return archive

    def test_verify_refuses_dot_component_alias(self):
        # `crm-0.1.0/./workflows/email-brief.md` collapses to a path that
        # already exists — verify must refuse, else extract overwrites.
        archive = self._tar_with_extra_member(
            "dotalias", "crm-0.1.0/./workflows/email-brief.md"
        )
        with self.assertRaisesRegex(pkg.PackageError, "canonical|alias"):
            pkg.verify_archive(archive)

    def test_verify_refuses_mid_dot_component(self):
        archive = self._tar_with_extra_member(
            "middot", "crm-0.1.0/workflows/./email-brief.md"
        )
        with self.assertRaisesRegex(pkg.PackageError, "canonical|alias"):
            pkg.verify_archive(archive)

    def test_verify_refuses_double_slash_alias(self):
        archive = self._tar_with_extra_member(
            "dslash", "crm-0.1.0//workflows/email-brief.md"
        )
        with self.assertRaisesRegex(pkg.PackageError, "canonical|alias"):
            pkg.verify_archive(archive)

    def test_verify_refuses_dotdot_alias(self):
        archive = self._tar_with_extra_member(
            "ddot", "crm-0.1.0/rubrics/../workflows/email-brief.md"
        )
        with self.assertRaises(pkg.PackageError):
            pkg.verify_archive(archive)

    def test_legit_dir_trailing_slash_still_passes(self):
        # The real built archive carries explicit dir entries with a
        # trailing slash — canonicalization must not reject it.
        result = pkg.verify_archive(self.out / "crm-0.1.0.tar.gz")
        self.assertEqual(result["files"], 3)


class CleanRefusalTests(unittest.TestCase):
    """R3: malformed inputs must surface as clean exit-1 refusals,
    never a traceback."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def _good_archive(self):
        out = self.dir / "ok"
        out.mkdir()
        self.assertEqual(
            pkg.main(["build", "--source", str(REPO / "app"), "--outdir", str(out)]), 0
        )
        return out / "crm-0.1.0.tar.gz"

    def test_non_ascii_sidecar_is_clean_refusal(self):
        archive = self._good_archive()
        archive.with_name(archive.name + ".sha256").write_bytes("é".encode())
        # Library path raises PackageError (not UnicodeDecodeError).
        with self.assertRaises(pkg.PackageError):
            pkg.verify_archive(archive)
        # CLI exits 1 with a short error line, no traceback.
        p = subprocess.run(
            [sys.executable, str(SCRIPT), "verify", str(archive)],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(p.returncode, 1)
        self.assertNotIn("Traceback", p.stderr)
        self.assertIn("error:", p.stderr)

    def test_corrupt_zip_local_header_is_clean_refusal(self):
        out = self.dir / "z"
        out.mkdir()
        self.assertEqual(
            pkg.main(
                ["build", "--source", str(REPO / "app"), "--outdir", str(out), "--format", "zip"]
            ),
            0,
        )
        archive = out / "crm-0.1.0.zip"
        raw = bytearray(archive.read_bytes())
        idx = raw.find(b"crm-0.1.0/app.md")
        self.assertGreater(idx, 0)
        raw[idx] ^= 0xFF  # corrupt a filename byte in a local header
        archive.write_bytes(raw)
        pkg.write_sidecar(archive)
        with self.assertRaises(pkg.PackageError):
            pkg.verify_archive(archive)
        p = subprocess.run(
            [sys.executable, str(SCRIPT), "verify", str(archive)],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(p.returncode, 1)
        self.assertNotIn("Traceback", p.stderr)

    def test_garbage_tar_is_clean_refusal(self):
        archive = self.dir / "crm-0.1.0.tar.gz"
        archive.write_bytes(os.urandom(64))
        pkg.write_sidecar(archive)
        p = subprocess.run(
            [sys.executable, str(SCRIPT), "verify", str(archive)],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(p.returncode, 1)
        self.assertNotIn("Traceback", p.stderr)
        self.assertIn("error:", p.stderr)


class CliTests(unittest.TestCase):
    """The script must fail cleanly — real nonzero exit codes."""

    def run_cli(self, *argv: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *argv],
            capture_output=True,
            text=True,
            timeout=60,
        )

    def test_build_check_verify_real_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            build = self.run_cli("build", "--source", str(REPO / "app"), "--outdir", tmp)
            self.assertEqual(build.returncode, 0, build.stderr)
            result = json.loads(build.stdout)
            self.assertTrue(Path(result["archive"]).exists())
            self.assertTrue(Path(result["sidecar"]).exists())
            verify = self.run_cli("verify", result["archive"])
            self.assertEqual(verify.returncode, 0, verify.stderr)
            check = self.run_cli("check", "--source", str(REPO / "app"))
            self.assertEqual(check.returncode, 0, check.stderr)

    def test_missing_source_fails_nonzero(self):
        result = self.run_cli("check", "--source", "/nonexistent/path")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("error:", result.stderr)

    def test_bad_archive_fails_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "crm-0.1.0.tar.gz"
            archive.write_bytes(b"garbage")
            result = self.run_cli("verify", str(archive))
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
