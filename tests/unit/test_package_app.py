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
        names = [n for n, _ in pkg._archive_members(archive)]
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
