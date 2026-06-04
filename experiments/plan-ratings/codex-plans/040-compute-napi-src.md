# Plan 040: Compute N-API Source Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/napi/src`

Scope this plan covers:

- `lib.rs`: the Node native addon entry point for `compute-core-napi`, including the generated `ComputeEngine` class surface, stateless bridge free functions, and merged XLSX parser bridge exports.
- `coordinator.rs`: hand-written N-API exports for `SyncCoordinator`, raw Yrs state conversion, lock management, participant lifecycle, sync push/pull, and awareness payloads.
- `chart_render.rs`: hand-written N-API export for server-side chart mark rasterization.
- Production contracts adjacent to this folder where required to make the source improvements verifiable: `compute/napi/Cargo.toml`, `compute/napi/package.json`, `compute/napi/smoke-test.mjs`, platform binary wrappers under `compute/napi/npm/*`, bridge codegen in `infra/rust-bridge`, transport code in `infra/transport`, and Node SDK consumers in `runtime/sdk`.

Out of scope for the first implementation slice:

- Rewriting compute-core algorithms or spreadsheet semantics that are already correctly owned by compute-core crates.
- Adding compatibility shims around stale N-API behavior. Fix the binding contract, transport contract, and SDK production path directly.
- Publishing private `@mog/compute-core-napi` as a public package. Public consumers should continue to load the platform-specific `@mog-sdk/*` binary-wrapper packages.

## Current role of this folder in Mog

`compute/napi/src` is the native Node/server binding layer for Mog compute. It is the path used by headless SDK and server-side runtimes to execute the Rust compute engine without WASM.

Observed structure:

- `lib.rs` re-exports `compute_api`, imports descriptor type names into scope, and uses `bridge_napi::generate_class!` to generate a `ComputeEngine` class from `ComputeService` lifecycle and engine descriptor groups.
- The same file uses `bridge_napi::generate!` for stateless bridge functions: pivot, table, chart, format, schema, conditional-format presets, clock, and XLSX parsing.
- `coordinator.rs` is not generated. It exposes a global `Vec<Option<Mutex<SyncCoordinator>>>` handle table keyed by `u32`, plus functions named `coordinator_*` and `yrs_state_to_snapshot_json`.
- `chart_render.rs` is a small hand-written adapter around `compute_chart_render::render_chart_marks_image_from_json`, returning image bytes, format, width, and height.
- Node transport code in `infra/transport/src/napi-transport.ts` expects a class-based `ComputeEngine`, generated serde parameter metadata, byte-tuple normalization, `ComputeEngine.initFromYrsState`, and a lifecycle-result accessor.
- The Node SDK loads public platform packages through `@mog-sdk/darwin-*`, `@mog-sdk/linux-*`, or `@mog-sdk/win32-x64-msvc`, then uses the same addon for compute, collaboration coordinator helpers, XLSX parsing, and chart image export.
- The public release path builds this crate with `napi build --release`, copies `compute-core-napi.node` into each platform wrapper, and checks binary-wrapper surfaces.

Key evidence from the current code:

- N-API and WASM descriptor lists are meant to be near-parity, but binding prelude imports are hand-maintained. PyO3 already imports comment domain types that N-API does not visibly import; the robust fix is a shared binding prelude from `compute_core::bridge_types::*`, not more one-off imports.
- `infra/transport` already has generated `NAPI_SERDE_PARAM_INDICES`, but `DEFAULT_NAPI_SERDE_PARAMS` still carries a large manual override list because current metadata infers from TypeScript shape instead of the Rust bridge parameter tag.
- The generated class-mode lifecycle accessor is `take_lifecycle_result` at the Rust level, exported by napi-rs as `takeLifecycleResult`, while smoke and transport code still mention `compute_take_init_result` in several places. The production contract should have one lifecycle result accessor.
- `compute_set_current_time` is a stateless free function backed by a thread-local clock. Native `ComputeService` dispatch runs engine work on a dedicated compute thread, so server-side time injection must be proven to execute in the same thread as recalc or moved onto the engine dispatch path.
- Coordinator handles are numeric indexes into a reusable global slot table, which creates stale-handle and cross-room confusion risk after disposal and slot reuse.

## Improvement objectives

