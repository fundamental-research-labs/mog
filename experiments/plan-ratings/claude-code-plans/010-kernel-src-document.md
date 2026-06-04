# 010 — Improve `mog/kernel/src/document` (document lifecycle, providers, persistence, ownership)

## Source folder and scope

- **Folder:** `mog/kernel/src/document`
- **Size:** ~14,628 lines of `.ts` (including `__tests__`). Top files: `document-lifecycle-system.ts` (2,201), `providers/indexeddb-provider.ts` (1,294), `rust-document.ts` (1,200), `collab/ws-sidecar.ts` (1,001), `document-lifecycle-machine.ts` (978), `state-mirror.ts` (622), `providers/filesystem-provider.ts` (537), `host-operation-gate.ts` (494).
- **In scope (edit targets):**
  - **Lifecycle orchestration:** `document-lifecycle-machine.ts` (pure XState v5 definition), `document-lifecycle-system.ts` (`DocumentLifecycleSystem`, the side-effecting actor host).
  - **Document orchestrator:** `rust-document.ts` (`RustDocument` — engine subscription fan-out to providers), `state-mirror.ts` (`StateMirror` — sync read view of bounded direct state).
  - **Ownership / admission / authorization:** `write-gate.ts`, `high-water-mark-registry.ts`, `host-operation-gate.ts`, `host-import-source.ts`, `host-storage-preflight.ts`, `host-runtime-transport.ts`, `validate-host-context.ts`.
  - **Provider protocol (`providers/`):** `provider.ts` (the `Provider` contract), `factory.ts`, `registry.ts`, `composition-validator.ts`, `storage-state.ts`, `sdk-storage-adapter.ts`, `bridge-provider-doc.ts`, and the concrete providers: `indexeddb-provider.ts` (+ `indexeddb-schema.ts`, `indexeddb-meta.ts`), `memory-provider.ts`, `filesystem-provider.ts`, `tauri-file-provider.ts`, `object-store-provider.ts`, `database-log-provider.ts`, `host-callback-provider.ts`, `read-only-snapshot-provider.ts`, `redacted-published-snapshot-provider.ts`, `test-provider.ts`.
  - `index.ts`, `providers/index.ts`, `README.md`.
- **Out of scope (named for coupling, not edit targets):**
  - **`collab/` (`wire-codec.ts`, `ws-sidecar.ts`, `event-log.ts`)** — owned by sibling plan **011 (`011-kernel-src-document-collab.md`)**. This plan only references it where the lifecycle/provider boundary touches it (the R1 "separate sync channel" bypass), and treats the bypass as a contract to preserve, not to change here.
  - `bridges/compute/` (`ComputeBridge`), `context/` (`DocumentContext`), `services/undo/` (`UndoService`), `errors/` (`KernelError`), the `@mog-sdk/types-document/*` and `@mog-sdk/contracts/*` type packages, the Rust compute-core engine reached via `computeBridge`. Changes rippling into them are flagged as cross-folder dependencies.

## Current role of this folder in Mog

This folder owns the **birth, persistence, and death of a document**, and the **authorization fences** around those transitions. Three layered concerns:

1. **Lifecycle orchestration.** A strict split (documented in `README.md:66-83`) between a *pure* state machine (`document-lifecycle-machine.ts` — no I/O, no `async`, types-only imports) and a *side-effecting* host (`DocumentLifecycleSystem`) that injects `fromPromise` actors via `machine.provide()`. The machine drives `idle → creating → wiring → starting → (hydrating|hydrating_csv)? → attaching → ready`, with `DISPOSE` reachable from any state and an `error`/`RECOVER` trap-recovery loop.

2. **Document orchestration and persistence.** `RustDocument` is now an **orchestrator-only** seam: it subscribes once to the engine's `update_v1` stream and fans each update out, FIFO and back-pressured, to an ordered set of `Provider` sinks. Each `Provider` owns its own coalescing, durability, and flush semantics (the contract in `providers/provider.ts:51-166`). `StateMirror` holds a synchronous read view of bounded direct workbook/sheet state (frozen panes, page setup, sheet metadata, workbook settings) for first-frame reads, updated apply-before-emit (`state-mirror.ts:24-28`).

