# Improve `mog/kernel/src/document/collab`

## Source folder and scope

Public source folder reviewed: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/document/collab`

Queue item 11 covers the kernel collaboration and CRDT consistency path owned by the public Mog source tree. The folder currently contains:

- `wire-codec.ts`: browser-native WebSocket protocol encoder/decoder and message type constants.
- `ws-sidecar.ts`: WebSocket sidecar that connects a document `ComputeBridgeLike` to the collaboration room service.
- `event-log.ts`: optional structured sidecar event log and derived wire-message statistics.
- `index.ts`: public barrel exports.
- `__tests__/wire-codec.test.ts`, `event-log.test.ts`, `ws-sidecar.test.ts`, `collab-e2e.test.ts`, and `test-log-collector.ts`.

Adjacent production paths that must stay in lockstep:

- `kernel/host-internal/src/create.ts`, which performs host-backed collaboration bootstrap, fetches room snapshots, creates the document from authoritative Yrs bytes, attaches the sidecar, and calls `flushAndDetach()` during room-backed disposal.
- `kernel/src/api/document/document-factory.ts`, which exposes collaboration sidecar public types on `DocumentHandle`.
- `kernel/src/document/document-lifecycle-system.ts`, which consumes authorized room bootstrap data and suppresses default-sheet synthesis for collaboration creation.
- `kernel/src/bridges/compute/compute-core.ts`, which provides the production `syncStateVector`, `syncDiff`, `syncApply`, and update subscription behavior that the sidecar depends on.
- `apps/spreadsheet/src/chrome/collab/*` and `apps/spreadsheet/src/hooks/collab/*`, which consume sidecar status and presence maps for UI state, avatars, and remote cursors.
- The collab room service wire contract referenced by the code comments and tests. In this checkout, `runtime/server/src` is absent even though tests and codec comments reference it, so protocol ownership is currently not self-verifying from this folder alone.

Out of scope for this folder: Rust CRDT internals, workbook API cache refresh, server persistence implementation, UI rendering design, and private/internal planning assets. Those are dependencies or consumers. This plan still names them where the production contract crosses folder boundaries.

## Current role of this folder in Mog

`collab` is the browser/client transport adapter between a live Mog document and a room-owned Yrs coordinator. It does not own workbook semantics; it owns the production path that moves CRDT updates, validates bootstrap lineage, tracks connection state, and broadcasts collaborator presence.

The current path is:

- `fetchRoomSnapshot()` opens a short-lived WebSocket, sends `ROOM_SNAPSHOT`, validates response metadata, verifies `fullStateHash` with Web Crypto SHA-256, and returns full state, state vector, room epoch, hash, and snapshot token.
- Host-backed document creation uses that snapshot to create the compute engine from authoritative Yrs bytes before attaching the sidecar.
- `attachWsSidecar()` requires preflight snapshot metadata for first join, sends `JOIN_REQUEST`, validates `JOIN_RESPONSE` lineage, applies full state if present, then subscribes to local update V1 payloads.
- Local changes are flushed by comparing the current local state vector to the last acknowledged server vector, computing `syncDiff(lastServerSv)`, sending `PUSH`, and waiting for a matching `PUSH_RESPONSE`.
- Remote nudges trigger `PULL_REQUEST`; `PULL_RESPONSE` and server diffs are applied through a serialized `syncApply` chain.
- Reconnects use `RESUME_REQUEST` after the first successful bootstrap and back off exponentially.
- Presence uses `AWARENESS_UPDATE` messages containing JSON awareness changes keyed by participant id; the sidecar exposes remote participants through a read-only map and change callbacks.
- `flushAndDetach()` is the final durability hook used by room-backed handle disposal; it loops until the local and server state vectors match or the timeout expires.
- `event-log.ts` is an optional test/diagnostic surface with wire-message counts and byte totals.

The strongest current pieces are the lineage checks around room snapshot and first join, the serialized apply chain, push acknowledgement tracking by `pushId`, and real-stack E2E tests that exercise cell sync through `HeadlessEngine` plus the WebSocket sidecar when the server and NAPI prerequisites are available.

The main weaknesses are that the protocol schema is duplicated in the browser client, server parity is not executable from this folder, several lifecycle and failure transitions are implicit booleans inside `ws-sidecar.ts`, live `syncApply` failures are swallowed without a repair contract, production logging is unconditional, and some integration tests silently skip when the server/addon path is unavailable. The folder needs a sharper protocol contract and a sidecar state model that can be verified independently of incidental timing.

## Improvement objectives

1. Make the collaboration wire protocol a shared, versioned contract rather than duplicated client constants and comments.
2. Turn sidecar lifecycle state into an explicit state machine with typed transitions, timers, cleanup ownership, and observable error reasons.
3. Strengthen CRDT convergence invariants around `lastServerSv`, `PUSH_RESPONSE`, `PULL_RESPONSE`, reconnect, resume, and final flush.
4. Make bootstrap lineage validation complete and auditable for snapshot fetch, first join, resume, and room-changed refetch handling.
5. Replace unconditional production `console.log` calls with structured, opt-in diagnostics while preserving high-signal test logs.
6. Treat presence as a typed, bounded contract with participant removal, reconnect replay, stale peer handling, and immutable snapshots for consumers.
7. Make protocol and sidecar test coverage deterministic and non-skipping in CI by separating pure contract tests from real server/NAPI stack tests.
8. Clarify this sidecar's relationship to the document provider/lifecycle system so it cannot bypass write gates, disposal ordering, or final durability expectations.
9. Keep all improvements on the production path used by host-backed collaboration documents, not on test-only mocks or compatibility shims.

## Production-path contracts and invariants to preserve or strengthen

- The room service remains the authority for collaboration room state. Local document creation for collaboration must start from the room snapshot, not from a local default document or persisted browser cache.
- First join requires `preflightStateVector`, `preflightRoomEpoch`, `preflightFullStateHash`, and `preflightSnapshotToken`. Missing metadata must fail closed.
- `ROOM_SNAPSHOT_RESPONSE` and `JOIN_RESPONSE` full-state bytes must hash to `fullStateHash`; snapshot token version must remain explicit.
- `JOIN_RESPONSE` room id, room epoch, full-state hash, and snapshot token must match the preflight snapshot used to create the engine.
- If the server reports that the room changed during bootstrap, host-backed creation should tear down the partially created document and refetch once through the documented room-changed path.
- The compute bridge remains the only interface used for CRDT state: `syncStateVector`, `syncDiff`, `syncApply`, and `subscribeUpdateV1`.
- `syncApply` calls must stay serialized. No inbound full state, pull response, push response, or resumed diff may apply concurrently.
- Outbound diffs must be computed against the last server state vector that was acknowledged or proven by handshake. `lastServerSv` must never advance before server acknowledgement.
- A `PUSH_RESPONSE` must match an outstanding `pushId`, include `ok: true`, and include a coordinator state vector before a push can be considered durable.
- Failed or malformed push responses must reject the corresponding pending push and leave the sidecar able to recover through reconnect or a subsequent pull, without falsely reporting final flush success.
- `flushAndDetach()` must only resolve after local state is known to be acknowledged by the server or after there are no local changes relative to the acknowledged server vector.
- Detach must be idempotent, cancel reconnect and presence timers, unsubscribe update listeners, reject pending pushes, stop future sends, close the socket, and transition to `offline`.
- Reconnect must not create duplicate update subscriptions or duplicate sockets. Resume must use the current local state vector and must rehydrate awareness state.
- Presence callbacks must never expose the mutable internal map in a way that lets consumers mutate sidecar state.
- Local participant presence should not appear in the remote participant map. Remote removals must be delivered even when the participant count becomes zero.
- Sidecar diagnostics must not be required for correctness and must not impose production overhead beyond configured logging.
- Public exports from `index.ts` must remain intentional API. Internal helpers should stay unexported unless a production consumer needs them.
- The sidecar must not become an alternate persistence layer and must not write around lifecycle/storage/write-gate contracts.

## Concrete implementation plan

1. Establish a shared protocol package for collab wire messages.

   - Move message discriminants, binary/JSON layout metadata, and message schemas into a single public contract module owned outside `collab` if the server is in another package, or into a shared package consumed by both the browser sidecar and the room service.
   - Replace `MSG` and `BINARY_TYPES` duplication with generated or imported protocol definitions.
   - Define typed payloads for every message currently enumerated: join, resume, push, pull, awareness, room snapshot, lock messages, room snapshot response, and errors.
   - Add a protocol version or feature field to join/snapshot handshakes so future server/client drift fails explicitly.
   - Keep browser encoding implemented with `DataView`/`Uint8Array`; do not introduce Node `Buffer` into browser code.

2. Make wire decoding validate structure, not only framing.

   - Add schema validation for decoded JSON metadata before sidecar code casts it.
   - Reject unknown message types, invalid JSON payloads, negative or oversized JSON lengths, missing binary payloads on binary-only responses, and unexpected binary payloads on pure JSON messages.
   - Add explicit maximums for metadata size, binary payload size, and awareness payload size that align with server-side limits.
   - Return typed decode results such as `DecodedCollabMessage` instead of `{ type, json, binary }` with `unknown`.
   - Preserve exact byte layout compatibility; the change should make invalid frames safer, not alter valid frames.

3. Replace the implicit sidecar lifecycle with an explicit state reducer.

   - Introduce a small sidecar state model with states like `idle`, `snapshotting`, `connecting`, `joining`, `online`, `reconnecting`, `finalFlushing`, `offline`, and `failed`.
   - Track socket generation, bootstrap completion, active participant id, current room id, pending push ids, active update subscription, reconnect timer, presence timer, and final-flush promise in one state-owned structure.
   - Route socket open/message/close/error, local update, presence update, flush request, detach, and final-flush events through typed transition functions.
   - Keep `attachWsSidecar()` as the public factory, but make it compose state, transport, protocol, and compute-sync modules instead of owning all behavior in one closure.
   - Add lifecycle reducer tests that do not need a real WebSocket or NAPI addon.

4. Split `ws-sidecar.ts` by production responsibility.

   - `room-snapshot-client.ts`: snapshot fetch, timeout, hash validation, and room id validation.
   - `sidecar-state.ts`: status transitions, cleanup actions, reconnect scheduling decisions, and final-flush state.
   - `crdt-sync.ts`: serialized apply chain, state-vector comparison, diff computation, push acknowledgement handling, pull handling, and final flush.
   - `presence-channel.ts`: awareness encode/decode, debounce, participant map snapshots, removal handling, and replay.
   - `ws-sidecar.ts`: public composition and WebSocket transport wiring.
   - Keep `event-log.ts` optional and dependency-free; use a narrow diagnostic sink interface from the new modules.

5. Strengthen CRDT convergence and repair behavior.

   - Make `serialApply()` return a typed result and define when errors are fatal versus repairable.
   - Replace the current "live syncApply errors are swallowed" behavior with a repair contract: record degraded state, request a fresh pull or reconnect, and surface status/diagnostic changes when repair is pending.
   - Ensure `PULL_RESPONSE` updates `lastServerSv` only when the server includes a coordinator state vector or after a follow-up state-vector handshake proves convergence. If the server does not currently provide this metadata, extend the protocol.
   - Handle `BROADCAST_NUDGE` promise rejections from `syncStateVector()` and socket send failures through the same repair path.
   - Ensure `flushOutbound()` cannot leave a pending `pushId` timer alive if the socket closes, send throws, or the sidecar detaches.
   - Make final flush wait on in-flight applies and in-flight push acknowledgements deterministically instead of relying on short sleeps when a flush is already in progress.

6. Complete bootstrap, resume, and room-change lineage handling.

   - Promote `CollaborationRoomChangedRefetchError` to an exported typed error used by host-backed creation instead of matching error names.
   - Validate resume response room id and coordinator state vector. If resume returns full state, define whether the hash/snapshot token must be checked or whether resume has a separate lineage token.
   - Re-broadcast local presence after successful resume through an explicit post-online action, not only through app-store status listeners.
   - Add tests for stale snapshot token, changed room epoch, full-state hash mismatch, response room mismatch, missing coordinator state vector, room-changed retry success, and room-changed retry exhaustion.

7. Replace unconditional console logging with structured diagnostics.

   - Add a `CollabDiagnosticsSink` interface with levels, event type, room id, participant id, socket generation, push id, and byte counts.
   - Route `eventLog` through that sink and allow production callers to provide no sink for near-zero overhead.
   - Remove direct `console.log` from production sidecar code. Test diagnostics can still print merged timelines on failure.
   - Redact URL query strings and avoid logging full presence payloads, snapshot tokens, or user-provided cell data.
   - Extend `MessageStats` to include malformed frames, retries, repair attempts, final flush duration, and reconnect counts.

8. Make presence immutable, bounded, and reconnect-safe.

   - Store internal participant state in a private mutable map but expose snapshots through `new Map(...)` or a frozen read-only wrapper for both `participants` and callbacks.
   - Notify listeners when the map becomes empty after removals.
   - Validate presence shape, clamp large strings, require valid color format or use caller-provided identity defaults, and reject oversized awareness payloads before parsing.
   - Track participant last-seen timestamps and define stale removal behavior if the server does not send a removal on disconnect.
   - Ensure pending local presence survives reconnect and is flushed once the socket returns online.

9. Make tests prove production contracts without accidental skips.

   - Keep pure protocol byte-layout tests, but generate fixtures from the shared protocol contract and include every message type, including resume, room snapshot, awareness, lock list, and malformed frames.
   - Add a fake WebSocket transport harness for deterministic sidecar lifecycle tests: handshake success/failure, reconnect, duplicate close events, pending push rejection, final flush, detach during handshake, and malformed inbound messages.
   - Keep real server/NAPI tests as production-stack E2E gates, but do not let them be the only coverage for protocol and lifecycle correctness.
   - Replace broad `describe.skip` behavior with explicit environment capability reporting so CI can fail when a required production-stack gate is unavailable.
   - Unskip structural sync tests only after the compute mutation-result/cache refresh dependency is fixed; keep them out of the collab transport success criteria until then.

10. Clarify lifecycle ownership with document providers.

   - Decide and document whether the WebSocket sidecar remains a separate transport sidecar or becomes a document provider. Do not leave it as an implicit provider bypass.
   - If it remains separate, add a lifecycle-owned sidecar registry that enforces attach ordering, detach ordering, final flush before room-backed dispose, and diagnostics.
   - If it becomes a provider, route inbound/outbound updates through the `RustDocument` provider protocol and provider conformance suite so echo suppression and storage identity share one contract.
   - In either case, add tests proving room-backed `dispose()` calls final flush, final-flush failure blocks clean close, and local cleanup does not mutate room state after detach.

## Tests and verification gates

No build, test, formatter, or typecheck commands should be run for this planning-only queue task. For the future implementation, use the following production gates.

Focused kernel collaboration gates:

- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/collab/__tests__/wire-codec.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/collab/__tests__/event-log.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/collab/__tests__/ws-sidecar.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/collab/__tests__/collab-e2e.test.ts`

New tests to add with the implementation:

- Protocol contract test shared between browser client and room service, covering every message type and malformed frame class.
- Deterministic fake-WebSocket sidecar lifecycle tests for join, resume, reconnect, detach, final flush, socket close during handshake, socket close during pending push, and duplicate socket events.
- CRDT convergence tests for out-of-order push responses, missing push ids, pull response after local concurrent write, apply failure followed by repair pull, and final flush with an in-flight apply.
- Bootstrap lineage tests for room id mismatch, epoch mismatch, hash mismatch, stale snapshot token, room-changed refetch, and resume response validation.
- Presence tests for immutable snapshots, empty-map removal notification, local-self filtering, oversized/malformed awareness payloads, reconnect replay, and stale participant expiry.
- Host-backed lifecycle integration tests proving room snapshot fetch, document creation from Yrs bytes, sidecar attach, final flush, and dispose ordering.

Broader TypeScript and app gates after touching public types or consumers:

- `cd mog && pnpm --filter @mog-sdk/kernel test`
- `cd mog && pnpm --filter @mog-sdk/kernel typecheck`
- `cd mog && pnpm --filter @mog-sdk/spreadsheet-app test -- src/chrome/collab`
- `cd mog && pnpm typecheck`

Real UI verification after sidecar or presence behavior changes:

- Start the spreadsheet dev server, create or join a collaboration room with two browser sessions, edit cells in both sessions, and verify convergence through the workbook UI.
- Exercise reconnect by stopping and restarting the room service or network path; verify status, final convergence, and presence replay.
- Close a room-backed document with pending edits and verify the final flush path before resources are disposed.

## Risks, edge cases, and non-goals

- The public checkout does not include `runtime/server/src`, while the tests and codec comments reference that path. The smallest investigation is to identify the actual collab room service package or repo, then make the wire protocol shared with that service. Without that, protocol parity remains evidence-based rather than contract-based.
- `ws-sidecar.test.ts` and `collab-e2e.test.ts` currently skip when the NAPI addon, SDK support, or collab server entrypoint is unavailable. That is useful for local ergonomics but too weak for CI ownership of collaboration correctness.
- Structural sync tests in `collab-e2e.test.ts` are skipped because underlying Yrs state converges but workbook API caches do not refresh for sheet lifecycle and merge metadata. That is a compute/lifecycle mutation-result dependency, not a reason to weaken transport contracts.
- Changing `lastServerSv` semantics requires server metadata alignment. The client must not invent acknowledgements locally to make final flush pass.
- Presence payload validation must not break existing UI identity broadcasts from `apps/spreadsheet`; migrate fields intentionally and preserve the public `CollaborationPresenceState` shape unless a versioned API change is accepted.
- Web Crypto SHA-256 is required today. If non-browser runtimes need this path, add an explicit digest dependency or host-provided hash function instead of silently skipping hash validation.
- This plan does not propose a polling fallback, local-only collaboration mode, test-only mock server as production evidence, or compatibility shim for malformed protocol frames.
- This plan does not move CRDT merge semantics out of Rust/Yrs or make the sidecar a workbook state owner.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable, but the protocol contract must be integrated first so implementation slices compose cleanly.

Suggested parallel tracks:

- Protocol owner: locate the actual room service, define shared message schemas, generate browser/server fixtures, and replace duplicated `MSG` definitions.
- Sidecar state owner: extract lifecycle reducer, socket generation handling, reconnect, detach, final flush, and fake-WebSocket tests.
- CRDT sync owner: harden apply serialization, push acknowledgement, pull metadata, repair path, and convergence tests against `ComputeBridgeLike`.
- Presence owner: extract awareness handling, immutable snapshots, validation, stale removal, reconnect replay, and app-store compatibility tests.
- Host lifecycle owner: wire typed errors and final-flush disposal behavior through `kernel/host-internal/src/create.ts` and document lifecycle integration tests.
- CI/test owner: make pure sidecar tests non-skipping, make real-stack prerequisites explicit, and define the required collab server/NAPI gate.

Dependencies:

- Collab room service package or repo for protocol parity and server response metadata.
- `kernel/src/document` lifecycle and provider ownership decision for whether sidecar remains separate or becomes provider-backed.
- `kernel/src/bridges/compute` and Rust compute mutation-result work for unskipping structural workbook API convergence tests.
- Spreadsheet collab UI store and hooks for presence identity/reconnect behavior.
