# Cadence CRM App

Public repository: https://github.com/favcrm/cadence-app-crm. Local checkout: `/home/ubuntu/Project/cadence-app-crm`.
App identity stays `crm`; the repository name does not change installation or data identities.

## Status

This is a draft extraction scaffold for CAD-811, not an independently functional CRM release.
`app/` is a copy of the existing metadata/email-brief bundle from Cadence source
`a692ba9080d453bd22b864f5fb5af7d13c67286e`. It does not contain the host-compiled CRM screens,
customer/segment/campaign implementation, or sending logic. The original source remains in place.
The remote repository holds the extraction scaffold. No release, production CRM installation or migration has been performed.

CAD-962 added deterministic packaging for the unchanged `app/` bundle
(`scripts/package_app.py`: check/build/verify, byte-identical rebuilds,
SHA256 sidecar that is integrity evidence only — never the Cadence bundle
digest or an approval), its unit tests, an install-path note
(`docs/packaging.md`) and a read-only CI definition
(`.github/workflows/package.yml`, hosted execution pending).
Still pending: the action/domain/migration contract, descriptor/binding
validation against pinned host contracts, and the two-version
install/update/isolation/rollback rehearsal.

The current manifest version `0.1.0` is preserved from that metadata bundle; it does not certify
full-plugin compatibility or delivery. No app runtime/language/SDK is selected by this scaffold.

## Repository convention

```text
cadence-app-crm/
  app/                     # installable bundle root (current metadata only)
    app.md                 # actual Cadence manifest format
    workflows/
    rubrics/
    views/                 # planned app-views/v1 descriptors
    bindings/              # planned app-bindings/v1 companions
  src/
    domain/                # app-specific definitions/logic: contract work pending
    actions/               # typed app operations: execution contract pending
    migrations/            # installation data migrations: contract pending
  tests/
    unit/
    contract/              # compatibility with pinned Cadence host contracts
    e2e/                   # install/update/isolation/rollback rehearsal
  scripts/                 # package_app.py: check/build/verify the bundle (done); release pipeline pending
  docs/
  .github/workflows/       # package.yml: read-only packaging CI (defined; hosted validation pending); release pending
  dist/                    # generated artifacts, ignored by Git
```

Only directories with current content are committed. `app/views/`, `app/bindings/` and `dist/`
are planned; no unsupported declarations or preview forms are shipped as working features.

Cadence owns the shared shell/navigation/chat, Field/table/detail/drawer components, scoped
storage and authorization, credential custody, approvals and effect execution. CRM owns
its app views, domain definitions, workflows, typed action declarations, migrations and tests.
App-specific behavior needs an explicit verified execution contract; copying host Rust/React
into this repository alone would not make it loadable by Cadence.

See [repository-layout.md](docs/repository-layout.md) for boundaries and release acceptance.

See [development-loop.md](docs/development-loop.md) for the shared CRM/Social Content development modes.

The intended distribution model is installation from a public Git repository at an explicit release/reference. The current installer scans the clone root; this repository keeps the bundle in `app/`, so direct Git URL installation still needs a supported bundle-subdirectory contract. Until that exists, use the local/extracted bundle path in [packaging.md](docs/packaging.md). Public availability does not grant installation approval or app permissions.