1. Make the N-API exported ABI a generated, snapshotted contract.
   Capture every addon export, every `ComputeEngine` prototype method, every class factory, every free function, and every hand-written coordinator/chart export in a stable contract test. The contract should classify each export as engine method, lifecycle factory, lifecycle result accessor, pure bridge function, coordinator operation, chart raster operation, XLSX operation, clock operation, or internal/disposed.

2. Replace hand-maintained binding prelude imports with one shared source of truth.
   Binding crates should import all descriptor-visible types through `compute_core::bridge_types::*` plus narrowly scoped target-specific items. Adding a new bridge method should not require guessing which binding crate needs a new `use` line.

3. Generate exact N-API calling metadata from Rust bridge tags.
   `NAPI_SERDE_PARAM_INDICES` must be derived from `[serde]` tags, not TypeScript surface type shape. Once this is exact, remove the manual `DEFAULT_NAPI_SERDE_PARAMS` override list and add a gate that fails if any N-API serde behavior is maintained by hand.

4. Unify lifecycle semantics for snapshot and Yrs-state boot.
   `new ComputeEngine(snapshotJson)` and `ComputeEngine.initFromYrsState(state)` should expose the same lifecycle-result contract. The transport, smoke test, SDK collaboration boot, and generated N-API class should agree on the accessor name and one-shot behavior.

5. Move server clock injection onto the engine execution path.
   NOW()/TODAY() input for N-API must be session-scoped and applied on the thread that evaluates formulas. The production path should not depend on setting a thread-local value on the Node caller thread before dispatching work to the compute actor thread.

6. Replace fragile coordinator numeric handles with ownership-safe N-API objects.
   The Node/server collaboration binding should not allow a stale `u32` handle to operate on a newly created coordinator. Prefer a `Coordinator` N-API class that owns `Mutex<SyncCoordinator>` with explicit dispose/finalization semantics. If a transitional internal shape is needed during migration, use generation-stamped opaque handles and prove stale handles fail closed.

7. Make hand-written coordinator and chart APIs typed at the N-API boundary.
   Coordinator functions should return `#[napi(object)]` structs or clearly versioned binary payloads instead of JSON strings where napi-rs can carry typed objects. Chart rasterization should share one versioned request/result contract with the Node SDK serializer and Rust renderer.

8. Strengthen native binary package integrity.
   The platform wrapper packages should prove that the shipped `.node` binary exposes the expected ABI, loads from the public wrapper package, and does not leak private package paths or extra exports.

9. Expand smoke coverage into production-path behavior coverage.
   The current smoke test validates load, construction, formulas, range query, multiple instances, and a small serde timing loop. Add real coverage for lifecycle factories, coordinator lock/sync/awareness behavior, chart rasterization, binary tuple framing, exact serde metadata, session clock behavior, and platform package loading.

## Production-path contracts and invariants to preserve or strengthen

- `ComputeService` remains the single engine bridge surface for N-API. The N-API crate should not bind directly to `YrsComputeEngine` for normal engine operations.
- WASM, N-API, and Tauri transport metadata must be generated from the same bridge descriptors. Any target-specific omission needs an explicit disposition, not accidental drift.
- `ComputeEngine` construction from snapshots and raw Yrs state must return exactly one initial `RecalcResult`, retrievable once, and must not silently return `undefined` because the transport looked for the wrong accessor.
- N-API parameter conversion must match the bridge tag contract:
  - `[serde]` params are JSON encoded, including primitive-looking strings, numbers, nullable values, enums, wrapper IDs, and arrays.
  - `[str]`, `[parse]`, `[prim]`, and `[bytes]` params pass raw values in the expected N-API representation.
- Byte-tuple mutation returns keep the packed Buffer contract until the transport normalizes them: 4-byte little-endian byte length, raw bytes, then UTF-8 JSON metadata. Malformed or truncated buffers must fail with actionable transport errors.
- Recalc-triggering commands must receive the caller's session timezone/current-time input in the evaluator that actually runs formulas. Concurrent headless workbooks in one Node process must not contaminate each other's NOW()/TODAY() results.
- Active principal state remains per `ComputeService` instance. Security ops must not move to stateless free functions or shared process state.
- Coordinator ownership must be unambiguous. Disposed coordinators cannot be reused, stale handles cannot address a new room, double-dispose behavior is explicit, and finalizers cannot drop a live room still owned by another SDK wrapper.
- Coordinator lock invariants mirror `compute-coordinator`: unknown participants fail closed, participant leave releases locks and awareness, structural locks serialize structure edits but do not block normal cell edits, and push lock violations return complete conflict data.
- Chart rasterization accepts only the typed, versioned mark request emitted by the Node SDK chart exporter. Unsupported mark types, non-finite geometry, invalid image dimensions, format mismatches, and invalid request versions must fail before producing partial image bytes.
- Public platform packages remain binary wrappers only: one `.node` main file, no declarations, no extra exports, and no dependency on private internal packages.
- N-API build outputs use the configured native target directory assumptions and must not introduce stale `target/` path assumptions in scripts or docs.