3. **Ownership, admission, and authorization (the "host-backed" path).** `WriteGate` is a mutation-admission gate keyed to lifecycle phase (`open`/`checkpointing`/`closing`/`closed`, with bypass scopes for replay/import). `HighWaterMarkProofRegistry` issues single-use export-authorization proofs tied to gate watermarks. `HostOperationGate` authorizes export/share/delete/destroy via expiring, nonce-replay-protected handoffs. `host-import-source.ts` forces import bytes through validated, fail-closed source-handle resolvers. `host-storage-preflight.ts`, `host-runtime-transport.ts`, and `validate-host-context.ts` make the host-backed path **derive everything from an explicit, validated `KernelHostContext`** with no ambient/global sniffing.

Two configuration paths coexist deliberately: a **legacy/cooperative** path (reads environment, napiAddon, security globals) and a **host-backed** path (`KernelDocumentLifecycleInput`, fully validated). The boundary between them is the highest-value and highest-risk part of this folder.

## Evidence (observed in the current tree)

- **Inbound-update origin tracking has a real interleaving window.** `rust-document.ts:617` sets a single instance field `this._currentUpdateOrigin = `provider:${envelope.providerRefId}``, then **yields on `await import('./providers/bridge-provider-doc')` at line 619** before `await doc.applyUpdate(envelope.payload)` at 621, resetting to `'local'` in a `finally` (623). The `subscribeUpdateV1` callback fires synchronously inside `applyUpdate` and tags the queued entry with `_currentUpdateOrigin` (`rust-document.ts:1055`). Because `applyProviderUpdate` is `async` and yields at the dynamic import, two concurrent inbound updates (provider A then provider B) can interleave so A's engine update is tagged `provider:B`. That origin is the echo-suppression key during drain (the orchestrator skips re-appending an update to the provider it came from), so a mis-tag can **echo a remote update back to its source provider or fail to echo a local edit**. Single field, async body, no per-call binding.

- **Import-initialize promotion re-checks the queue across an async boundary (TOCTOU).** During import-initialize, staged providers are promoted to the live set only after a full-state checkpoint succeeds (`rust-document.ts:505-533, 828-898`). The "no pending queue" guard at ~`829` reads `this.updateQueue.length`/`this.flushScheduled`, but enqueues can arrive between that read and the checkpoint start because bridge calls are async. The `WriteGate.checkpointing` mode is the intended fence, but it is orthogonal to the orchestrator's own queue check, so the two can disagree. Promotion can proceed with updates still queued, violating the documented "no queue during promotion" invariant.

- **`DocumentLifecycleSystem` is a 2,201-line dual-path god-host.** `document-lifecycle-system.ts` carries seven actor implementations plus storage-state mutation, deferred-hydration scheduling, and provider attachment, each forked into a host-backed branch and a legacy branch. `executeAttachProviders` alone is ~415 lines (host path ~`1243-1509`, legacy path ~`1529-1649`). The two branches duplicate the provider `roleOrder` map (`{authority:0,cache:1,replica:2,snapshot:3,exportSink:4}`) verbatim at ~`1304-1309` and ~`1467-1472`, the sorted-attach loop, and the default-sheet logic. 18 distinct `legacy` references live in this one file.

- **Provider boilerplate is copied across four stateful providers.** `memory-provider.ts`, `filesystem-provider.ts`, `object-store-provider.ts`, and `database-log-provider.ts` each independently declare the identical `pendingUpdates: Uint8Array[]`, `flushing: Promise<void>|null`, `detached`, `attached`, `_flushFailed` fields and re-implement the same `appendUpdate`/`flushSync`/`detach` queue-and-drain orchestration plus the same `attach` idempotency pre-checks (`if (this.detached) … if (this.attached) …`). The `flushSync` error-handling block (check detached → drain → set `_flushFailed`) is replicated four times.

- **Two sources of truth for provider traits.** `composition-validator.ts:40-102` hardcodes `KIND_TRAITS` (per-kind `durable`/`writable`/allowed-roles) used by the *sync* composition rules, while each provider independently reports `getCapabilities()` with overlapping `durable`/`writable` flags. The validator never reconciles the instantiated provider's reported capabilities against `KIND_TRAITS`, so a provider whose factory drifts from its declared kind traits is not caught (`registry.ts` preflight validates config, not the instance).

