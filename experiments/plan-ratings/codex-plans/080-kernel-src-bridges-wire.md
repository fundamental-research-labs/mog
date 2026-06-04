# Plan 080: Kernel Wire Bridge and Mutation Projection Boundary Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/bridges/wire`

Queue item: 80

Scope: the TypeScript side of Mog's binary viewport, binary mutation, multi-viewport routing, viewport coordinator, prefetch, and metadata cache boundary. This folder is public Mog source and implementation work belongs in `mog`; this plan remains internal in `mog-internal`.

Files inspected in this folder:

- `README.md`
- `index.ts`
- `binary-viewport-buffer.ts`
- `binary-mutation-reader.ts`
- `viewport-coordinator.ts`
- `viewport-coordinator-registry.ts`
- `viewport-prefetch.ts`
- `mutation-classifier.ts`
- `palette-binary.ts`
- `cell-metadata-cache.ts`
- `range-metadata-cache.ts`
- `constants.gen.ts`
- `viewport-test-builder.ts`
- `mutation-test-builder.ts`
- `__tests__/cell-format-drift.test.ts`
- `__tests__/viewport-coordinator.test.ts`
- `__tests__/viewport-buffer.test.ts`
- `__tests__/viewport-prefetch.test.ts`
- `__tests__/binary-mutation-reader.test.ts`
- `__tests__/cross-language-roundtrip.test.ts`
- `__tests__/binary-mutation-apply.test.ts`
- `__tests__/binary-viewport-delta.test.ts`
- `__tests__/cell-metadata-cache-disposal.test.ts`

Adjacent production and contract paths inspected:

- `kernel/src/bridges/compute/compute-core.ts`
- `kernel/src/bridges/compute/compute-bridge.ts`
- `kernel/src/bridges/compute/viewport-fetch-manager.ts`
- `kernel/src/bridges/mutation-result-handler.ts`
- `kernel/src/api/worksheet/structure.ts`
- `kernel/src/api/worksheet/operations/sort-operations.ts`
- `kernel/src/context/kernel-context.ts`
- `apps/spreadsheet/src/components/grid/SpreadsheetGrid.tsx`
- `apps/spreadsheet/src/hooks/data/use-cell-metadata-cache.ts`
- `apps/spreadsheet/src/systems/renderer/subscriptions/event-subscriptions.ts`
- `canvas/grid-renderer/src/coordinates/viewport-position-index.ts`
- `compute/core/crates/compute-wire/src/lib.rs`
- `compute/core/crates/compute-wire/src/viewport/mod.rs`
- `compute/core/crates/compute-wire/src/mutation/mod.rs`
- `compute/core/crates/compute-wire/src/bin/generate_ts.rs`
- `compute/core/crates/compute-wire/tests/verify_constants_gen.rs`
- `compute/core/src/storage/engine/viewport/patches.rs`

## Current role of this folder in Mog

`kernel/src/bridges/wire` is the hot TypeScript data plane between Rust compute and the sheet renderer. Rust serializes viewport buffers and mutation patches; this folder reads those bytes through `DataView`, patches the current viewport buffer in place, routes packed per-viewport payloads, and exposes a read-only buffer surface to the compute bridge, worksheet API, canvas renderer, and React hooks.

The main production paths are:

- Viewport movement path: `ViewportFetchManager.refresh()` calls Rust `compute_get_viewport_binary` or `compute_get_viewport_binary_delta`, then `ViewportCoordinator.commitFetch()` or `commitDelta()` swaps or merges `BinaryViewportBuffer` bytes and emits `fetch-committed`.
- Mutation path: `ComputeCore.mutateCore()` receives Rust `viewportPatchesBinary`, calls `ViewportCoordinatorRegistry.applyMultiViewportPatches()`, constructs `BinaryMutationReader` for mutation payloads, and `ViewportCoordinator.applyMutationPatches()` writes cell patches into `BinaryViewportBuffer`, stores epoch overlays, and emits `cells-patched`.
- Multi-viewport path: Rust packs payloads by viewport id; the registry routes each entry to the matching coordinator for main and frozen pane regions.
- Metadata projection path: `CellMetadataCache` and `RangeMetadataCache` keep spill/validation/range metadata synchronously readable by render and API callers while `MutationResultHandler` updates them from semantic mutation results.
- Prefetch path: `viewport-prefetch.ts` computes overscan bounds and skip logic for scroll behavior; `ViewportFetchManager` owns the actual state map and movement sequencing.