## Concrete implementation plan

1. Add an N-API ABI inventory test.
   Build a Node-side contract test that loads a built addon, records sorted `Object.keys(addon)`, `Object.getOwnPropertyNames(addon.ComputeEngine)`, and `Object.getOwnPropertyNames(addon.ComputeEngine.prototype)`, and compares them to a checked-in snapshot generated from bridge descriptors plus the hand-written exports. Include export classification, owner descriptor group, return encoding, and whether the export is public SDK reachable.

2. Generate descriptor-group parity data.
   Extend bridge generation to emit a compact descriptor-group manifest for WASM, N-API, PyO3, and Tauri consumers. `compute/napi/src/lib.rs` should consume the complete expected `ComputeService` group set, and a test should fail when N-API misses a group present in the canonical compute service surface unless a target-specific disposition exists.

3. Replace N-API local type imports with the bridge prelude.
   Change N-API binding setup to import `compute_core::bridge_types::*` for descriptor-visible names, then keep only target-specific direct imports for `ComputeService`, bridge pure types, `XlsxParser`, and any modules genuinely not covered by the prelude. Add a macro/codegen test that every descriptor-visible bare type resolves through the prelude for all binding crates.

4. Fix exact serde metadata generation.
   Change `infra/rust-bridge/bridge-ts` command metadata emission so `NAPI_SERDE_PARAM_INDICES` is based on the parsed bridge parameter mode, not the emitted TypeScript type. Regenerate `infra/transport/src/command-metadata.gen.ts`. Replace `DEFAULT_NAPI_SERDE_PARAMS` with the generated metadata only, and add tests covering current manual cases such as workbook protection, comments, named ranges, security policy IDs, table helpers, filter dropdown bitmaps, slicer values, and import sheet options.

5. Normalize lifecycle accessor naming.
   Make the class-mode N-API generator expose a deliberate JS name for lifecycle data, for example `takeLifecycleResult`, and update `createLazyNapiTransport`, `createHeadlessNapiTransport`, `compute/napi/smoke-test.mjs`, README examples, and SDK mocks to use that single name. Verify both constructor-created and `initFromYrsState`-created engines return and consume the same one-shot result shape.

6. Retire or classify `yrs_state_to_snapshot_json`.
   Prefer `ComputeEngine.initFromYrsState(state)` for the collaboration production path because it preserves the lifecycle contract directly. If any remaining caller needs raw snapshot conversion, move the helper behind a typed, documented internal export with an ABI disposition and tests. Otherwise remove the helper from the production surface and update SDK collaboration code to rely only on lifecycle create-from.

7. Move clock injection into `ComputeService`.
   Add an instance/session bridge method or dispatch wrapper that sets the clock on the compute actor thread immediately before executing recalc-triggering commands. The transport should pass the session Excel serial to that instance path, not call the stateless `ClockBridge` free function for N-API engine methods. Preserve WASM behavior separately if it still evaluates on the same thread as the injected clock. Add a native N-API regression where two engines with different user timezones recalc TODAY()/NOW() without sharing results.

8. Redesign coordinator as an owned N-API class.
   Implement a `SyncCoordinatorHandle` or `Coordinator` class in `coordinator.rs` with an internal `Mutex<SyncCoordinator>`, class methods for join/leave/push/pull/locks/awareness, and an explicit `dispose()` that marks the object closed. Update `runtime/sdk/src/collaborative-engine.ts` to hold the object instead of a `number` where possible. If the SDK still needs serializable references for tests, expose generation-stamped handles that include slot index plus generation and reject stale generations.

9. Type coordinator wire objects.
   Replace JSON string assembly in `coordinator_join`, `coordinator_push`, and `coordinator_active_locks` with `#[napi(object)]` structs for lock scope, lock summary, join result, push success, and lock violation. Preserve buffers for Yrs updates/state vectors. Convert UUID parsing failures, unknown participants, lock conflicts, invalid scope shapes, and disposed coordinator access into structured N-API errors with stable error codes or tagged messages compatible with `TransportError`.