- **Provider interface carries a deprecated/renamed diagnostic method.** `provider.ts:115` and `indexeddb-provider.ts:598` mark `getRawBytesFromId()`/`stateVector()` `@deprecated` in favor of `storageCursor()`, but `stateVector()` remains mandatory on the interface while `storageCursor?()` and the lifecycle-adoption methods `getCapabilities?()`/`getIdentity?()` are optional. Every consumer must branch on presence; the naming (`stateVector` is not a Yrs state vector) is actively misleading.

- **`TauriFileProvider` is a wired stub that throws.** `tauri-file-provider.ts:147,289` throw `TAURI_SIDECAR_NOT_WIRED_MSG` and `:221` throws `NOT_IN_TAURI_MSG`. The provider kind is registered and selectable but its persistence path is unimplemented — a latent runtime failure for any desktop attach that reaches it.

- **`HighWaterMarkProofRegistry` proof store grows unbounded.** `high-water-mark-registry.ts:31` holds proofs in a `Map`; expiry is enforced only at validate-time and `pruneExpired()` (`:135-145`) must be invoked externally. No issue-time or timer-driven prune, so a long-lived document leaks expired proofs.

- **Inconsistent provider observability.** IndexedDB logs initial-snapshot failures via `console.warn` (`indexeddb-provider.ts:354-365`) and eviction failures via `console.error` (`:372-376`); `filesystem-provider.ts:300-318` swallows `flushSync` errors silently into `flushFailed`; `memory-provider.ts` has no sync-path try/catch. No shared, provider-tagged diagnostic channel, so silent degradation is hard to attribute.

- **`_appendActive` latches and never clears.** `rust-document.ts:278,555,864,1121` set `_appendActive = true` and never reset it. After every provider detaches it still reports active via the diagnostic hatch (`:344`), misreporting the live write path. (Likely intentional "has ever worked" telemetry, but undocumented and indistinguishable from "is currently active".)

- **Provider contract violations are swallowed.** `rust-document.ts:1104-1111` and `:920-927` catch and log (per the documented "`appendUpdate`/`flushSync` must not throw" contract) but never retry or escalate; a misbehaving provider silently drops that update with no surfaced signal.

- **Clean baseline otherwise.** Zero `TODO`/`FIXME`/`HACK`/`XXX` markers across the entire folder's production code; the state machine itself is sound (proper guards, DISPOSE-from-any-state, idempotent TRAP, RECOVER-only-from-error); the IndexedDB v1→v2 schema migration handles concurrent `onblocked` opens and cursor-then-drop ordering correctly; the legacy boundary is enforced by dedicated `legacy-bypass-guards.test.ts` and `legacy-path-inventory.test.ts`. Improvements are about **closing concurrency windows, de-duplicating, and tightening the provider contract** — not behavior changes.

## Improvement objectives

1. **Eliminate the two orchestrator concurrency windows.** Make inbound-update origin tagging immune to async interleaving, and make import-initialize promotion atomic against the update queue. These are correctness defects with data-fidelity consequences (echo loops, lost-or-double-tagged updates).
2. **De-duplicate the provider stateful base.** Extract a `StatefulProvider` base class for the queue/flush/idempotency machinery so the four copies converge to one tested implementation.
3. **Unify provider traits into one source of truth.** Reconcile `KIND_TRAITS` with `getCapabilities()` and add a post-instantiation capability check in registry preflight.
4. **Tighten and de-version the `Provider` interface.** Promote the storage-lifecycle methods to mandatory (or formalize a versioned capability gate), rename/retire the misleading `stateVector()`, and make `storageCursor()` canonical.
5. **Reduce the `DocumentLifecycleSystem` dual-path duplication** by extracting shared, type-safe helpers (provider role-ordering/attach, deferred-hydration scheduling) without collapsing the two semantically-distinct paths.
6. **Make `TauriFileProvider` either implemented or unregistered.** A registered-but-throwing provider kind is a production trap; production-path fix is to wire the sidecar IPC, not to leave the stub selectable.
7. **Bound the proof registry and standardize provider observability.** Auto-prune proofs; route provider degradation through one tagged diagnostic channel; clarify `_appendActive` semantics (split "ever active" from "currently active").

All are production-path: they close races, remove duplication that invites divergence, and strengthen the contracts every consumer compiles and runs against. None reduce scope or add shims.

## Production-path contracts and invariants to preserve or strengthen