Observed strengths:

- The folder has focused unit coverage for viewport reads, mutation reads, mutation application, coordinator overlay epochs, prefetch bounds, delta merge, cross-language Rust fixtures, and CellFormat drift.
- `constants.gen.ts` is generated from Rust `compute-wire`, and `compute-wire` has a freshness test that compares generated output to the on-disk TS constants.
- `ReadonlyBinaryViewportBuffer` prevents canvas and API consumers from mutating the buffer outside the coordinator write path.
- `ViewportCoordinator` models fetch/mutation ordering with overlay epochs so mutations that arrive during a fetch can be re-applied after the fetch commits.
- `ViewportCoordinatorRegistry` already includes hydration-deficit backfill for patches dropped before a renderer registers any coordinators.
- `CellMetadataCache` uses async batch fetch with synchronous render-loop reads, and guards in-flight evaluations with disposal generations.
- `RangeMetadataCache` validates decoded JSON metadata instead of accepting arbitrary untyped payloads.

Observed weaknesses and drift:

- Packed payload routing is still heuristic. `ViewportCoordinatorRegistry` treats a payload as a full viewport binary when byte 30 has the viewport `WIRE_VERSION` bits; mutation payloads do not have a kind marker, so this is not a contract.
- `BinaryMutationReader` and `BinaryViewportBuffer.setBuffer()` trust counts, section lengths, string offsets, palette lengths, and optional-section flags. Malformed bytes can throw late or silently decode as empty data rather than producing a typed protocol error.
- `BinaryViewportBuffer.applyDelta()` reconstructs a synthetic full buffer but drops CF extras, position arrays, viewport wire version flags, and some header semantics. That makes delta a lossy protocol path compared with a full viewport fetch.
- The protocol reader, mutator, cache invalidation, devtools reporting, delta merge, palette application, and CellAccessor gating all live in one large `binary-viewport-buffer.ts` file.
- `palette-binary.ts` hand-maintains a subset of `CellFormat` fields while `constants.gen.ts` knows the full Rust field set. Drift detection exists, but palette encode/decode coverage is not driven by the generated field list.
- `mutation-classifier.ts` is exported from `index.ts` but is only used by tests. Actual prefetch dirty state is not connected to it in `ViewportFetchManager`.
- `index.ts` exports test builders from the same barrel as production reader classes, which blurs production surface and test support ownership.
- Comments in `kernel/src/api/worksheet/structure.ts` and `sort-operations.ts` still describe full-viewport binary patches being fed into `BinaryMutationReader`, even though the registry now attempts full-viewport detection. The stale workaround comments indicate this boundary has not been reverified end to end.
- `README.md` references files that are not present in this folder, such as `viewport-buffer.ts` and `viewport-data-provider.ts`, and still describes the palette tail as JSON even though the code uses binary palette sections.

## Improvement objectives

1. Make every payload entering this folder self-identifying, versioned, and validated before the production reader mutates viewport state.
2. Replace byte-offset routing heuristics with an explicit packed-envelope decoder shared with Rust `compute-wire`.
3. Make `BinaryViewportBuffer` a small protocol facade over validated section descriptors, not a mixed parser, mutator, delta merger, cache, and render accessor implementation.
4. Preserve all protocol sections in the delta path, including CF extras, position arrays, version flags, palette alignment, merges, dimensions, visible bounds, and overflow strings.
5. Separate coordinator ordering contracts from protocol byte mutation: fetch request identity, mutation overlay epochs, stale response rejection, hydration deficit, and event emission should be independently testable.
6. Connect or remove the prefetch mutation classifier. If prefetch dirty tiers matter, wire them into `ViewportFetchManager`; if they do not, remove them from the production barrel and keep only real production state.
7. Turn metadata caches into explicit projection-boundary services with complete invariants for spill, validation, range metadata, sheet deletion, undo/redo, hydration, and disposal.
8. Move test builders into an intentional test-support subpath or keep them as internal deep imports, not general production barrel exports.
9. Keep Rust `compute-wire`, generated constants, TS readers, TS test builders, and cross-language fixtures in lockstep through freshness and roundtrip gates.
10. Remove operation-level compensating force refreshes or stale comments only after the typed wire boundary proves full viewport and mutation payloads route correctly through production code.

## Production-path contracts and invariants to preserve or strengthen

