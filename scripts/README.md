# scripts

Release tooling for the `app/` bundle (CAD-962):

- `package_app.py` — deterministic packager/verifier (Python 3.10+
  stdlib only; this does not select an app execution runtime).
  `check` runs the offline bundle-shape mirror of the host loader's
  file/frontmatter rules; `build` writes a versioned
  `dist/<app>-<version>.tar.gz` (or `.zip`) plus a `.sha256`
  integrity sidecar; `verify` checks the digest and member shape.
  Repeated builds of identical inputs are byte-identical.

The sidecar SHA256 is transport-integrity evidence only — never the
Cadence host bundle digest, a signature or an approval. Install is via
the extracted bundle root (`cadence app install <bundle-dir>`); see
`docs/packaging.md`. No release/publication pipeline exists yet, and
the app execution toolchain remains unchosen pending the CAD-811
boundary plan.