- **Pure-machine / side-effect-system split.** `document-lifecycle-machine.ts` stays I/O-free and types-only; all async stays in `DocumentLifecycleSystem` actors injected via `machine.provide()`. Extractions in objective 5 must not move I/O into the machine.
- **DISPOSE from any state; idempotent TRAP; RECOVER only from error.** The teardown and trap-recovery topology (`README.md:76-83`; machine guards) is load-bearing and must be preserved exactly.
- **`RustDocument` is orchestrator-only.** No persistence logic moves back into `RustDocument`; provider FIFO order, no-reentrancy, and back-pressure (the contract header at `rust-document.ts:2-36`) are preserved or strengthened, never relaxed.
- **`Provider` queue invariants.** `appendUpdate` is FIFO, synchronous, never concurrent; `attach` fully replays before returning; `flushSync` starts the durable write synchronously (no `await` before the first `put`) and must not throw — it sets `flushFailed`, read by the shell `beforeunload` handler. The `StatefulProvider` extraction must keep these byte-for-byte; the provider conformance suite (`providers/__tests__/conformance.ts`, `provider-conformance.test.ts`) is the gate.
- **Baseline causality.** The initial provider baseline is captured before live edits (`rust-document.ts:413-432`) so later mutations' Yrs client-clock causality holds; promotion/atomicity changes (objective 1) must not reorder baseline vs. live edits.
- **Apply-before-emit in `StateMirror`.** `MutationResultHandler` calls `mirror.apply(result)` before emitting events (`state-mirror.ts:24-28`); re-renders triggered by emit must observe post-mutation state. Pinned by `__tests__/state-mirror.test.ts` / `mirror-coverage.test.ts`.
- **Host-backed determinism and fail-closed.** No ambient/global reads on the host path (`host-runtime-transport.ts:45-89`, `validate-host-context.ts`); import bytes only via validated resolvers with nonce-consumed-before-materialization and `contentIdentityVerified` enforced at runtime (`host-import-source.ts:255-331`); export/share/delete/destroy stay nonce-single-use and expiry-checked (`host-operation-gate.ts:246-436`).
- **WriteGate phase mapping.** `PHASE_TO_GATE_MODE` and the bypass-depth counter (replay/import run under bypass) stay the single authority for mutation admission; objective 1's promotion fix should make the orchestrator queue check *consult* the gate rather than duplicate it.
- **Legacy boundary.** The rejections proven by `legacy-bypass-guards.test.ts` / `legacy-path-inventory.test.ts` (browser rejects `providers`/`yrsState`/`initialSnapshot`; headless allows `yrsState`/`initialSnapshot`) remain enforced after the dual-path de-duplication.
- **Collab R1 bypass preserved.** The ws-sidecar's direct `computeBridge.syncApply` channel (outside the provider lifecycle) is an intentional R1 contract owned by plan 011; nothing here removes or reroutes it.

## Concrete implementation plan

**Phase 1 — Close the inbound-origin race (`rust-document.ts`).**
- Hoist the dynamic `import('./providers/bridge-provider-doc')` out of `applyProviderUpdate` so the apply body no longer yields between origin-set and `applyUpdate` (resolve the module once, lazily, at construction or first inbound update and cache it). Then bind the origin to the specific apply rather than a shared field: pass `origin` explicitly into the bridge apply path so the synchronous `subscribeUpdateV1` callback reads a per-call value, not `this._currentUpdateOrigin`. If the engine callback cannot carry a parameter, serialize inbound applies through the same microtask FIFO the orchestrator already uses for outbound drain (a single `applyChain` promise), guaranteeing one origin is live at a time. Pin with a regression test that interleaves two concurrent `applyProviderUpdate` calls and asserts correct per-update origin tagging.

**Phase 2 — Make import-initialize promotion atomic (`rust-document.ts`).**
- Replace the queue-length re-check with a gate-anchored barrier: before promotion, enter `WriteGate.checkpointing` (or assert it is already entered), drain the queue to empty *under* the gate, then promote staged → live providers, then leave. The orchestrator's own queue check becomes an assertion that the gate already blocks public mutations, removing the orthogonal second source of truth. Extend `__tests__/close-checkpoint.test.ts` / `rust-document-orchestrator.test.ts` with a test that enqueues an update mid-promotion and asserts it is either drained-before or deferred-after, never interleaved.