- `compute-wire` remains the Rust source of truth for binary viewport, mutation, palette, packed envelope, and generated TS constants.
- Public `mog` code must not depend on `mog-internal`.
- All multi-byte protocol fields remain little-endian.
- Viewport cell records and mutation patch cell records remain semantically identical where patches splice into viewport buffers.
- A packed multi-viewport entry must declare payload kind: mutation patch, full viewport buffer, empty notification, or future typed payload. The registry must never infer kind from arbitrary payload bytes.
- Readers must validate buffer length, version, declared counts, section offsets, section lengths, string references, palette sections, CF extras, position arrays, and trailing bytes before exposing accessors or mutating base buffers.
- Unsupported wire versions must fail closed with a typed protocol error and a deterministic refresh or hydration-deficit path, not partial cell mutation.
- `NO_STRING` plus zero length remains the no-string sentinel. Non-sentinel offsets must stay within the declared string pool or overflow pool.
- Format palette indices remain global stable indices. Palette deltas must be applied before any patched cells with new `format_idx` values can render.
- `CellAccessor` remains a reusable flyweight and should not allocate on hot render reads.
- `ReadonlyBinaryViewportBuffer` remains the only surface exposed to render/API consumers outside coordinator-owned write paths.
- `ViewportCoordinator` stays the single owner for a viewport buffer. Consumers may subscribe to events but may not call `setBuffer`, `applyBinaryMutation`, `writeOverlayEntryToBase`, or dimension patch methods directly.
- Fetch overlay semantics remain: mutations whose overlay epoch is newer than a fetch snapshot must win over that fetch; older overlay entries must be discarded.
- Stale fetch rejection must account for distinct in-flight fetches with the same mutation version. A movement sequence token or coordinator fetch token should be part of the production contract, not only `_version`.
- `commitFetch()` and `commitDelta()` must emit exactly one `fetch-committed` event when they commit and no event when rejected as stale.
- `applyMutationPatches()` must emit `cells-patched` only when at least one in-viewport cell is actually dirtied.
- Hydration-deficit backfill must continue to recover when provider replay or sync updates advance Rust state before any coordinator has a buffer.
- Full viewport payloads inside packed mutation envelopes must go through `commitFetch()` so CF extras, dimensions, positions, and palette sections are parsed.
- Viewport movement fetches remain independent from normal mutation patches. Forced refresh remains allowed only for structural or derived-state cases whose production Rust result intentionally cannot be represented as patches.
- Prefetch bounds remain inclusive in TypeScript and are converted to exclusive Rust end bounds only at the transport boundary.
- Metadata cache reads remain synchronous and safe for the render loop. Async population must never update a disposed or generation-stale cache.
- Sheet deletion must clear range metadata for the deleted sheet; undo/redo/hydration range changes must update the same cache contract as live mutations.
- Barrel exports must distinguish production runtime exports from test-support helpers.

## Concrete implementation plan

1. Define a typed wire envelope contract in Rust and TypeScript.

   - Extend `compute-wire` with explicit payload kind and version metadata for packed multi-viewport entries, aligned with the broader compute-wire protocol plan.
   - Generate TS constants for payload kinds, envelope version, header offsets, required section bits, and maximum field values.
   - Add a `decodePackedViewportPatches()` module in this folder that validates the packed envelope and returns typed entries before the registry routes them.
   - Replace byte-30 full-viewport detection in `ViewportCoordinatorRegistry.applyMultiViewportPatches()` with the typed entry kind.
   - Keep old-format handling only if production bytes still require it, and put it behind a bounded legacy decoder with tests proving new production writers no longer emit ambiguous entries.

2. Add typed protocol validation for viewport and mutation readers.

   - Introduce `BinaryViewportProtocolError` and `BinaryMutationProtocolError` with stable codes and enough context for diagnostics.
   - Validate viewport buffers before `BinaryViewportBuffer.setBuffer()` swaps state: minimum header, `cell_count == rows * cols`, section offset arithmetic, palette bounds, CF extras bounds, position-array bounds, and trailing length if the schema requires exact consumption.
   - Validate mutation buffers in `BinaryMutationReader` constructor: minimum header, sheet id bounds, patch count multiplication, string pool bounds, spill section bounds, palette section bounds, string refs for every regular/spill patch, and unsupported flags.
   - Ensure failed validation does not mutate an existing `BinaryViewportBuffer` and does not emit normal render events.
   - Decide the production recovery path for validation failure: mark hydration deficit and request full viewport refresh for recoverable viewport entries; throw a bridge protocol error only when refresh cannot repair the state.

