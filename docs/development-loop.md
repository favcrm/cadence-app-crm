# Shared independent-app development loop

CRM and Social Content use the same development approach: edit the app repository -> hot-reloaded visual fixture preview -> selected isolated-daemon integration checks -> package install/update/rollback rehearsal on an unchanged compatible host.

## Fixture preview

Use the Cadence-owned, versioned renderer, shell and shared components. App-specific definitions stay here; do not copy Field/DataTable/chat/navigation into the app. Synthetic scenarios and simulated or refused actions must be visibly labeled. Preview success proves visuals only.

The current Cadence app-dev harness accepts trusted sources inside a Cadence checkout and refuses backend/proxy/token options. An external app-repo entrypoint and common renderer integration are still planned. No working preview command or SDK is supplied by this scaffold.

## Isolated integration

A future, separately reviewed adapter connects to an owned temporary daemon through supported host authentication and installation/context-scoped APIs. Use temporary state and ports 3110–3199. Host custody retains identity, credentials, permissions, approvals and effects. Do not turn the fixture runner into an API proxy. This mode is not implemented here.

## Unchanged-host rehearsal

Build the artifact, install it, and update package-owned domain behavior without rebuilding the host. Prove integrity/compatibility refusal, data and history preservation, invalidation of stale approvals, isolation, interrupted migration/update recovery and rollback. Adding a field alone is insufficient to prove independently changed CRM behavior. This rehearsal remains pending.

Cadence coordinates shared contracts and tooling; both app repositories consume them. Separate repositories and successful HTTP connections do not establish functional independence.
