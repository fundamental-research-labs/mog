Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan for `mog/kernel/src/document/collab`. It correctly identifies the folder as the browser/client transport adapter around Yrs state movement, not as the owner of workbook semantics, and it anchors the work to the host-backed collaboration bootstrap/dispose path. The strongest part is its focus on verifiable contracts: lineage metadata, state-vector acknowledgement, serialized `syncApply`, final flush, protocol drift, presence immutability, and non-skipping tests.

The plan loses points because some of its most important decisions are still framed as open-ended architecture choices rather than resolved contracts. In particular, the shared protocol package cannot be specified cleanly until the actual room service owner/package is located, and the provider-vs-sidecar lifecycle decision is called out but not decided. That makes the plan excellent as an audit and direction document, but slightly under-specified as an implementation contract.

Major strengths

- The plan is accurate against the current source. `wire-codec.ts` does duplicate message constants and trusts decoded JSON too much; `ws-sidecar.ts` uses closure-scoped lifecycle booleans; `syncApply` live errors are swallowed; `participants` is exposed as the mutable internal map; direct `console.log` is unconditional; and real-stack tests can skip when server/NAPI prerequisites are missing.
- It correctly connects this folder to adjacent production paths: `kernel/host-internal/src/create.ts`, `document-factory.ts`, `document-lifecycle-system.ts`, `compute-core.ts`, and spreadsheet collab UI consumers.
- The stated invariants are concrete and valuable: preflight metadata must fail closed, join metadata must match snapshot lineage, `lastServerSv` must not advance before acknowledgement, `PUSH_RESPONSE` must include a known `pushId` and coordinator state vector, final flush must prove acknowledgement, and detach must reject pending pushes and cancel timers.
- The proposed module split is sensible: snapshot fetch, state reducer, CRDT sync, presence channel, composition wrapper, and diagnostic sink are real production responsibilities rather than arbitrary files.
- The verification section distinguishes pure deterministic contract tests from real server/NAPI stack tests, which is the right shape for this area.

Major gaps or risks

- The plan does not identify the actual collab room service package or repo. It notes that `runtime/server/src` is absent, but the shared protocol package work cannot be completed safely until protocol ownership and dependency direction are explicit.
- It leaves a major architecture fork unresolved: whether the WebSocket sidecar remains a separate transport sidecar or becomes a document provider. Calling out the decision is good, but implementers need a chosen target or a decision gate with objective criteria before refactoring lifecycle ownership.
- The scope is very broad for one folder plan. Protocol sharing, lifecycle reducer extraction, CRDT repair semantics, presence validation, host lifecycle changes, app-store compatibility, and CI gate changes are all valid, but the dependency order needs stricter phase boundaries and exit criteria.
- Server-side requirements are implied but not contractually enumerated. For example, `PULL_RESPONSE` coordinator state vector, resume lineage metadata, max payload sizes, awareness expiry behavior, and error taxonomy require matching server changes.
- The plan proposes exporting a typed `CollaborationRoomChangedRefetchError`, but it does not specify the public/internal boundary for that type or how to avoid widening the public barrel accidentally.
- It does not explicitly require compatibility fixtures generated or consumed by both client and server in CI once the shared protocol exists. It says shared tests should exist, but not which package owns them or how drift fails.

Contract and verification assessment

The contract assessment is the best part of the plan. It names the important correctness properties for CRDT consistency and durability, especially around snapshot lineage, serialized application of remote updates, acknowledgement-based `lastServerSv`, final flush, and reconnect cleanup. These contracts map directly to the current production path in `createHostBackedCollaborationDocument`, where room snapshots create the engine and `flushAndDetach()` gates room-backed disposal.

The verification gates are mostly appropriate: focused kernel collab tests, broader kernel type/test gates, spreadsheet app consumer tests, repo-wide typecheck after public type changes, and manual two-browser UI verification for presence/reconnect/final flush behavior. The main weakness is that the plan cannot yet name a server-side protocol parity gate because the room service is missing from this checkout. Until that is resolved, protocol sharing remains an objective rather than a verifiable contract.

Concrete changes that would raise the rating

- Add a phase-zero deliverable: locate the actual room service, document its repo/package path, and define the allowed dependency direction for a shared protocol contract.
- Choose the lifecycle architecture target before implementation starts: either keep a sidecar registry with explicit attach/detach/final-flush ownership, or migrate to the provider protocol and list the conformance tests required.
- Turn the server requirements into a message-by-message protocol table covering required fields, binary payload rules, size limits, lineage fields, error codes, and acknowledgement semantics for every `MSG` value.
- Add explicit implementation phases with stop/go gates: protocol contract first, deterministic codec/decoder tests second, state reducer and CRDT sync third, presence fourth, host lifecycle fifth, real-stack CI gate last.
- Specify the exact public exports that should and should not change, especially for typed errors, decoded message types, diagnostics, and presence state.
- Define CI behavior for skipped real-stack tests: which pure tests must always run, which server/NAPI tests are required in collaboration CI, and what signal should fail when prerequisites are absent.
