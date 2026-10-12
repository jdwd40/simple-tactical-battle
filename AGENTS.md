# Tactical Space Battle working conventions

The approved design is GAME_DESIGN.md, fixed tick semantics are WEGO_SPEC.md, shared boundaries are ARCHITECTURE.md and the sole backlog is DEVELOPMENT_PLAN.md. Read the parts relevant to your assignment before editing. Route material mechanic/contract changes through the lead; numerical balance is tunable configuration.

The canonical status is `/home/jd/projects/tactical-space-battle/PROJECT_STATUS.md`, written only by the lead. Worktree copies can be stale. Workers return updates in their confirmed Herdr panes; never dispatch to other workers themselves or rename/reconfigure sessions.

Verify your assigned absolute worktree, branch and starting commit before editing. Stay inside assigned file ownership. Shared contracts/scenarios belong to General, package/lockfiles/root configuration to Assistant, React/application presentation/PixiJS to UI; the lead sequences ownership transfers. Preserve unrelated changes. Do not commit PROJECT_STATUS.md from a worker worktree.

Builders test their own changes and report actual commands/outcomes. Completion format: RESULT task/attempt; STATUS READY_FOR_REVIEW or BLOCKED; LOCATION worktree/branch; REVISION exact base/head; CHANGES; VERIFICATION; LIMITATIONS. Make scoped local commits. No remote push, default/release-branch merge or public deployment is authorised.

Reviewer: read-only implementation inspection in an isolated exact revision; tests and disposable reproduction artifacts are allowed. Return PASS, CHANGES_REQUIRED or BLOCKED for the supplied task/attempt/base/head, with actionable severity/blocking status, file/location, evidence and requirement impact. Initial review plus at most two correction rounds. UI review includes the running interface and interaction artifacts, not compilation alone.

Keep simulation DOM/clock/render independent. UI receives observer-safe presentation only; AI receives its own observation/memory only. Seeded randomness, fixed ticks, simultaneous batches and swept projectiles follow WEGO_SPEC.md. Browser tests use the assigned worktree and port; clean up task-owned servers and artifacts, avoid heavy duplicate processes. Do not expand the release scope to fill idle time.
