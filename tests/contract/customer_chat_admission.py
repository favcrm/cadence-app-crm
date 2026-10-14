#!/usr/bin/env python3
"""Independent CRM-2 admission refusal check; no daemon or production state.

Run with the qualified host executable and extracted B package. The ticket
requires exact reserved filenames, ordinary-file confinement and no consent
fields. Packaging integrity is not approval; this check is not lifecycle QA.
"""
import argparse
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("crm_packager", repo / "scripts/package_app.py")
    package = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = package
    spec.loader.exec_module(package)

    def host_check(bundle, expected, reason=None):
        result = subprocess.run(
            [str(args.host.resolve()), "app", "check", str(bundle), "--json"],
            text=True, capture_output=True, timeout=30,
        )
        assert result.returncode == expected, (result.returncode, result.stdout, result.stderr)
        report = json.loads(result.stdout)
        assert report["ok"] is (expected == 0), report
        if reason == "inventory":
            assert report["refusal"]["code"] == "app_check_inventory", report
        elif reason:
            assert reason in (result.stdout + result.stderr).lower(), result.stdout

    # Positive controls: real versioned package bytes and the real host validator.
    verified = package.verify_archive(args.archive.resolve())
    assert verified["app"] == "crm" and verified["version"] == "0.1.2"
    assert verified["files"] == 10
    package.bundle_files(args.bundle.resolve())
    host_check(args.bundle.resolve(), 0)

    def package_refuses(bundle, reason):
        try:
            package.bundle_files(bundle)
        except package.PackageError as error:
            assert reason in str(error).lower(), str(error)
        else:
            raise AssertionError(f"packager admitted {reason}")

    with tempfile.TemporaryDirectory(prefix="crm2-refusal-") as temp:
        root = Path(temp)
        def owned_copy(name):
            bundle = root / name
            shutil.copytree(args.bundle, bundle)
            bundle.chmod(0o700)
            for directory in bundle.rglob("*"):
                if not directory.is_symlink() and directory.is_dir():
                    directory.chmod(0o700)
            return bundle

        unknown = owned_copy("unknown")
        (unknown / "app-actions.evil.json").write_text("{}\n")
        package_refuses(unknown, "app-actions.evil.json")
        host_check(unknown, 3, "inventory")

        linked = owned_copy("linked")
        (root / "outside.json").write_bytes((linked / "app-actions.json").read_bytes())
        (linked / "app-actions.json").unlink()
        (linked / "app-actions.json").symlink_to(root / "outside.json")
        package_refuses(linked, "symlink")
        host_check(linked, 3, "inventory")

        # Valid archive integrity must not make an unsupported member admissible.
        bad_archive = root / "crm-0.1.2.tar.gz"
        with tarfile.open(args.archive, "r:gz") as source, tarfile.open(bad_archive, "w:gz") as target:
            for member in source.getmembers():
                target.addfile(member, source.extractfile(member) if member.isfile() else None)
            extra = tarfile.TarInfo("crm-0.1.2/app-actions.evil.json")
            extra.size = 3
            target.addfile(extra, io.BytesIO(b"{}\n"))
        package.write_sidecar(bad_archive)
        try:
            package.verify_archive(bad_archive)
        except package.PackageError as error:
            assert "app-actions.evil.json" in str(error), str(error)
        else:
            raise AssertionError("archive verifier admitted unsupported root member")

        forged = owned_copy("forged")
        declaration = json.loads((forged / "app-actions.json").read_text())
        declaration["actions"][0]["input"]["fields"].append(
            {"id": "consent", "label": "Consent", "type": "text"}
        )
        (forged / "app-actions.json").chmod(0o600)
        (forged / "app-actions.json").write_text(json.dumps(declaration))
        host_check(forged, 3, "field")

        # CRM-3: extending the exact allowlist must not admit malformed chat.
        malformed = owned_copy("malformed-chat")
        (malformed / "app-chat.json").chmod(0o600)
        (malformed / "app-chat.json").write_text('{"contract": "app-chat/v1", broken-json')
        try:
            package.read_contents(malformed, package.bundle_files(malformed))
        except package.PackageError as error:
            assert "not valid json" in str(error).lower(), str(error)
        else:
            raise AssertionError("packager admitted malformed app-chat descriptor")
        host_check(malformed, 3, "json")
    print("PASS: real package admission; unknown root, descriptor symlink, archive member, consent declaration and malformed chat refused")


if __name__ == "__main__":
    main()