10. Complete coordinator behavior tests through Node.
    Add a Node integration test that creates a coordinator, joins two participants, pushes/pulls a real Yrs update, acquires/releases sheet and structural locks, verifies lock violation payloads, applies awareness updates, leaves participants, disposes the coordinator, and confirms stale/double-disposed access fails closed. Keep core `compute-coordinator` unit tests as lower-level coverage, but make the N-API test prove the actual exported binding behavior.

11. Version and validate chart raster requests.
    Move the native chart raster request contract into a shared location or generated schema consumed by both `runtime/sdk/src/chart-export/node-chart-image-exporter.ts` and `compute_chart_render`. Keep `version: 1` explicit, validate dimensions/pixel ratio/quality/format before rendering, and produce typed errors for unsupported marks or formats. Add native N-API tests for PNG and JPEG output dimensions, all symbol shapes, text style fields, clipping, empty marks, invalid versions, and oversized image limits.

12. Harden byte tuple normalization and generated return metadata.
    Extend command metadata to include return encoding for every command: JSON string, primitive, Buffer, bytes tuple, typed object, or void. Use it in `createNapiTransport` so byte tuple unpacking and JSON parsing are contract-driven. Add malformed-buffer tests for underflow, declared length past buffer end, invalid JSON metadata, empty bytes, and large metadata.

13. Add addon package self-tests.
    Add a package-level self-test that can run against `@mog-sdk/<platform>` rather than `@mog/compute-core-napi`, asserts the wrapper package loads the binary, checks ABI snapshot identity, and verifies no TypeScript declarations or extra `exports` fields are published. Integrate this with `check:binary-wrapper-surfaces` and `build-public-artifacts` so local release assembly exercises the same path public users install.

14. Improve error and panic boundaries.
    Audit generated N-API wrappers and hand-written functions for `unwrap()` and string-only error conversions. Replace avoidable `unwrap()` paths in hand-written N-API code with `napi::Error` conversion that includes operation context but does not leak private/internal paths. Add tests for invalid JSON, invalid UUIDs, invalid Buffer payloads, missing participant, lock conflict, renderer failure, and disposed objects.

15. Update docs from the generated contract.
    Regenerate `compute/napi/README.md` examples from the ABI contract or a small checked fixture so examples do not drift from the actual exported lifecycle methods and parameter conventions. Document that the private package is local-only and that public Node consumers load platform wrappers through `@mog-sdk/node`.

## Tests and verification gates

Rust and codegen gates:

- `cargo test -p bridge-napi`
- `cargo test -p bridge-ts --test generate_handler_registry -- verify_up_to_date`
- `cargo test -p compute-core-napi`
- `cargo clippy -p compute-core-napi`
- Focused `cargo test -p compute-coordinator` after coordinator binding changes.
- Focused `cargo test -p compute-chart-render` after chart raster contract changes.
- Focused `cargo test -p compute-api` after lifecycle, clock, or descriptor changes.

Native addon and Node behavior gates:

- `pnpm -C compute/napi build`
- `pnpm -C compute/napi smoke-test`
- New addon ABI snapshot test against `compute/napi/compute-core-napi.node`.
- New coordinator N-API integration test against the built addon.
- New chart raster N-API integration test against the built addon.
- New N-API clock isolation test using two engines and non-UTC user timezones.

TypeScript transport and SDK gates:

- `pnpm --filter @mog/transport test`
- `pnpm --filter @mog/transport typecheck`
- `pnpm --filter @mog-sdk/node test`
- `pnpm --filter @mog-sdk/node typecheck`
- Relevant kernel compute bridge tests for `compute_init_from_yrs_state`, sync mutation result handling, byte tuples, and security principal behavior.
- Repo `pnpm typecheck` after TypeScript transport, SDK, generated metadata, or declaration changes.

Packaging and public-boundary gates:

- `pnpm build:public-artifacts` on the host platform after native build changes.
- `pnpm check:binary-wrapper-surfaces`
- `pnpm check:private-leaks`
- `pnpm check:api-snapshots`
- Publish workflow dry-run or matrix-equivalent CI for all seven native triples before shipping changes that affect build flags, exported ABI, or binary wrapper package contents.

Behavior gates that should be added if missing:

- ABI snapshot freshness: generated expected exports match the built `.node` file.
- Descriptor parity: N-API descriptor groups match the canonical compute service surface.
- Serde metadata completeness: no manual N-API serde override map remains.
- Lifecycle parity: snapshot init and Yrs-state init expose the same one-shot result contract.
- Clock correctness: TODAY()/NOW() use the session clock on native N-API engine work.
- Coordinator stale-handle safety: stale, disposed, and double-disposed access fails closed.
- Chart raster golden tests: PNG/JPEG dimensions and basic pixel sanity for representative marks.

## Risks, edge cases, and non-goals

- N-API export names are an ABI. Because the private binding is consumed by public platform wrappers through `@mog-sdk/node`, changes must be coordinated with SDK transport and API snapshot updates in the same production path.
- Class-mode lifecycle naming drift is easy to miss because mocks can pass while the built native addon fails. The ABI snapshot must run against the real `.node` binary.
- Numeric coordinator handle reuse is a correctness risk in long-lived Node processes. The right fix is ownership-safe objects or generation-stamped handles, not relying on caller discipline.
- Moving clock injection onto the engine path may require changes outside `compute/napi/src`, likely in `compute-api`, compute-core clock plumbing, and transport middleware. That wider change is in scope because the current folder is the server binding boundary where the bug manifests.
- Exact serde metadata may require bridge IR changes, not only transport changes. Do not keep a second manual map as the long-term solution.
- Chart raster tests should verify rendered output enough to catch blank or wrong-size images, but this plan does not require pixel-perfect chart engine approval for every visual style. Chart semantic correctness remains owned by chart mark generation and `compute-chart-render`.
- Cross-compiling every platform binary locally is not required. The production gate is CI/publish matrix coverage plus host-platform local build and wrapper self-test.
- Do not optimize only the smoke test or mock transport paths. All improvements must run through the built N-API addon and the Node SDK loader path.
- Do not expose private/internal package names or internal planning content through generated docs, package manifests, API snapshots, or error messages.

## Parallelization notes and dependencies on other folders, if any

This work naturally splits across independent agents with clear contracts:

- Agent A: ABI inventory and descriptor parity. Owns bridge metadata generation, N-API export snapshot, and `lib.rs` prelude cleanup. Dependencies: `infra/rust-bridge/bridge-napi`, `infra/rust-bridge/bridge-ts`, `compute/api/src`, `compute/core/src/bridge_types.rs`.
- Agent B: Exact N-API serde and return metadata. Owns generated `NAPI_SERDE_PARAM_INDICES`, removal of manual transport overrides, byte-tuple return metadata, and transport tests. Dependencies: `infra/transport/src`, `infra/rust-bridge/bridge-ts`.
- Agent C: Lifecycle and clock contract. Owns `takeLifecycleResult` naming, `initFromYrsState`, Node transport boot, N-API smoke updates, and engine-thread clock injection. Dependencies: `compute/api/src/bridge_service.rs`, `compute/api/src/dispatch.rs`, `compute/core/src/eval/clock.rs`, `infra/transport/src/napi-transport.ts`, `runtime/sdk/src/boot.ts`.
- Agent D: Coordinator binding redesign. Owns `coordinator.rs`, SDK collaboration wrapper updates, and N-API coordinator integration tests. Dependencies: `compute/core/crates/compute-coordinator`, `runtime/sdk/src/collaborative-engine.ts`.
- Agent E: Chart raster contract. Owns `chart_render.rs`, shared chart raster request validation, SDK chart exporter serializer, and native chart raster tests. Dependencies: `compute/core/crates/compute-chart-render`, `runtime/sdk/src/chart-export/node-chart-image-exporter.ts`.
- Agent F: Packaging and public-boundary gates. Owns platform wrapper self-test, release artifact validation, binary wrapper surface checks, and publish workflow assertions. Dependencies: `compute/napi/npm/*`, `tools/build-public-artifacts.mjs`, `tools/check-binary-wrapper-surfaces.mjs`, `.github/workflows/publish-sdk.yml`.

Integration order:

1. Land ABI inventory and generated metadata first so later agents have a shared failing contract.
2. Land lifecycle and serde fixes before coordinator/chart SDK changes so the transport contract is stable.
3. Land coordinator and chart typed APIs behind the generated ABI snapshot.
4. Run native addon, transport, SDK, and packaging gates together before declaring the folder improved.
