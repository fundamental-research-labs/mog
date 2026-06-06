Rating: 8/10

Summary judgment

This is a strong plan with a clear understanding of the current `shell/src/host` production path. It correctly identifies that `AppSlot` is currently acting as launch authority, setup coordinator, capability fallback, and render boundary, and it pushes the folder toward the right long-term role: a React host boundary over a canonical platform-owned app session. The plan is especially good at naming invariants that matter for correctness, including same-kernel launch identity, stale async result suppression, explicit setup modes, fail-closed capability behavior, registry snapshot consistency, and real lazy-load retry semantics.

The main weakness is that the plan is larger than a directly executable implementation specification. It describes the right architecture and many correct invariants, but it leaves too much unresolved sequencing between an interim host controller and the platform lifecycle from plan 066. It also needs sharper acceptance contracts for the reducer states, registry adapter, setup persistence, and migration behavior for embeddings that currently rely on permissive capability fallback.

Major strengths

- The plan is grounded in the actual folder behavior. The current code does use mutable module registries, `useMemo([])` manifest snapshots, app-id-only lazy component caching, permissive capability fallback without a capability context, mixed setup/runtime kernel ownership, and generic crash fallback handling.
- The architectural direction is sound. Making `shell/src/platform` the lifecycle authority while narrowing `shell/src/host` to rendering and user-input surfaces fits the sibling platform/service plans and avoids expanding host internals as a public app-author API.
- The production invariants are specific and valuable. The single-runtime-kernel invariant and fresh-vs-existing setup split are the most important parts of the plan because they address a real correctness hazard in the current `AppSlot` and `useAppInstanceSetup` flow.
- The plan handles whole bug categories rather than isolated symptoms: async generation guards, retry-domain separation, manifest-aware binding validation, capability mode defaults, dynamic import cache invalidation, and error-domain diagnostics.
- Verification coverage is appropriately production-path oriented. It calls for React rendering tests, user-event setup interactions, stale async completion tests, same-kernel assertions, registry/lazy retry tests, public boundary checks, and browser verification through the spreadsheet app path.

Major gaps or risks

- The plan needs a clearer migration sequence. It says the host controller should be a transition shape if plan 066 is not ready, but it does not define when to build the transition controller versus waiting for platform runtime authority. That ambiguity can easily create two competing lifecycle implementations.
- The proposed app-session contract is still conceptual. It lists types such as `HostRuntimeTarget`, `HostLaunchSuccess`, `HostError`, and `HostRetryAction`, but it does not define exact fields, ownership/disposal responsibilities, or event transitions tightly enough for parallel agents to implement independently without divergence.
- Setup persistence is identified as a dependency, but not resolved. The plan correctly says in-memory app instance records are insufficient, yet it does not specify whether this workstream should block, add a durable kernel contract first, or implement a scoped persistence adapter. That is a key acceptance decision.
- The capability migration needs a compatibility contract. Failing closed by default is correct for production, but existing embeddings may depend on the current implicit ungated adapter. The plan should specify which entrypoints default to `strict`, which may opt into `permissive-legacy`, and what diagnostics or tests prove the migration is intentional.
- The validation scope is broad but underspecified in places. Type compatibility, relation/lookup/rollup handling, optional tables, duplicate actual columns, and stale IDs are named, but the plan does not point to the source-of-truth type system or define the compatibility matrix expected by tests.
- The UI/E2E verification section is strong directionally, but it should name fixtures and app manifests needed to trigger fresh setup, existing binding, denial, loader failure, and render crash deterministically.

Contract and verification assessment

The contract assessment is mostly excellent. The plan explicitly names the contracts that must stop being implicit: active session identity, attempt identity, setup mode, runtime target, registry version, loader version, capability result, retry domain, and error domain. Those are the right contracts for this folder.

The weakest contract area is ownership. A future implementation needs exact rules for who owns `DocumentHandle` disposal after fresh setup, stale completion, cancellation, app switch, render crash, and close/reopen. It also needs an explicit identity check that bindings, managed table IDs, gated API, and app props all came from the same runtime target, not just from structurally similar kernel APIs.

The verification plan is well above average. It includes focused host tests, setup helper tests, platform/service integration gates, type gates, boundary checks, and browser exercises. The commands are plausible and map to existing scripts. The remaining issue is prioritization: the plan should distinguish must-pass gates for the first host refactor from later platform-conformance gates that only apply once plan 066 lands.

Concrete changes that would raise the rating

- Add a phase plan with mergeable milestones: current-state safety fixes, host session contract, setup kernel ownership, registry/lazy retry, error domains, then platform handoff.
- Include a reducer/event transition table with state names, allowed events, async side effects, stale-result cleanup behavior, and retry actions.
- Define the durable app-instance persistence dependency as either a blocker or a specific prerequisite implementation, with tests that prove reload/cross-session behavior.
- Specify exact capability-mode defaults by embedding path and add tests for strict missing-registry failure and explicit permissive legacy opt-in.
- Add a binding-validation contract document or table that defines logical table rules, column type compatibility, optionality, duplicate mapping policy, and relation target checks.
- Name deterministic test fixtures/manifests for setup, permission denial, loader rejection, render crash, stale app switch, and partial table creation failure.
- Define the platform integration boundary more sharply: what host code remains after platform authority exists, what APIs replace `launchApp`, and what compatibility exports must be preserved.