3. Split `BinaryViewportBuffer` into protocol, mutation, and accessor modules.

   - Extract a `ViewportSectionLayout` parser that owns header fields and computed offsets.
   - Extract section readers for strings, merges, dimensions, palette, CF extras, and positions.
   - Extract mutation application into a small writer that takes a validated `BinaryMutationReader`, rebases strings into the overflow pool, applies palette deltas, and returns dirty-cell telemetry.
   - Keep `CellAccessor` focused on flyweight reads and visible-window gating.
   - Keep devtools reporting outside the byte reader so protocol parsing is not coupled to diagnostics.
   - Preserve public imports through `index.ts` during migration, then remove internal helpers from the public barrel once consumers are updated.

4. Make delta merge semantically equivalent to a full viewport buffer.

   - Replace the current synthetic-buffer construction with a section-preserving merge strategy.
   - Preserve or recompute header flags with `WIRE_VERSION` bits and the delta/full bit set correctly for the merged result.
   - Preserve CF extras and icon entries for existing cells, merge delta CF extras, and drop only entries whose cells are outside the new buffer.
   - Preserve row and column position arrays, including the trailing sentinel, by merging existing and delta positions or requesting full fetch when positions cannot be safely merged.
   - Preserve overflow pool strings from in-flight mutations and rebase offsets exactly once.
   - Preserve merged palette start index and global index alignment.
   - Add an explicit fallback to full fetch when delta cannot preserve all required sections; do not commit a lossy synthetic buffer as if it were complete.

5. Formalize coordinator ordering and lifecycle.

   - Split coordinator write tokens into a mutation version and a fetch sequence. `startFetch()` should return a token that can distinguish two in-flight fetches started at the same mutation version.
   - Define a `FetchToken` shape with captured mutation version, request sequence, viewport id, and optional visible-window sequence.
   - Update `commitFetch()` and `commitDelta()` to reject stale tokens by request order while still using mutation epoch for overlay filtering.
   - Make full-viewport payloads that arrive through the mutation envelope use a coordinator token that cannot be confused with user movement fetches.
   - Add diagnostics for dropped payloads: unknown viewport, no buffer, empty notification, validation failure, stale fetch, stale delta, and hydration deficit.
   - Keep subscriber dispatch synchronous, but add tests that a throwing subscriber cannot block later subscribers or corrupt coordinator version.

6. Reconcile full-viewport mutation payloads and force-refresh workarounds.

   - Build an audit of every operation-level force refresh that exists because full viewport payload routing was unreliable, including remove duplicates and sort/CF comments.
   - After typed routing is in place, add production-path tests proving full viewport payloads inside a packed envelope update cells, CF extras, dimensions, and positions without a separate `forceRefreshAllViewports()`.
   - Remove only the force refreshes whose sole reason was the binary-format mismatch. Keep refreshes required for structural shifts, pivot/table derived state, show-formula toggles, or CF identity repair.
   - Update stale comments so future work does not preserve obsolete compensating behavior.

7. Connect prefetch dirty classification to production or retire it.

   - Decide whether `classifyMutation()` should drive `ViewportFetchManager` dirty-state updates.
   - If yes, route `MutationResult` plus current visible/prefetch bounds through the classifier after mutation patches, update `prefetchDirtyState`, and make dirty state affect the next movement refresh decision.
   - If no, remove `classifyMutation` and `MutationTier` from the production barrel and keep any useful tests near the production refresh policy.
   - In either case, make prefetch states observable enough for diagnostics but not writable by callers.

8. Strengthen metadata projection caches.

   - Give `CellMetadataCache` explicit viewport/sheet generation keys so async population cannot mix data from a previous sheet, viewport, or workbook instance.
   - Update `patchProjectionChanges()` to use the source/anchor data from `ProjectionChange` when available instead of inferring the anchor from the minimum projected cell.
   - Add clear semantics for spill teardown: patches that remove or shrink a spill must remove stale phantom entries from the cache.
   - Make validation cache patching support batch updates and removals for a range, not only single-cell writes.
   - Keep `RangeMetadataCache` document-scoped, but add a validated hydration path that can bulk replace per-sheet metadata on cold load and clear deleted ranges by sheet.
   - Add typed error handling for bad range metadata JSON that reports the range id and sheet id without crashing unrelated mutation processing.

