# Cadence CRM App development

This repository is a CAD-811 extraction scaffold. Read README.md and docs/repository-layout.md
before modifying it. Preserve the installed app identity `crm`. Do not claim independent
CRM readiness from copied metadata or fixtures.

Keep generic shell/chat, shared visual components, authorization, scoped storage, credentials,
approval gates and effect execution in the Cadence host. App-specific source belongs here
only behind a compatible, verified host contract. Never vendor host controls to force a build.

No production state, credentials or real customer data. No host rollout or external sends.
No edits to other worktrees or host source without an assigned lane. Work on a task branch;
check existing work before creating a duplicate PR. Report exact source/artifact revisions,
real check exit codes, and unimplemented interfaces honestly. Independent review and pinned
host contract/lifecycle evidence precede releases.
