# Plan 012: Kernel Compute Bridge Boundary Improvements

## Source folder and scope

Source folder reviewed: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/bridges/compute`

Queue item 12 covers the public kernel-to-compute integration boundary. This folder is the TypeScript side of the production path between kernel APIs, document lifecycle, viewport buffers, provider sync, and the Rust compute engine through WASM/NAPI/Tauri transports.

Files in scope:

- `compute-bridge.ts`: public `ComputeBridge` composition root, generated-method subclass, manual overrides, provider update dispatch, security session wrappers, sheet/object/comment/schema adapters, and convenience methods.
- `compute-core.ts`: per-document compute state holder for lifecycle, write gate, trap observability, mutation pipeline, viewport refresh policy, sync protocol, schema push, active-cell cache, undo/redo, and error recovery.
- `viewport-fetch-manager.ts`: viewport movement pipeline for scroll, resize, sheet switch, prefetch, delta fetch, force refresh, and per-viewport accessor state.
- `types.ts`: hand-written leaf wire type module for Rust serde JSON shapes.
- `compute-wire-types.ts`: backward-compatible wire type barrel plus generated-type-dependent branded helpers.
- `compute-wire-converters.ts`: identity formula, table, and filter criteria conversion between Rust wire and TypeScript contracts.
- `floating-object-mapper.ts`, `floating-object-geometry-normalization.ts`, and `chart-import-normalization.ts`: bridge-local object/chart import and storage adapters.
- `errors.ts`: compute-local trapped-module error.
- `compute-bridge.gen.ts`, `compute-types.gen.ts`, and `manifest.gen.ts`: generated bridge methods, generated Rust domain types, and generated method-kind manifest. These should stay generated outputs, but their contracts and freshness are in scope.
- `__tests__/*.test.ts`: focused tests for lifecycle cleanup, trap recovery, viewport fetches, sync mutation results, converters, geometry, charts, finite numbers, security session scoping, and viewport sheet switching.

Adjacent production paths that must stay in lockstep:

- `compute/api/src/bridge_service.rs` and `compute/core/src/storage/engine/**`, which own Rust bridge annotations, descriptor groups, command behavior, security scopes, mutation tuple shapes, sync behavior, and generated type sources.
- `infra/rust-bridge/bridge-ts/**`, which emits `compute-bridge.gen.ts`, `compute-types.gen.ts`, and `manifest.gen.ts`.
- `infra/transport/src/**`, which owns `BridgeTransport`, `createTransport`, trap classification, byte tuple normalization, NAPI/WASM/Tauri differences, and command metadata.
- `kernel/src/bridges/wire/**` and `kernel/src/bridges/mutation-result-handler.ts`, which consume binary viewport buffers, mutation patches, and mutation result change sets.
- `kernel/src/document/**`, especially lifecycle, providers, write gate installation, state mirror, Rust document provider flow, and trap recovery integration.
- `kernel/src/domain/**`, `kernel/src/api/**`, `kernel/src/floating-objects/**`, and `kernel/src/services/**`, which call `ComputeBridge` and generated compute types.
- `runtime/sdk/**`, shell trap recovery, and spreadsheet UI viewport wiring, which rely on this bridge's lifecycle, update subscription, and viewport buffer semantics.

Out of scope for the first implementation pass:

- Rewriting Rust compute algorithms unless the TypeScript bridge currently compensates for a Rust boundary bug that must be fixed at the source.
- Adding compatibility shims around broken bridge contracts.
- Editing private/internal content from public code or adding any dependency from `mog` to `mog-internal`.
- Optimizing test-only paths or mocks.

## Current role of this folder in Mog

`kernel/src/bridges/compute` is the highest-risk integration boundary in the TypeScript kernel. It is not only a transport wrapper. It is the production coordinator for:

- creating and destroying per-document Rust compute instances keyed by `docId`;
- enforcing lifecycle phase transitions from `CREATED` through `STARTED` and `DISPOSED`;
- ensuring every write goes through the write gate and unified mutation pipeline;
- applying binary viewport patches before semantic events are emitted;
- forwarding `MutationResult` change sets to `MutationResultHandler` and the state mirror;
- draining Rust Yrs `update_v1` payloads after mutations for provider persistence;
- applying inbound provider/remote sync updates before or after renderer mount;
- tracking hydration deficits when sync updates arrive before viewport coordinators exist;
- observing WASM traps, short-circuiting later calls with `ModuleTrappedError`, and resetting the global WASM module;
- separating mutation patch flow from viewport movement fetch flow;
- translating Rust serde wire shapes into public TypeScript contract shapes for formulas, filters, tables, charts, and floating objects;
- exposing generated compute commands and generated Rust domain types to the rest of the kernel.

The folder already has several strong contracts:

- `types.ts` is explicitly a leaf module so generated files can import wire types without re-entering hand-written bridge code.
- `manifest.gen.ts` captures method kind from Rust `MethodAccess` annotations.
- Generated write methods generally route through `core.mutate(...)`, and generated reads through `core.query(...)` for document-scoped methods.
- `mutateCore()` is the central path for viewport patch application, mutation event delivery, validation annotations, provider update drains, undo cache notification for forward writes, and forced refresh policy.
- `ViewportFetchManager` correctly separates user movement fetches from mutation patches and uses latest-wins sequencing plus coordinator fetch epochs.
- Trap recovery, lifecycle cleanup, viewport fetching, converters, floating object mapping, chart import normalization, and security session scoping have focused tests.

The weaknesses are structural rather than isolated:

- `compute-bridge.ts` has grown into a large manual adapter with many direct `core.transport.call(...)` sites, manual byte-tuple normalization, empty mutation-result synthesis, ad hoc generated-method overrides, and domain-specific compatibility behavior.
- Some manual override categories exist because Rust methods are skipped from TS bridge generation, return non-standard tuple shapes, or need special adapter behavior. Those categories are not represented as a generated contract matrix, so a new method can silently choose the wrong path.
- A few comments describe TypeScript-side workarounds for Rust compute gaps, such as sheet deletion formula `#REF!` recomputation and direct `compute_full_recalc` bypasses after sheet copy.
- Security principal/session methods are still hand-written in `compute-bridge.ts` even though Rust bridge annotations include session-level methods.
- `ComputeCore` owns several independent responsibilities at once: lifecycle, trap state, mutation handling, viewport refresh policy, schema sync, sync protocol, active-cell cache, and bridge infrastructure.
- `compute-wire-types.ts` is a backwards-compat barrel, while `types.ts` is the real leaf source. This is correct today, but it needs an import-cycle and export-surface audit so future generated changes do not pull the leaf upward.
- `floating-object-mapper.ts` and chart import normalization carry broad import repair and compatibility logic. That logic is production-important, but its supported/fallback shapes are not inventoried as a contract.
- The bridge README says the composition root is around 200 lines; the current bridge file is much larger, which means the architecture documentation no longer describes the actual boundary.
- The `sync-mutation-result.test.ts` suite documents an expected Rust-layer failure for remote sync domain-change population. That is a production contract gap crossing this folder and compute-core.

## Improvement objectives

1. Turn the compute bridge from a manually curated adapter into an auditable boundary contract.
2. Make generated bridge metadata the source of truth for method kind, lifecycle phase, doc scoping, mutation tuple shape, provider-update behavior, security/session behavior, and manual override disposition.
3. Systematically remove manual override categories by fixing Rust descriptors, bridge generation, or transport metadata, not by adding more one-off TypeScript methods.
4. Split `ComputeCore` into explicit production services without changing observable behavior: lifecycle/trap state, mutation pipeline, viewport refresh policy, sync/provider updates, schema sync, and active cell cache.
5. Preserve the two independent data-plane pipelines: synchronous mutation patches and asynchronous viewport movement fetches.
6. Strengthen sync/hydration contracts so provider replay, remote collaboration updates, and renderer mount ordering always yield populated state, semantic events, and fresh viewport buffers.
7. Make Rust serde wire type ownership precise: leaf wire types in `types.ts`, generated types in `.gen.ts`, branded helpers in a non-leaf adapter, and no hidden cycles.
8. Promote floating-object and chart import normalization from broad fallback code to enumerated, tested import/storage contracts.
9. Update architecture docs and tests so future bridge additions fail when they bypass lifecycle, write gates, mutation handling, provider update drains, security scopes, or viewport refresh invariants.
10. Keep every improvement on the production path used by kernel, SDK, UI, headless, and transport consumers.

## Production-path contracts and invariants to preserve or strengthen

- Public `mog` code must not depend on `mog-internal`.
- `types.ts` remains the leaf hand-written wire module. It may import external contracts only, never sibling compute modules or generated files.
- Generated files remain generated artifacts. Hand edits to `compute-bridge.gen.ts`, `compute-types.gen.ts`, and `manifest.gen.ts` are not the implementation mechanism.
- `ComputeBridge` remains the public class exposed to kernel consumers, but its hand-written body should be a small composition root plus deliberate adapters.
- Every document-scoped read and write must include the correct `docId` and must fail after `DESTROYING`/`DISPOSED` without hitting the raw transport.
- Every user write must pass through `WriteGate.assertWritable(...)` unless it is explicitly inside a system bypass scope owned by lifecycle/provider code.
- Every mutation returning viewport patches plus `MutationResult` must pass through the unified mutation pipeline before callers observe the result.
- Mutation pipeline ordering remains: await Rust mutation, apply binary viewport patches or mark hydration deficit, force-refresh required derived buffers, update state mirror and emit events, apply validation annotations, refresh CF/geometry/show-formula state, drain provider updates, then resolve to the caller.
- Undo and redo must use mutation post-processing without notifying the undo service as forward user writes.
- Provider update delivery remains mutation-synchronous through `afterMutationHook`/`flushPendingUpdateV1`; polling must not become the primary durability path.
- `syncApply()` stays the only pre-`STARTED` mutation path and must not require a real document context before hydration.
- Hydration before renderer mount must mark a hydration deficit and later force-refresh registered viewport coordinators from Rust.
- Viewport movement fetches remain independent from mutation patches. Scroll/resize/sheet switch may fetch; normal cell mutations must not fetch unless a documented derived-state refresh requires it.
- Viewport IDs registered in Rust must exactly match TS coordinator IDs so Rust-produced mutation patches route to the right buffers.
- Viewport fetch bounds are inclusive in TS and converted to exclusive Rust end bounds at the bridge boundary.
- Concurrent viewport movement uses latest-wins request sequencing and coordinator fetch epochs; older fetches must not clobber newer visible windows or in-flight mutation overlays.
- WASM traps are observed once, stored as the originating `TrapError`, reset the global WASM module, notify listeners once, reject pending `ready`, and short-circuit later calls with `ModuleTrappedError`.
- Destroy is idempotent and cannot let an older instance destroy a newer Rust instance with the same `docId`.
- Session/security commands are document-scoped where Rust expects document state. Principal payloads stay flat tag lists on the wire and wrapped `{ tags }` objects for TypeScript callers.
- Rust remains the source of truth for compute state, formula references, viewports, undo history, sync bytes, and exported XLSX bytes. TypeScript should not repair engine state by searching formula text except as an explicitly temporary gap with a tracked removal plan.
- Floating-object geometry crosses into persisted compute storage in EMUs, while interaction-layer objects use CSS pixels. Conversion must be total for supported anchor shapes and reject or preserve unknown fields intentionally.
- Imported charts and floating objects should preserve OOXML-derived semantic evidence when it is known and mark approximate/import status when it is not.
- `MutationResultHandler` remains the single event gateway for Rust mutation results; bridge modules should not emit duplicate domain events directly.
- Public exports from `index.ts` and `compute-bridge.ts` stay intentional. Deep imports from `.gen.ts` are allowed only where currently required and should be reduced through stable barrels or typed contract packages.

## Concrete implementation plan

1. Build a compute bridge contract inventory.

   - Add a generated or source-scanned contract matrix for every Rust bridge method that reaches TypeScript.
   - Include method name, Rust command, generated TypeScript method name, bridge kind (`read`, `write`, `lifecycle`, `session`, `structural` where available), scope, docId requirement, input/output type, return shape (`value`, `void`, `bytes+mutation`, `id+mutation`, `multi-value+mutation`, `bytes`, subscription), lifecycle phase, security requirement, provider-update behavior, and whether TypeScript has a manual override.
   - Compare the matrix against `compute-bridge.gen.ts`, `manifest.gen.ts`, `infra/transport` command metadata, and hand-written `ComputeBridge` methods.
   - Fail the audit when a new command lacks an explicit disposition or when a manual override is not justified by a generated/transport limitation.
   - Emit the inventory as test metadata, not as an internal plan-only artifact.

2. Replace manual override categories with generated bridge dispositions.

   - Classify all direct `core.transport.call(...)` sites in `compute-bridge.ts` into categories: generated gap, skipped Rust method, non-standard mutation tuple, branding adapter, public convenience wrapper, security session method, stateless helper, workaround for Rust behavior, or true composition lifecycle.
   - For skipped methods that still need TypeScript exposure, update Rust bridge annotations or `bridge-ts` generation so their return shape is represented correctly instead of normalizing by hand in `compute-bridge.ts`.
   - Extend bridge generation to understand non-standard mutation returns such as `[id, MutationResult]`, `[id, config, MutationResult]`, and manually packed bytes tuples, then route them through the same mutation post-processing.
   - Generate a typed operation helper per return-shape category so the bridge code does not synthesize `new Uint8Array(0)` or cast partial objects to `MutationResult`.
   - Make security session methods generated or metadata-driven once `bridge-ts` understands `#[bridge::session]`, while preserving the TypeScript `{ tags }` envelope.
   - Leave only public convenience wrappers and true domain adapters hand-written.

3. Move workaround behavior to the owning Rust contract.

   - Replace `_forceRecomputeRefErrorCells()` with a Rust compute-core fix for sheet deletion invalidation across cell, range, and cross-sheet dependencies. The TS bridge should consume the resulting `MutationResult` and viewport patches, not search formula display strings for `#REF!`.
   - Replace the sheet-copy direct `compute_full_recalc` bypass with a Rust-side copy-sheet mutation contract that returns recalculated cells and viewport patches for copied formulas.
   - Audit other direct force-refreshes and compatibility blocks. Keep force-refresh policy only when the bridge is correcting display buffers for known derived state that Rust deliberately does not encode as cell patches.
   - Convert each removed workaround into a regression test that proves the Rust mutation result, viewport patch, undo grouping, provider update, and event flow are correct through the production bridge.

4. Decompose `ComputeCore` by responsibility while keeping `ComputeBridge` stable.

   - Extract `ComputeLifecycleController` for phase transitions, `ready`, active instance registry, create/destroy, and context setting.
   - Extract `TrapState` or `TrapAwareTransport` for trap marking, listener dispatch, module reset, and disposed/trapped transport stubs.
   - Extract `MutationPipeline` for write-gate checks, viewport patch application, mutation result handling, validation annotation emission, refresh policy orchestration, undo notification, and provider-update drain.
   - Extract `SyncProtocol` for `syncStateVector`, `syncDiff`, `syncApply`, `syncFullState`, hydration deficit marking, and live-sync viewport refresh.
   - Extract `SchemaSync` for initial full schema push, versioning, schema event subscription, and schema field conversion.
   - Keep `ViewportFetchManager` as the movement owner, but move mutation-triggered refresh decisions into a named `ViewportRefreshPolicy` so policy can be tested without constructing the whole core.
   - Expose only the methods generated bridge code actually needs from the resulting facade. Avoid making every sub-service public.

5. Strengthen method lifecycle and write/read enforcement.

   - Use the contract inventory to assert every generated and manual method has a minimum lifecycle phase.
   - Ensure generated document-scoped reads call `core.query(...)` or a phase-aware read helper, while stateless pure methods intentionally skip document initialization and docId.
   - Ensure every generated write calls a write helper that checks the write gate and records whether it should notify the undo service.
   - Add a static or runtime audit that no hand-written method calls `core.transport.call(...)` directly unless it is listed in the contract matrix with a reason.
   - Add tests for manual/convenience methods that currently return empty mutation results, including settings and undo-group wrappers, so they cannot bypass provider drains or event expectations.

6. Make provider update dispatch a first-class service.

   - Move `subscribeUpdateV1`, `flushPendingUpdateV1`, `drainPendingUpdates`, and `_dispatchPendingUpdates` into a `ProviderUpdateDispatcher`.
   - Encode the no-reentrancy, FIFO, subscriber snapshot, destroyed-instance, and orphaned-engine contracts as tests.
   - Ensure every mutation path, including undo, redo, sync apply, generated writes, manual tuple writes, and future non-standard writes, triggers the dispatcher exactly once when Rust produced updates.
   - Track and expose diagnostic counters for drained update count, byte count, subscriber failures, orphaned-engine clears, and in-flight reentrancy waits.
   - Keep provider update callbacks isolated so a throwing subscriber cannot prevent later subscribers or bridge cleanup.

7. Complete sync/hydration correctness.

   - Treat `sync-mutation-result.test.ts` as a production contract, not a permanent expected-failure suite. Fix Rust sync rebuild so remote updates populate domain change fields such as `sheetChanges`, `structureChanges`, `mergeChanges`, and other changed domains.
   - Make `syncApply()` return a mutation result that drives the same event and mirror path as local writes, including viewport refresh for live started bridges.
   - Add a sync contract test matrix for sheet create, rename, delete, structure change, merge, comments, tables, charts, filters, pivots, named ranges, objects, validation, and formatting.
   - Preserve pre-context hydration support: applying persisted bytes before `setContext()` must not access the real document context, but after `start()` the initial/hydration result must populate projections and events.
   - Add tests where sync updates arrive before any viewport coordinator exists, then a viewport registers and receives fresh Rust state through hydration-deficit backfill.

8. Formalize viewport refresh policy.

   - Extract a table-driven `ViewportRefreshPolicy` that maps mutation result fields to refresh actions: no refresh, all viewports, sheet viewports, or region-specific refresh.
   - Include table changes, pivot deletion, CF sibling visual refresh, dimension and visibility changes, show-formula settings changes, sync apply, full recalc, undo/redo, structural changes, and import/hydration paths.
   - Include the reason for each refresh in diagnostics and tests so future agents can decide whether a Rust patch improvement should remove a refresh.
   - Preserve the architecture rule: mutation patches are primary; forced fetches are only for derived viewport state not represented in patches.
   - Add tests proving refresh actions happen before events when state-before-event ordering matters.

9. Harden wire type and converter ownership.

   - Add an import-boundary test for `types.ts` proving it imports only external packages and never sibling compute modules or generated files.
   - Add a generated freshness/type identity test proving duplicated leaf wire interfaces such as `CellIdRange` remain structurally identical to generated counterparts.
   - Move all backwards-compatible re-export policy into one documented barrel and make new consumers import from the intended stable entrypoint.
   - Expand converter roundtrip tests to cover all `IdentityFormulaRefWire` variants, all `ColumnFilter` variants, all table style flags, calculated columns, blank filters, dynamic/icon filters, and branded `SheetId` conversion.
   - Remove casts such as color `by_font`/`byFont` workarounds by fixing generated field naming or adding a typed transport case-normalization contract.

10. Make floating-object and chart adapters contract-driven.

   - Inventory every supported floating object wire variant: shape, picture, textbox, connector, chart, equation, formControl, diagram, drawing, oleObject, slicer, camera, and fallback.
   - For each variant, define required wire fields, defaulted fields, preserved OOXML/import fields, and unsupported disposition.
   - Split `floating-object-mapper.ts` into variant-specific projection modules if needed, with a shared anchor/EMU conversion module.
   - Make unknown object types an explicit unsupported/import-placeholder contract instead of defaulting silently to shape unless product semantics require shape fallback.
   - Add property tests for EMU/pixel roundtrip tolerance, legacy flat anchor fields, one-cell/two-cell/absolute anchors, rotation/flip, z-order, lock/print/visible flags, group positions, drawing strokes/recognitions, and OLE preview data.
   - For chart import normalization, add a fixture matrix for combo charts, stock charts with volume, secondary axes, blank display modes, color map overrides, percent axes, and OOXML style context extraction.
   - Preserve imported semantic evidence such as `stockSourceComposition` and surface band formats; do not replace it with lossy defaults.

11. Update docs to match the real architecture.

   - Refresh `kernel/src/bridges/README.md` so it names the current generated bridge, mutation pipeline, provider update dispatcher, trap state, sync/hydration path, viewport movement path, and manual adapter dispositions.
   - Document which APIs are public barrel exports and which deep generated imports remain temporary.
   - Add a short "adding a compute bridge method" guide that tells developers whether to update Rust annotations, bridge-ts generation, command metadata, manual adapters, tests, and refresh policy.
   - Keep the documentation in the public repo and do not include private planning context.

12. Add generated artifact freshness gates.

   - Add a gate that runs the repository's bridge generation and fails if `compute-bridge.gen.ts`, `compute-types.gen.ts`, or `manifest.gen.ts` drift from Rust descriptors.
   - Include command metadata freshness if `infra/transport` generated files are affected by compute commands.
   - Add focused `bridge-ts` tests for return-shape generation, method-kind manifest coverage, session method emission, and generated helper selection.
   - Ensure generated bridge output is stable and readable enough that code review can see semantic changes.

13. Reduce public type leakage and deep imports.

   - Audit consumers of `compute-types.gen.ts`, `compute-core.ts`, and other deep files.
   - Move stable public type exports through `kernel/src/bridges/compute/index.ts` or an intentional subpath instead of encouraging arbitrary deep imports.
   - Keep `ComputeCore` export only for the trap-recovery integration tests unless production code needs it; if production needs it, define a narrow interface.
   - Add declaration/public-export tests so generated internal types do not accidentally become public SDK contract unless deliberately exported.

## Tests and verification gates

No build, formatter, typecheck, Jest, Cargo, pnpm, npm, yarn, rustc, or verification command was run for this planning-only queue task. The following gates should be used by the future implementation.

Focused TypeScript gates:

- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/compute-core-lifecycle-cleanup.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/trap-recovery.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/viewport-fetch-manager.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/viewport-sheet-switch.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/compute-wire-converters.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/floating-object-geometry-normalization.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/floating-object-mapper.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/chart-import-normalization.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/session-security-doc-scope.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/date-formula-format-compat.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/finite-f64-roundtrip.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel test -- src/bridges/compute/__tests__/sync-mutation-result.test.ts`
- `cd mog && pnpm --filter @mog-sdk/kernel typecheck`

Bridge generation and Rust gates:

- `cd mog && cargo test -p bridge-ts --test generate_compute_bridge -- --nocapture`
- `cd mog && cargo test -p bridge-ts --test generate_handler_registry -- generate --nocapture`
- `cd mog && cargo test -p bridge-ts --test emit_bridge_methods`
- `cd mog && cargo test -p bridge-ts --test emit_bridge_classification`
- `cd mog && cargo test -p bridge-ts --test manifest_coverage`
- `cd mog && cargo test -p compute-api`
- `cd mog && cargo clippy -p compute-api`
- `cd mog && cargo test -p compute-core` or narrower compute-core package gates for engine behavior touched by removed TS workarounds.
- `cd mog && cargo clippy -p compute-core` when compute-core code changes.

Integration and production-stack gates:

- NAPI/headless engine tests for sync, import/export, and provider update dispatch when bridge command return shapes or sync behavior change.
- WASM smoke covering init, set cell, formula recalc, viewport binary fetch, trap recovery, and a bytes-tuple mutation.
- Kernel document lifecycle tests covering create from snapshot, create from Yrs state, provider replay before renderer mount, write-gate installation, destroy while calls are queued, and trap recovery.
- UI/browser verification for viewport scroll, sheet switch, hidden rows/columns, table style updates, show formulas, undo/redo, and import hydration when viewport refresh policy changes.

New tests to add with the implementation:

- Compute bridge contract inventory test covering every generated and manual method disposition.
- Direct-transport-call audit for `compute-bridge.ts` and new adapter modules.
- Leaf import-boundary test for `types.ts`.
- Generated artifact freshness test for compute bridge artifacts and transport command metadata.
- Return-shape generation tests for bytes tuple, id plus mutation, id plus config plus mutation, void mutation, stateless read, session read/write, and lifecycle commands.
- Provider update dispatcher tests for FIFO delivery, no-reentrancy, subscriber throw isolation, unsubscribe during dispatch, destroy/orphan behavior, and exactly-once drain per mutation.
- Mutation pipeline tests proving write gate enforcement, state-before-event ordering, refresh policy decisions, validation annotation emission, undo notification differences, and provider update drain ordering.
- Sync/hydration tests for all domain change fields and viewport backfill after pre-renderer provider replay.
- Floating-object/chart fixture tests for every supported import/storage variant and fallback disposition.

## Risks, edge cases, and non-goals

Risks and edge cases:

- The bridge is cross-cutting. Moving logic out of `ComputeCore` can break ordering even if types still compile. Tests must assert ordering, not only outputs.
- Generated-method changes can affect WASM, NAPI, Tauri, and public declarations at once. Descriptor parity and generated freshness must be part of the same implementation.
- Some manual overrides may exist because of real transport differences. The correct outcome may be improved bridge generation or explicit dispositions, not deletion.
- Tightening lifecycle enforcement can reveal stateless methods that intentionally work before document startup. The contract matrix must distinguish pure stateless operations from document reads.
- Removing TypeScript workarounds before Rust emits complete mutation results and viewport patches would regress UI freshness, undo grouping, provider persistence, or event delivery.
- Force-refresh reduction must be measured on the production path. A stale viewport is worse than an extra fetch until Rust patches fully encode the derived state.
- Floating-object fallback behavior may be intentionally permissive for imported files. Contract-driven does not mean reject every unknown; it means the disposition is named and tested.
- Deep-import cleanup can break internal consumers if stable barrels do not export the required types first.
- Sync mutation-result fixes may require Rust compute-core ownership beyond this folder.

Non-goals:

- Do not replace Rust compute with a TypeScript calculator or cache.
- Do not add test-only mocks as a substitute for production bridge fixes.
- Do not optimize the Jest harness or mock transport path as the primary performance work.
- Do not hand-edit generated files as the lasting solution.
- Do not make `mog/kernel` depend on private/internal packages.
- Do not add compatibility wrappers that preserve wrong return shapes instead of fixing descriptors/generation.
- Do not move domain event emission out of `MutationResultHandler`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the contract inventory is established:

- Agent A: build the compute bridge contract inventory and direct-transport-call audit across `kernel/src/bridges/compute`, `infra/rust-bridge/bridge-ts`, `compute/api`, and `infra/transport`.
- Agent B: extend `bridge-ts` and Rust descriptors for non-standard return shapes, session methods, manifest coverage, and generated helper selection.
- Agent C: decompose `ComputeCore` into lifecycle/trap, mutation pipeline, provider update dispatcher, sync protocol, schema sync, and refresh policy modules while preserving the public `ComputeBridge` surface.
- Agent D: fix Rust compute-core mutation result and viewport patch gaps for sheet copy, sheet delete, remote sync domain changes, and any remaining TS workarounds.
- Agent E: expand converter, wire-type, floating-object, and chart normalization contracts with fixtures and import-boundary tests.
- Agent F: update kernel document lifecycle, provider, trap recovery, and viewport integration tests for the strengthened bridge contracts.
- Agent G: update public docs, barrels, declaration checks, and generated artifact freshness gates.

Key dependencies:

- `mog/compute/core/src` owns engine behavior, mutation results, viewport patches, dependency invalidation, sync rebuild, object/chart import data, and security filtering.
- `mog/compute/api/src` owns `ComputeService`, lifecycle/session methods, and bridge descriptor aggregation.
- `mog/infra/rust-bridge/bridge-ts` owns TypeScript bridge, type, manifest, and command metadata generation.
- `mog/infra/transport/src` owns transport behavior, trap classification, byte tuple normalization, and target-specific command semantics.
- `mog/kernel/src/bridges/wire` owns binary viewport and mutation buffer readers/coordinators.
- `mog/kernel/src/bridges/mutation-result-handler.ts` owns semantic event emission and state mirror application.
- `mog/kernel/src/document` owns lifecycle, providers, write gates, trap recovery integration, and create-from-Yrs-state flows.
- `mog/kernel/src/domain`, `mog/kernel/src/api`, and `mog/runtime/sdk` are broad consumers of the bridge surface and generated types.