9. Make palette binary encode/decode contract-driven.

   - Generate or verify the palette field bit mapping against Rust `CellFormat` fields, not only the top-level drift list.
   - Expand palette support for intentional TS/Rust field differences such as `numberFormatType`, `forcedTextMode`, `extensions`, `fontCharset`, `fontFamilyType`, and `quotePrefix` with explicit encode/decode disposition.
   - Add malformed palette validation for bad string refs, stop counts, border records, unknown required bits, and record overrun.
   - Ensure mutation palette deltas update the palette before any cell with a new `format_idx` is read by a subscriber-triggered render.

10. Separate production exports from test support.

   - Create an intentional test-support subpath or keep deep imports for `viewport-test-builder.ts` and `mutation-test-builder.ts`.
   - Remove test builders from `kernel/src/bridges/wire/index.ts` unless there is a production consumer that truly needs them.
   - Add an export surface test that prevents new test-only helpers from entering the production barrel.
   - Keep existing tests using builders by importing the test-support path explicitly.

11. Refresh documentation from current protocol facts.

   - Update `README.md` file inventory to match actual files.
   - Remove stale references to JSON palette tails, `viewport-buffer.ts`, and `viewport-data-provider.ts`.
   - Document typed envelope routing, full viewport payload handling, delta fallback behavior, coordinator fetch tokens, metadata cache roles, and test-support export policy.
   - Link the Rust `compute-wire` schema and the constants generation/freshness test instead of hand-copying offset tables that can drift.

12. Add boundary observability.

   - Extend devtools reporting with viewport id, payload kind, envelope version, protocol version, fetch token, dirty-cell count, skipped count, validation errors, hydration-deficit reason, delta/full fallback reason, and overflow-pool bytes.
   - Keep reporting optional and zero-cost when devtools are absent.
   - Use diagnostics in tests where possible to assert that stale or malformed payloads follow the intended recovery path.

## Tests and verification gates

Focused TypeScript tests to add or strengthen:

- Packed envelope decoder tests for mutation entries, full viewport entries, empty notifications, unknown payload kind, unsupported version, truncated id, truncated payload length, trailing bytes, unknown viewport, and no-buffer hydration deficit.
- `BinaryMutationReader` malformed-buffer tests for every protocol error: short header, patch count overflow, sheet id overrun, string pool overrun, bad regular string ref, bad spill string ref, bad palette length, unknown flags, and trailing bytes.
- `BinaryViewportBuffer.setBuffer()` malformed-buffer tests for header/section underflow, `rows * cols` mismatch, palette overrun, CF extras overrun, positions overrun, and unsupported wire version.
- Delta tests proving CF extras, icons, position arrays, merges, dimensions, palette entries, overflow-pool strings, visible-window bounds, and wire version bits survive a delta commit or trigger a full-fetch fallback.
- Coordinator tests for distinct in-flight fetch tokens with the same mutation version, stale movement fetch rejection, stale delta rejection, full-viewport mutation payload commit, overlay-vs-fetch winning order, and subscriber failure isolation.
- Prefetch tests that either prove `classifyMutation()` updates production `prefetchDirtyState` or prove it is removed from the production export surface.
- Metadata cache tests for spill shrink/teardown, projection anchor correctness, validation batch add/remove, generation-stale async results, sheet switch, sheet deletion, undo/redo, and cold-load range hydration.
- Palette tests for every supported CellFormat field, intentional field exceptions, malformed string refs, gradient stops, borders, and mutation palette delta order.
- Export surface tests proving production barrels do not expose test builders unless explicitly intended.
- Cross-language fixture tests using Rust-generated bytes for viewport, mutation, packed mixed payloads, full-viewport-in-envelope, spill patches, palette deltas, CF extras, positions, image cells, and long UTF-8 strings.

Required verification gates for implementation work:

- `pnpm --filter @mog-sdk/kernel test -- --runInBand kernel/src/bridges/wire`
- `pnpm --filter @mog-sdk/kernel test -- --runInBand kernel/src/bridges/compute`
- `pnpm --filter @mog-sdk/kernel test -- --runInBand kernel/src/bridges`
- `pnpm --filter @mog-sdk/kernel typecheck`
- `pnpm typecheck` for TypeScript changes that affect public package boundaries or cross-package consumers
- `cargo test -p compute-wire`
- `cargo clippy -p compute-wire`
- `cargo test -p compute-core` when Rust viewport producers, structural operations, or checked serialization callers change
- `cargo clippy -p compute-core` when compute-core Rust callers change
- UI verification through the real app after routing or coordinator changes: open a sheet, scroll with frozen panes, edit a value, edit a spilling formula, apply a format that emits a palette delta, trigger a CF update, sort/remove duplicates if affected, and confirm rendered cells update without stale buffers or unnecessary full refreshes.