**Phase 3 — Extract `StatefulProvider` base (`providers/`).**
- Introduce an abstract base owning `pendingUpdates`, `flushing`, `detached`, `attached`, `_flushFailed`, a default `appendUpdate`, a template-method `flushSync`/`detach`, and the `attach` idempotency pre-checks, with `abstract runFlush()`/`runFlushSync()` for the durable specifics. Migrate `memory-provider.ts`, `filesystem-provider.ts`, `object-store-provider.ts`, `database-log-provider.ts` (and `test-provider.ts`, which subclasses memory). Run the existing provider conformance suite unchanged as the equivalence gate.

**Phase 4 — One source of truth for provider traits (`composition-validator.ts`, `registry.ts`, `provider.ts`).**
- Derive `KIND_TRAITS` (or its `durable`/`writable`/role data) from the same capability presets providers report, and add a post-instantiation step in `registry.preflight` that asserts each instantiated provider's `getCapabilities()` matches its declared kind traits, surfacing a composition violation on drift. Introduce capability presets (`DURABLE_WRITABLE`, `READ_ONLY`, `EPHEMERAL`) to collapse the per-provider boolean boilerplate.

**Phase 5 — Tighten the `Provider` interface (`provider.ts` + all providers).**
- Make `getCapabilities()` and `getIdentity()` mandatory (every in-tree provider already implements them); rename `stateVector()` to `storageCursor()` as the canonical mandatory method and drop the misleading alias, updating `index.ts`/`providers/index.ts` re-exports and the `@deprecated` sites. This removes per-consumer presence-branching. Coordinate the type change with `@mog-sdk/types-document` if the interface is mirrored there (cross-folder dependency — see below).

**Phase 6 — De-duplicate `DocumentLifecycleSystem` (`document-lifecycle-system.ts`).**
- Extract a `ProviderAttachment` helper (role-ordering + sorted attach loop + default-sheet logic) consumed by both host and legacy branches, and a `DeferredHydrationScheduler` (timer + cancellation token + promise chain, currently ~`879-977`). Keep the two branches' *policy* distinct; only the mechanical, identical sub-steps are shared. The actor `input` shapes stay strongly typed; the helpers take explicit params, not the actor context.

**Phase 7 — `TauriFileProvider` (`tauri-file-provider.ts`).**
- Wire the native sidecar IPC commands the stub awaits (load/append/checkpoint/flush over the Tauri transport), bringing it to provider-conformance parity with the filesystem provider. If the desktop sidecar contract is not yet available, the production-path interim is to **unregister the kind from the factory registry** so it cannot be selected and fail at runtime — never leave a selectable throwing stub. (See blocked-evidence note below; investigation first.)

**Phase 8 — Bound proofs + standardize observability.**
- In `high-water-mark-registry.ts`, call `pruneExpired()` at issue-time (and/or on validate) so the `Map` cannot grow unbounded; document the single-use/expiry semantics on the public methods. Introduce a small provider diagnostic helper (provider-name + operation + level) and route the IndexedDB/filesystem/memory degradation paths through it consistently. Split `_appendActive` into `_hasEverAppended` (latched telemetry) and a live `isAppendActive()` derived from attached-provider count, and update the `__dt` hatch accordingly.

**Phase 9 — README + barrel truth-up.**
- Update `README.md` (the architecture diagram still describes RustDocument as owning IndexedDB persistence and "30s idle debounce / 100 mutation threshold" auto-save at `:43-53`, which contradicts the orchestrator-only model where providers own coalescing and there is no orchestrator-level debounce). Reflect the provider fan-out model, the host-backed vs. legacy paths, and the collab R1 bypass.

## Tests and verification gates

