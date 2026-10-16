"""Independent CRM-1 acceptance: the real CI gate refuses a development SDK."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ScreenSdkProvenanceAcceptance(unittest.TestCase):
    def test_development_sdk_refused_before_extraction_or_toolchain(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        step = workflow.split(
            "- name: Verify committed SDK archive and extract closed package\n"
        )
        self.assertEqual(len(step), 2, "must exercise the unique real CI SDK gate")
        script = re.search(r"python3 - <<'PY'\n(.*?)\n          PY\n", step[1], re.S)
        self.assertIsNotNone(script, "real CI SDK gate must remain inspectable")
        code = textwrap.dedent(script.group(1))
        pin = json.loads((ROOT / "screen-ui.lock.json").read_text())
        pin["source"] = {"kind": "working-tree", "sourceSha": None}
        with tempfile.TemporaryDirectory(prefix="crm-sdk-refusal-") as directory:
            stage = Path(directory)
            (stage / "screen-ui.lock.json").write_text(json.dumps(pin))
            output = stage / "github-output"
            result = subprocess.run(
                [sys.executable, "-"],
                input=code,
                text=True,
                capture_output=True,
                cwd=stage,
                env={**os.environ, "GITHUB_OUTPUT": str(output)},
                timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "Release requires committed SDK provenance; development/null refused",
                result.stderr,
            )
            self.assertFalse((stage / ".cadence-ui").exists())
            self.assertFalse(output.exists(), "refused SDK must not emit toolchain inputs")


if __name__ == "__main__":
    unittest.main()
