# Improve `mog/kernel/src/document`

## Source folder and scope

Public source folder reviewed: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/document`

Queue item 10 covers document lifecycle, providers, persistence, and ownership in the public Mog source tree. The direct folder includes the XState document lifecycle machine, `DocumentLifecycleSystem`, the `RustDocument` provider orchestrator, host-backed storage/import/operation gates, write gates, high-water-mark proof utilities, state mirror support, storage providers, and collaboration sidecars.

In scope:

- `document-lifecycle-machine.ts` and `document-lifecycle-system.ts`
- `rust-document.ts`
- `providers/*`
- `write-gate.ts`, `high-water-mark-registry.ts`, `host-operation-gate.ts`
- `host-storage-preflight.ts`, `host-import-source.ts`, `host-runtime-transport.ts`, `validate-host-context.ts`
- `state-mirror.ts`
- `collab/*`
- Existing tests under `document/__tests__`, `document/providers/__tests__`, and `document/collab/__tests__`

Adjacent production paths that must stay in lockstep:

- `kernel/src/api/document/document-factory.ts`, `kernel/src/api/document/mog-document-impl.ts`, and public SDK conformance tests
- `kernel/src/context/kernel-context.ts` and `kernel/src/context/types.ts`
- `kernel/src/bridges/compute/compute-core.ts` and `kernel/src/bridges/compute/compute-bridge.ts`
- `kernel/src/api/workbook/workbook-impl.ts` save/export/close paths
- `runtime/sdk/src/boot.ts` and host adapters
- `apps/spreadsheet/src/infra/context/document-context.tsx`, `apps/spreadsheet/src/index.tsx`, and active-sheet/import durability wiring
- Contract packages for document storage, host lifecycle input, provider configs, and high-water-mark proofs

Out of scope for this folder: Rust compute/Yrs implementation details, browser UI chrome, public marketing/docs, and private/internal planning assets. Those are dependencies or consumers, not ownership of this folder.

## Current role of this folder in Mog

`mog/kernel/src/document` is the kernel document session spine. It turns a document creation request into a live `DocumentContext`, Rust compute bridge, provider-backed storage session, mutation admission gate, host authorization boundary, import durability barrier, and cleanup lifecycle.

The current architecture has strong foundations:

- `document-lifecycle-machine.ts` is a pure XState v5 machine with states `idle -> creating -> wiring -> starting -> hydrating/hydrating_csv -> attaching -> ready`, plus `error`, `disposing`, and `disposed`. Side effects are provided by `DocumentLifecycleSystem`.
- `DocumentLifecycleSystem` owns the actor and all effectful actors: engine creation, context wiring, bridge start, provider attach, import hydration, deferred import durability, and disposal.
- `RustDocument` is the sole document orchestrator over the Rust compute engine's `update_v1` stream. It subscribes once, fans out to N `Provider` sinks, preserves FIFO ordering, suppresses replay echo, handles import-initialize staging, and exposes checkpoint/close/unload semantics.
- `providers/provider.ts` defines the storage provider protocol. Implementations include IndexedDB, memory, filesystem, object-store, database-log, host-callback, read-only snapshot, redacted published snapshot, Tauri-file, test, and SDK adapter providers.
- Host-backed document creation explicitly maps host runtime config to transport config, preflights storage handoffs, materializes authorized providers, validates source-handle imports, projects principals, and installs a host operation gate.
- `WriteGate`, `HighWaterMarkProofRegistry`, and host operation gates provide mutation admission and export/delete/share/destroy authorization hooks.
- `StateMirror` gives synchronous read projections for selected workbook/sheet state after mutation results and hydration settlement.
- Collaboration sidecars currently live under `document/collab`, including event logging, wire codec, websocket sidecar, and E2E tests.

The main weakness is that the strongest contracts are spread across comments, local state fields, provider-specific implementations, and adjacent consumers. The production path is feature-rich, but ownership boundaries are harder to verify than they need to be. The improvement should make lifecycle phase, storage state, provider identity, mutation watermark, import durability, and host authorization contracts explicit and executable.

## Improvement objectives

1. Make document lifecycle state, storage phase, write-gate mode, and public handle status one coherent typed contract instead of parallel mappings.
2. Centralize provider identity and provider attachment ownership so every path uses `providerRefId` consistently, not implementation `name` where durable identity is required.
3. Tie high-water-mark advancement and export proof validation to the actual production mutation/export path.
4. Split `DocumentLifecycleSystem` side effects into narrow orchestration modules without changing the pure machine contract or adding shortcuts.
5. Make import durability a first-class state machine sub-contract covering XLSX, CSV, host-backed browser deferral, SDK immediate materialization, close/dispose barriers, and provider promotion.
6. Strengthen provider conformance around checkpoint, `flushSync`, read-only, import-initialize, identity, capabilities, and inbound update behavior for every provider kind.
7. Fail closed on host-backed storage, source-handle, materializer, principal, and operation-gate mismatches, with diagnostics that distinguish success from denial/failure.
8. Clarify local cleanup versus destructive host/document management operations so `dispose()`, `close()`, `destroy()`, and host `authorizeDestroy()` cannot be confused.
9. Move collaboration sidecar attachment into the same provider/lifecycle ownership model or explicitly fence it as a separate, tested sidecar with no hidden provider bypass.
10. Keep all improvements on the production document creation, import, save, close, export, and SDK paths.

## Production-path contracts and invariants to preserve or strengthen

- `RustDocument` remains the only document implementation. No TypeScript document store should be introduced.
- The Rust compute engine and Yrs document remain the authoritative workbook state; providers persist, replay, or forward `update_v1` bytes and full-state checkpoints.
- The lifecycle machine stays pure. Async work, imports, globals, host bindings, bridge calls, provider attach, and cleanup remain in supplied actors.
- Provider attach must run after bridge `STARTED` and after `DocumentContext` wiring. Provider replay calls `ComputeBridge.syncApply`, which requires a real context and write-gate bypass.
- Sheet truth is post-attach truth. Default sheet creation must happen only after provider replay/import hydration confirms no sheets exist.
- Import hydration for XLSX/CSV may defer heavy Yrs durability in browser first-paint paths, but `awaitImportDurability()`, `awaitMaterialized()`, SDK `createWorkbook()`, `close()`, and `dispose()` must promote or await the barrier before reporting completion.
- Import-initialize providers must stage, suppress live append leakage, checkpoint full state snapshot-only, reject read-only promotion, then atomically promote to live providers.
- `appendUpdate` fan-out remains synchronous, FIFO, non-reentrant, and backpressure-tolerant. Provider contract violations should not block other providers from receiving updates.
- Provider replay, source-handle import hydration, and import-initialize full-state checkpoint are system operations; they may bypass write admission, but closed documents must reject even bypassed writes.
- Public mutations must be rejected while checkpointing, closing, closed, read-only, or error phases require it. Bypass scopes must be visible and nest safely.
- High-water-mark proofs must be issued from the same watermark source advanced by successful production mutations and must fail validation if the document mutates before export authorization.
- Host-backed lifecycle must not read legacy fields, runtime globals, raw provider arrays, raw source bytes, `initialSnapshot`, `yrsState`, `window.__TAURI__`, `indexedDB`, `process`, or ambient devtools surfaces.
- Legacy/cooperative lifecycle may use runtime detection where existing app paths still require it, but this must be fenced away from host-backed construction.
- Provider composition must be deterministic: authority before cache before replica/snapshot/export sinks, with required durable providers failing closed when unavailable.
- Provider identity for durable storage, inbound updates, checkpoint reporting, diagnostics, and host authorization must be stable `providerRefId`; implementation `name` is diagnostic only unless explicitly equal by contract.
- IndexedDB persistence must preserve v1-to-v2 migration, snapshot-before-log replay, log sequence ordering, compaction watermarks, unload-safe `flushSync`, eviction rules, Web Lock read-only promotion, and meta API separation.
- `touchDoc()` remains best-effort and only for user-visible documents; internal/fallback docs must not become `lastActiveDocId`.
- Host source-handle imports must consume replay nonce before materialization and verify content identity before bytes reach the document.
- Operation-gated export/share/delete/destroy must consume host authorization nonces before materialization or management effects.
- Local `dispose()` remains local resource cleanup. It must not imply all-storage deletion and must not require host destructive-operation authorization.
- `StateMirror` remains a bounded synchronous read model populated from production mutation results and settlement calls; it must not become an alternate persistence source.
- Collaboration sidecars must not bypass storage/provider invariants without an explicit ownership contract and tests.

## Concrete implementation plan

1. Define a canonical document session lifecycle contract.

   - Add a typed mapping module for machine state, storage phase, public status, and write-gate mode. Replace duplicated `PHASE_TO_GATE_MODE` maps in `document-lifecycle-system.ts` and `write-gate.ts` with one source-owned table.
   - Model lifecycle transitions as `{ machineState, storagePhase, gateMode, publicStatus }` rows and add exhaustiveness tests so adding a machine state requires updating storage/write-gate/public mappings.
   - Make `DocumentStorageState` updates flow through a small reducer that records phase, durability, read-only, pending update count, last checkpoint time, last sync time, degraded providers, and errors in one place.
   - Keep XState as the lifecycle driver; do not replace the machine with ad hoc booleans.

2. Split `DocumentLifecycleSystem` into production orchestration modules.

   - Extract `createEngine` logic into a `document-engine-orchestrator.ts` module with separate host-backed and legacy builders.
   - Extract provider attach/preflight/materializer logic into `document-storage-orchestrator.ts`.
   - Extract import hydration and deferred durability into `document-import-durability.ts`.
   - Extract host operation/source validation integration into `document-host-orchestrator.ts` or similarly narrow modules.
   - Preserve constructor-complete behavior and actor `provide()` wiring; the class should become an integrator around typed actor dependencies, not a 2,200-line owner of every decision.
   - Add focused unit tests for each extracted module and lifecycle integration tests for the actor chain.

3. Normalize provider identity everywhere.

   - Introduce a required helper `getProviderRefId(provider)` that uses `provider.getIdentity().providerRefId` when present and fails or explicitly falls back only where legacy tests still require it.
   - Change inbound update matching in `RustDocument.applyProviderUpdate()` from `p.name === envelope.providerRefId` to stable provider identity matching.
   - Store provider epochs, checkpoint results, detached provider IDs, import-initialize provider refs, and diagnostics by `providerRefId`.
   - Update provider conformance tests so every provider reports identity and round-trips inbound/ref diagnostics through the same ID.
   - Keep `Provider.name` for human-readable logging only.

4. Make high-water-mark truth production-owned.

   - Advance the document `WriteGate` watermark on successful production mutations in the unified compute mutation path, after the backend mutation succeeds and before any export proof can observe the state. Coordinate with `kernel/src/bridges/compute/compute-core.ts`.
   - Decide whether provider replay/import hydration should advance the public mutation watermark or be represented through provider-origin watermarks only; encode that distinction in `WriteGate.captureHighWaterMark()`.
   - Fix proof validation so `HostOperationGate.authorizeExport()` passes the current high-water-mark snapshot into `HighWaterMarkProofRegistry.consumeProof()` or equivalent validation. The current code computes a current snapshot but the validation path must actually compare it.
   - Add tests proving export authorization fails after a mutation advances the watermark, while immediate proof issuance/consumption without intervening mutation succeeds.
   - Replace any placeholder `documentHighWaterMark` payloads on production export with registry-issued proofs or a documented live-kernel proof contract backed by the same watermark source.

5. Promote import durability into an explicit sub-state machine.

   - Model import durability states such as `notImport`, `hydratedPendingDurability`, `scheduled`, `establishingDurability`, `durable`, `failed`, and `skippedEphemeral`.
   - Make `scheduleDeferredHydration()`, `ensureDeferredHydration()`, `awaitImportDurability()`, `awaitMaterialized()`, `completeImportDurability()`, and `dispose()` consume that state rather than coordinating through multiple booleans and timer handles.
   - Preserve the host-backed browser grace period, but prove explicit barriers start the scheduled job immediately.
   - Add contract tests for XLSX and CSV imports with provider-backed, host-backed browser, headless SDK, read-only provider, checkpoint failure, dispose-before-timer, and duplicate `awaitImportDurability()` calls.
   - Ensure failed durability leaves a structured error in `storageState` and fails closed for host-backed durable imports.

6. Strengthen provider protocol conformance.

   - Extend `providers/__tests__/conformance.ts` to require identity, capabilities, storage cursor semantics, read-only behavior, import-initialize attach/checkpoint behavior, `checkpointFullState` result semantics, and detach-after-blocked behavior for all providers that can support them.
   - Add a provider conformance matrix test that enumerates every exported provider factory from `providers/index.ts` and asserts it is either covered or intentionally exempt with a reason.
   - Ensure all providers implement `getIdentity()` and `getCapabilities()` directly rather than relying on optional interface escape hatches.
   - Keep `stateVector()` compatibility only as a deprecated adapter; production diagnostic cursor reads should use `storageCursor()`.
   - Add failure-injection tests for required provider attach, flush, checkpoint, detach, and factory failures through `StorageProviderRegistry.preflight()` and lifecycle attach, not only provider-local tests.

7. Consolidate storage preflight and provider registry paths.

   - Remove the conceptual fork where host-backed materializer handles and registry-backed providers run similar but separate preflight/ordering/fail-closed rules.
   - Define a normalized `MaterializedStorageProvider` shape that can wrap either a host materializer handle or a local registry-created provider.
   - Run the same composition, required-provider, read-only fallback, ordering, and storage-state update logic over the normalized shape.
   - Preserve host fail-closed behavior and nonce/materializer validation. Do not degrade durable host storage to zero-provider mode.
   - Add tests for mixed authorized providers, missing materializer, result mismatch, no registered factory, optional provider factory failure, required provider factory failure, read-only fallback, and ephemeral zero-provider.

8. Clean up host diagnostics and operation-gate semantics.

   - Audit diagnostics emitted by `host-storage-preflight.ts`, `host-import-source.ts`, and `host-operation-gate.ts`. Success events should use semantically correct success/info kinds if host contracts provide them; denial/failure kinds should only describe denial/failure.
   - Include correlation IDs from the authoritative host/session context instead of empty strings or local placeholders where available.
   - Ensure source-handle success, preflight success, and operation authorization success are distinguishable from denials in host diagnostics tests.
   - Keep `NO_HOST_OPERATION_GATE` as the legacy sentinel and assert that host-backed contexts always install a real gate before handles/workbooks are returned.

9. Clarify close, dispose, destroy, and save ownership.

   - Document and enforce four separate operations:
     - `flushSync()`: unload synchronous-start durability hint.
     - `checkpoint()/checkpointStructured()`: durability barrier while session stays open.
     - `close()`: final checkpoint plus provider detach and closed write gate.
     - `dispose()`: local lifecycle teardown, awaiting import durability and cleaning bridge/context resources.
   - Ensure `DocumentHandle.close()` and SDK/public `MogDocument.close()` return structured close results without double-closing providers or hiding checkpoint failures.
   - Ensure `Workbook.close('save')` and document-handle close semantics are aligned or explicitly separated; workbook `dispose()` should not silently replace a storage close when the user asked to save.
   - Add integration tests for close-after-import-pending, close-after-provider-failure, close-with-no-provider, double-close, dispose-before-ready, dispose-from-error, and dispose during each machine state.

10. Fence or integrate collaboration sidecars.

   - Decide whether websocket collaboration is a `Provider` implementation or an explicitly separate sidecar. The current inventory marks shell collab option as a known gap outside provider registry.
   - If it is a provider, implement it through the provider registry and conformance suite so inbound/outbound updates, identity, epochs, echo suppression, and checkpoints share `RustDocument` contracts.
   - If it remains a sidecar, add a lifecycle-owned sidecar registry with explicit attach/detach ordering, diagnostics, and tests proving it cannot bypass provider identity or write-gate rules.
   - Keep `collab/ws-sidecar.ts` E2E convergence tests, but add document lifecycle integration coverage for attach during create, dispose, reconnect, late join, and provider-backed local persistence.

11. Expand state mirror ownership checks.

   - Keep `StateMirror` as the sync read view for bounded workbook/sheet state.
   - Add integration tests that provider replay, default-sheet creation, XLSX deferred hydration, CSV import, and host-backed imports all seed the mirror before first public workbook reads.
   - Keep the drift guard in `mirror-coverage.test.ts`, but add production-path tests through `DocumentFactory` or `DocumentLifecycleSystem` rather than only direct mirror application.
   - Ensure mirror settlement failures are surfaced in diagnostics/storage state if they can affect first paint, instead of only logged.

12. Update public exports intentionally.

   - Review `document/index.ts` and `kernel/src/storage/index.ts` so public lifecycle/storage surfaces expose contracts, not internal escape hatches.
   - Keep `RustDocument`, lifecycle machine types, and devtools provider enumeration internal to kernel unless they are deliberately public today.
   - Add package boundary tests to prevent external consumers from deep-importing provider internals except through the intended storage/lifecycle entrypoints.

## Tests and verification gates

No commands should be run for this planning-only queue task. For the future implementation, run the relevant production gates below.

Focused kernel document tests:

- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/lifecycle-conformance.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/host-integration.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/host-storage-preflight.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/host-operation-gate.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/host-operation-gate-wiring.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/host-import-source.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/host-no-globals-sentinel.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/rust-document-orchestrator.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/inbound-updates.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/close-checkpoint.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/write-gate.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/write-gate-enforcement.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/high-water-mark-registry.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/state-mirror.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/mirror-coverage.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/__tests__/deferred-hydration-scheduler.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/providers/__tests__/provider-conformance.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/providers/__tests__/indexeddb-provider.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/document/collab/__tests__/collab-e2e.test.ts`

Broader kernel and SDK gates:

- `cd mog && pnpm --filter @mog-sdk/kernel test`
- `cd mog && pnpm --filter @mog-sdk/kernel typecheck`
- `cd mog && pnpm --filter @mog-sdk/node test` or the current SDK package gate that covers `runtime/sdk/src/boot.ts`
- `cd mog && pnpm typecheck` after TypeScript public contract or cross-package changes

Behavioral verification:

- Browser app: start the dev server, create a fresh document, edit, reload, confirm IndexedDB replay and active-sheet selection.
- Browser app: import XLSX and CSV files, verify first paint, deferred hydration completion, close-before-timer durability, and reload persistence.
- Browser app: simulate two tabs on the same doc and verify Web Lock read-only behavior and promotion.
- SDK/headless: create blank, import XLSX, call `awaitImportDurability()`, read workbook state, save/export, and close.
- Host-backed/headless: create/import through `createHostBackedDocument` / `importHostBackedDocument`, prove no legacy globals are read, storage handoff is preflighted, operation gates authorize export, and provider materializers attach.
- Failure paths: quota/IDB failure, provider attach/checkpoint/detach failure, materializer mismatch, source-handle replay, export proof replay, mutation-after-proof, and dispose from every lifecycle state.

If a narrower gate is used instead of repo-wide typecheck, record the rationale and list the exact type and behavior gates that ran.

## Risks, edge cases, and non-goals

Risks:

- `DocumentLifecycleSystem` has many carefully ordered side effects. Extracting modules without executable transition tests could change timing around bridge start, provider replay, mirror settlement, or deferred import durability.
- Provider identity changes can break inbound update echo suppression or host diagnostics if any provider currently relies on `name` matching. Migrate with tests across every provider implementation.
- High-water-mark fixes touch adjacent compute mutation and export paths. The correct fix is to wire the production mutation path, not to increment counters in tests.
- Import durability failures are currently partly boolean/timer driven. Making them explicit may expose previously hidden close/dispose errors.
- IndexedDB migration, compaction, Web Locks, and unload semantics are browser-sensitive; jsdom-only tests are not enough for final confidence.
- Host-backed diagnostics may require host type changes if there is no success/info diagnostic kind today. Coordinate with `@mog-sdk/types-host` instead of overloading denial kinds.
- Collaboration sidecar behavior is already covered by network E2E tests but may not be lifecycle-owned. Integrating it into provider/lifecycle contracts could reveal architectural mismatches that need a dedicated sub-plan.

Edge cases to include:

- Fresh blank browser doc with no providers, with IndexedDB provider, and with internal fallback doc.
- Persisted doc replay where provider bytes create sheets before default-sheet fallback.
- XLSX/CSV import with provider-backed import-initialize staging and no subsequent user edits.
- XLSX/CSV import where close/dispose happens before deferred hydration timer fires.
- Read-only provider attach for normal open and import-initialize open.
- Provider replay emits updates while attach is in progress; they must not echo back to providers.
- Inbound provider update duplicates, stale epochs, unknown provider refs, unsupported payload kinds, and local mutation after inbound update.
- Multiple providers with one slow/failing flush/checkpoint/detach.
- Web Lock read-only tab promotion after primary tab detach.
- Host storage with authorized provider metadata mismatches by ref, kind, role, authority, scope, or fingerprint.
- Source-handle import with expired, wrong-principal, wrong-session, wrong-host, missing resolver, unverified identity, byte mismatch, and replayed nonce.
- Export proof consumed twice and export proof invalidated by mutation after issuance.
- Dispose from `creating`, `wiring`, `starting`, `hydrating`, `attaching`, `ready`, and `error`.

Non-goals:

- Do not add a TypeScript workbook persistence store.
- Do not optimize test-only or benchmark-only paths.
- Do not silently fall back from host-backed durable storage to legacy IndexedDB or zero-provider mode.
- Do not add compatibility shims for raw source bytes, raw provider arrays, `initialSnapshot`, or `yrsState` on host-backed handles.
- Do not treat local `dispose()` as destructive all-storage deletion.
- Do not move Rust compute/Yrs state ownership into kernel TypeScript.
- Do not leak internal planning or private host details into the public `mog` repo.

## Parallelization notes and dependencies on other folders, if any

This work should be split across parallel agents after the lifecycle/storage contract table is agreed:

- Agent A: lifecycle/storage/write-gate mapping and `DocumentStorageState` reducer in `kernel/src/document`.
- Agent B: `DocumentLifecycleSystem` extraction into engine, storage, import durability, and host orchestrator modules.
- Agent C: provider identity normalization and provider conformance expansion across `kernel/src/document/providers`.
- Agent D: high-water-mark production wiring across `kernel/src/document`, `kernel/src/bridges/compute`, and `kernel/src/api/workbook` export paths.
- Agent E: host storage/source/operation diagnostics and fail-closed tests across `kernel/src/document` and `types-host` contracts if needed.
- Agent F: import durability state machine and SDK/browser integration tests.
- Agent G: collaboration sidecar ownership decision and lifecycle/provider integration tests.
- Agent H: state mirror production-path seeding tests and first-paint/replay coverage.

Dependencies:

- The canonical lifecycle/storage/write-gate table should land before broad extraction, so extracted modules share one transition contract.
- High-water-mark production truth depends on `kernel/src/bridges/compute/compute-core.ts` because mutation success is observed there.
- Export proof correctness depends on `kernel/src/api/workbook/workbook-impl.ts` and host operation contracts.
- Host diagnostics cleanup may require changes in `@mog-sdk/types-host/diagnostics`.
- Provider identity normalization depends on every provider reporting `getIdentity()` consistently.
- SDK/headless import verification depends on `runtime/sdk/src/boot.ts`.
- Browser first-paint/import verification depends on spreadsheet app call sites that schedule deferred hydration and active-sheet resolution.