- **Provider conformance is the primary equivalence gate.** `providers/__tests__/conformance.ts`, `provider-conformance.test.ts`, `in-memory-provider.test.ts`, `indexeddb-provider.test.ts`, `filesystem-provider.test.ts`, `host-callback-provider.test.ts`, `read-only-snapshot-provider.test.ts`, `redacted-published-snapshot-provider.test.ts` must pass unchanged after Phases 3–5 (refactors, not behavior changes).
- **Orchestrator/lifecycle suites:** `rust-document-orchestrator.test.ts`, `inbound-updates.test.ts`, `close-checkpoint.test.ts`, `lifecycle-conformance.test.ts`, `lifecycle-machine-trap.test.ts`, `composition-conformance.test.ts`, `deferred-hydration-scheduler.test.ts` gate Phases 1, 2, 6.
- **New regression tests (added under `__tests__`):** (a) concurrent `applyProviderUpdate` origin-tagging (Phase 1); (b) enqueue-during-import-promotion atomicity (Phase 2); (c) registry preflight capability-mismatch rejection (Phase 4); (d) proof-registry prune-on-issue bound (Phase 8).
- **Boundary guards must stay green:** `legacy-bypass-guards.test.ts`, `legacy-path-inventory.test.ts`, `host-no-globals-sentinel.test.ts`, `write-gate-enforcement.test.ts`, `host-operation-gate*.test.ts`, `host-storage-preflight.test.ts`, `host-import-source.test.ts`, `validate-host-context` coverage, `state-mirror.test.ts` / `mirror-coverage.test.ts`.
- **Static gates:** kernel typecheck and the ESLint import-boundary rules (no new imports from `api/`, `services/`, etc.); if Phase 5 touches a mirrored interface, the contracts/types-document declaration rollup must be rebuilt (cross-folder, see dependencies). *(Per task constraints, this plan does not itself run build/test/typecheck; these gates are the acceptance criteria for the implementing change.)*

## Risks, edge cases, and non-goals

- **Risk — interface change blast radius (Phase 5).** Making `Provider` methods mandatory and renaming `stateVector()` ripples to every provider and any `@mog-sdk/types-document` mirror and external SDK adapter (`sdk-storage-adapter.ts`). Mitigate by landing the additive presets/derivation (Phases 3–4) first, then the rename behind a single coordinated commit with the type package.
- **Risk — origin/promotion fixes altering causality (Phases 1–2).** Serializing inbound applies or gating promotion must not reorder baseline-before-live-edits; guard with the causality-sensitive orchestrator tests and an explicit baseline-ordering assertion.
- **Edge case — `flushSync` synchronicity (Phase 3).** The base-class template must not introduce any `await` between method entry and the first durable `put`/`writeFileSync`; the unload-handler contract depends on it. Conformance covers this but review manually.
- **Edge case — `onblocked`/migration during refactor (Phase 3/4).** Don't disturb the IndexedDB v1→v2 migration and Web Locks promotion logic; they are correct today and orthogonal to the base-class extraction.
- **Non-goals:** changing the collab sync channel (plan 011); altering the pure machine's state topology; introducing orchestrator-level auto-save (providers own coalescing); reworking the host authorization model (gates are sound — only proof-store bounding and observability are touched); any test-only or shim "fix" for the Tauri stub instead of wiring or unregistering it.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Phase 1 (origin race), Phase 2 (promotion atomicity), Phase 8 (proofs/observability), and Phase 9 (README) touch disjoint files and can proceed concurrently.
- **Sequential within `providers/`:** Phase 3 (base class) → Phase 4 (trait reconciliation) → Phase 5 (interface tightening) should land in order; each builds on the prior and shares the conformance gate.
- **Cross-folder dependencies:**
  - **`@mog-sdk/types-document` / `@mog-sdk/contracts`** — Phase 5's interface change and the `ProviderInboundUpdateEnvelope` type may be mirrored there; per memory [[mog-contracts-declaration-rollup]], editing shared types requires `pnpm --filter @mog-sdk/contracts build` before consumers typecheck. Coordinate with the contracts plans (001/002) and types plans (005–007).
  - **`bridges/compute/` (`ComputeBridge`)** — Phase 1's hoisting of `createBridgeBackedProviderDoc` and any per-call origin plumbing must align with the bridge's `subscribeUpdateV1` signature; coordinate with plan **012 (`012-kernel-src-bridges-compute`)**.
  - **`collab/` (plan 011)** — read-only dependency: Phases here must preserve the R1 direct-`syncApply` bypass; if Phase 5 changes the `Provider` interface, confirm the future R2 `WebSocketProvider` direction in plan 011 is not contradicted.
  - **`api/app/` and shell/SDK facades** — consume `DocumentLifecycleSystem` and the provider barrel; Phase 6 extractions are internal and should not change their import surface, but the legacy-rejection guards they rely on must stay enforced (validated by the inventory tests above).