This planning worker did not run these gates because the requested output was a plan file only and the task explicitly prohibited cargo, pnpm, build, test, typecheck, and verification commands.

## Risks, edge cases, and non-goals

Risks:

- Typed envelope changes must land with Rust writer, generated constants, TS decoder, registry routing, test builders, fixtures, and docs together.
- Validator strictness can expose previously hidden malformed or stale production bytes. The implementation must provide a deterministic refresh/backfill path where possible.
- Delta merge correctness can become complex if CF extras, positions, and overflow strings are all preserved. Falling back to a full fetch is correct when the delta cannot preserve sections exactly.
- Removing force refreshes too early can regress operation paths that also rely on refresh for structural or derived-state reasons. Each removal needs production-path evidence.
- Moving test builders out of the barrel may affect internal tests in compute bridge packages; update imports deliberately rather than leaving duplicate helpers.

Edge cases to cover:

- Empty packed envelope and packed entry with `patch_len === 0`.
- Full viewport payload for a coordinator with no existing buffer.
- Mutation payload for a registered coordinator whose current buffer belongs to a different sheet.
- Two movement fetches started at the same mutation version and committed out of order.
- Mutation arrives between delta fetch start and delta commit, then delta commit expands bounds and must retain the newer overlay.
- Same cell appears in regular and spill sections. The scheduler contract should define whether this is impossible or last-writer-wins.
- `NO_STRING` with nonzero length, non-sentinel offset with zero length, offset at pool end, and UTF-8 multibyte boundaries.
- Palette delta with gaps between current palette and `paletteStartIndex`.
- Full viewport payloads that would collide with the old byte-30 heuristic.
- Delta merge across frozen panes where visible-window gating must not hide cells owned by frozen-row or frozen-col viewports.
- Position arrays with zero rows/cols, one row/col, and trailing sentinel only.
- Range metadata JSON with unknown kind, unknown encoding, missing anchor, mixed axis identity variants, deleted sheet, and duplicate range ids.

Non-goals:

- Do not replace the binary hot path with JSON decoding.
- Do not add compatibility shims that keep ambiguous payload routing as the production contract.
- Do not optimize benchmark-only or test-only paths instead of production readers, writers, and coordinator commits.
- Do not remove force refreshes whose reason is still structural or derived-state correctness.
- Do not introduce a dependency from `mog` to `mog-internal`.
- Do not broaden this plan into formula evaluation or rendering algorithm changes except where they are needed to verify the wire boundary.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the typed payload schema is agreed.

- Agent A: implement Rust `compute-wire` typed packed envelope, generated constants, fixture generation, and freshness tests.
- Agent B: implement TS packed-envelope decoder, protocol errors, and registry routing.
- Agent C: split `BinaryViewportBuffer` into section layout, readers, mutation writer, and accessor modules while preserving public behavior.
- Agent D: make delta merge section-preserving and add full-fetch fallback tests.
- Agent E: formalize coordinator fetch tokens, stale rejection, overlay filtering, and diagnostics.
- Agent F: wire or remove prefetch mutation classification and clean the production barrel/test-support exports.
- Agent G: harden `CellMetadataCache`, `RangeMetadataCache`, and mutation-result cache integration tests.
- Agent H: audit force-refresh workaround removals, stale comments, UI scenarios, and docs.

Dependencies:

- `compute/core/crates/compute-wire/src` owns the Rust schema, generated constants, test fixtures, and packed envelope writer.
- `compute/core/src/storage/engine/viewport/patches.rs` owns production viewport patch generation and full-viewport payload production.
- `kernel/src/bridges/compute/compute-core.ts` owns mutation pipeline ordering before semantic events.
- `kernel/src/bridges/compute/viewport-fetch-manager.ts` owns viewport movement fetches, prefetch state, and force refresh.
- `kernel/src/bridges/mutation-result-handler.ts` owns semantic mutation results and metadata cache updates.
- `canvas/grid-renderer/src/coordinates/viewport-position-index.ts` depends on position array and hidden-state correctness.
- `apps/spreadsheet` renderer subscriptions depend on coordinator events being the render invalidation signal.
- `contracts/src/core` and Rust `domain-types::CellFormat` depend on CellFormat and palette parity.
