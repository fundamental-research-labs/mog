# 080 — Improve `mog/kernel/src/bridges/wire` (binary viewport & mutation projection boundary)

## Source folder and scope

- **Folder:** `mog/kernel/src/bridges/wire`
- **Role:** The TypeScript decode/apply side of the Rust→TS binary wire protocol — the critical 60fps fast path for all cell rendering and for projecting recalc mutations into the on-screen viewport.
- **Files (in scope, edit targets):**
  - `binary-viewport-buffer.ts` (1,799 lines) — `BinaryViewportBuffer` zero-copy reader, in-place mutation splicing, overflow string pool, `applyDelta()` scroll merge, and the `CellAccessor` flyweight.
  - `binary-mutation-reader.ts` (423) — zero-allocation mutation-blob decoder with typed field accessors.
  - `viewport-coordinator.ts` (639) — single-owner per-viewport coordinator: epoch-stamped overlay, fetch-commit re-application, subscriber fan-out, `ReadonlyBinaryViewportBuffer` projection.
  - `viewport-coordinator-registry.ts` (323) — multi-viewport demux, hydration-deficit backfill, full-viewport-vs-mutation discriminator.
  - `palette-binary.ts` (840) — binary format-palette encoder/decoder (29-field presence mask, borders, gradients).
  - `mutation-classifier.ts` (82) — three-tier (`patch`/`dirty`/`invalidate`) prefetch-invalidation classifier.
  - `viewport-prefetch.ts` (195) — per-viewport overscan bounds + skip-refetch logic.
  - `cell-metadata-cache.ts` (512) — viewport-scoped async-fetch / sync-read cache for spill + validation.
  - `range-metadata-cache.ts` (250) — document-scoped Range metadata cache + `decodeRangeMetaJson` validator.
  - `viewport-test-builder.ts` (≈), `mutation-test-builder.ts` (≈) — pure-TS binary builders.
  - `constants.gen.ts` — **generated, never hand-edit**; changes here mean changing the Rust generator.
  - `index.ts`, `README.md`.
- **Out of scope (named for coupling, not edit targets):**
  - The Rust source-of-truth crate `mog/compute/core/crates/compute-wire` (`constants.rs`, `flags.rs`, `viewport/`, `mutation/`, `palette_binary/`, and the `generate_ts` / `generate-test-fixtures` binaries). Any byte-layout change is a **bilateral** change owned jointly with that crate; this plan treats the wire layout as a contract and only changes it where Rust changes in lockstep (and only via the generator for `constants.gen.ts`).
  - Consumers: `bridges/compute/viewport-fetch-manager.ts`, `compute-core.ts`, `compute-bridge.ts` (drive `commitFetch`/`commitDelta`/`applyMultiViewportPatches`), `bridges/mutation-result-handler.ts` (uses `decodeRangeMetaJson`), `context/kernel-context.ts`, `api/workbook/viewport.ts`, `api/worksheet/viewport-reader.ts`. Ripples into these are flagged as cross-folder dependencies.

## Current role of this folder in Mog

Three data paths converge here (see `README.md:6-41`):

1. **Viewport path** (initial render + scroll): Rust serializes a viewport binary → `ViewportCoordinator.commitFetch()` → `BinaryViewportBuffer.setBuffer()` parses a 36-byte header and lays out cells (32B each), string pool, merges, dims, binary palette, CF extras (data bars 24B / icons 8B), and f64 row/col position arrays. `CellAccessor` reads fields on demand via `DataView`.
2. **Mutation path** (recalc after edits): Rust serializes a mutation blob → `BinaryMutationReader` → `BinaryViewportBuffer.applyBinaryMutation()` splices cell records in place and rebases patch strings into a growable **overflow pool**; the coordinator also stores epoch-stamped overlay entries so a subsequent fetch-commit can re-apply edits that out-raced the fetch.
3. **Multi-viewport path** (frozen panes): a packed blob is demuxed by `ViewportCoordinatorRegistry.applyMultiViewportPatches()` and routed per viewport id, each segment sniffed as either a full viewport binary (→ `commitFetch`) or mutation patches (→ `applyMutationPatches`).

The module's correctness contract is byte-exact agreement with `compute-wire` (Rust). `constants.gen.ts` declares `WIRE_VERSION = 2`, and the viewport header embeds that version in bits 4-7 of flags byte 30. The folder is otherwise clean: no `TODO`/`FIXME`/`HACK` markers, strong test coverage (cross-language fixtures, delta, coordinator, disposal), and a deliberate read-only projection (`ReadonlyBinaryViewportBuffer`) that prevents consumers from mutating buffer state.

## Evidence (observed in the current tree)

- **The wire version is parsed but never enforced.** `BinaryViewportBuffer.getProtocolVersion()` (`binary-viewport-buffer.ts:470-472`) extracts bits 4-7 of the flags byte, but nothing in `setBuffer()` (`:297-436`) or `BinaryMutationReader`'s constructor (`:75-118`) ever compares it against the generated `WIRE_VERSION`. The only production reads of version are the registry's discriminator (below); `getProtocolVersion()` is otherwise asserted only in a unit test (`__tests__/viewport-buffer.test.ts:98`). A Rust deploy that bumps the layout without a matching TS rebuild produces **silent garbage reads** (mis-aligned `DataView` offsets) rather than a loud, attributable failure.
- **The full-viewport-vs-mutation discriminator hardcodes the version.** `viewport-coordinator-registry.ts:266-268` decides whether a packed segment is a full viewport binary (→ `commitFetch`, which alone parses CF extras) or mutation patches (→ `applyMutationPatches`) by testing `(patchBytes[30] & 0xf0) === 0x20`, with `0x20` written as a literal (`VIEWPORT_WIRE_VERSION_BITS = 0x20; // WIRE_VERSION=2`). When `WIRE_VERSION` next increments, this constant does **not** track `constants.gen.ts`; the sniff silently misclassifies every full viewport binary as a mutation blob, dropping CF extras (data bars/icons) and likely corrupting reads. This is a heuristic over an untyped blob with no length/shape cross-check beyond `patchLen >= 36`.
- **`applyDelta()` silently drops CF extras and all position data.** The scroll-merge path is live (`viewport-fetch-manager.ts:366` calls `coordinator.commitDelta()` → `BinaryViewportBuffer.applyDelta()`). The rebuilt buffer's `totalSize` (`binary-viewport-buffer.ts:1297-1304`) omits both the CF-extras section and the row/col position arrays, and the header explicitly writes `data_bar_count: 0` / `icon_count: 0` (`:1322-1323`, comment: *"CF extras not preserved in delta merge"*). Consequence: after any delta-merge scroll, conditional-formatting **data bars and icons disappear** and `hasPositions()` flips to `false`, so `getRowTop()/getColLeft()` return `null` (`:933-954`) until the next full fetch — a visible regression on the most common scroll path, and a loss of the absolute pixel geometry the VPI builder depends on (`setBuffer` comment, `:378-405`).
- **`encodeFormatRecord` writes into a fixed 512-byte scratch buffer with no bounds check.** `palette-binary.ts:477` allocates `new Uint8Array(512)` and then writes a variable-length record (up to 29 fields, plus a full borders record with 9 sides × StrRefs and a gradient with arbitrarily many stops, each stop 8B + 6B StrRef). A richly-formatted cell (all borders + a multi-stop gradient + several string fields) can exceed 512 bytes; the subsequent `tmpView.setUint*` throws `RangeError` or `slice(0, cursor)` reads past the buffer. This runs on the production delta-merge path (`applyDelta` → `encodePaletteBinary` → `encodeFormatRecord`, `:1291`), so a scroll over a heavily-formatted region can throw mid-merge.
- **`applyMultiViewportPatches` is not isolated per segment.** `viewport-coordinator-registry.ts:228-293` loops over packed viewport segments, constructing a `BinaryMutationReader` and calling `commitFetch`/`applyMutationPatches` with no per-segment try/catch. A single malformed/truncated segment (an out-of-range `DataView` read) throws and aborts the whole loop, so **later viewports in the same blob never receive their patches** — a frozen pane can be left stale by a corruption in an earlier pane's segment. Contrast with `_emit` (`viewport-coordinator.ts:627-637`), which deliberately isolates subscriber throws.
- **Header parsing trusts all counts; only position arrays are bounds-guarded.** `setBuffer()` computes section offsets from header counts (`:319-324`) and reads merges/dims/palette/CF-extras unconditionally; only the position-array reads guard against `buffer.byteLength` (`:391,400`). A truncated or corrupt buffer yields out-of-range `DataView` reads at arbitrary points instead of a clean, single rejection.
- **The mutation overlay/key path allocates strings on the hot path.** The coordinator overlay is keyed by `cellKey(row,col)` → `` `${row},${col}` `` (`viewport-coordinator.ts:176-178,375,399`), allocating a string per patched cell per mutation, and re-`parseInt`-ing both halves on every fetch-commit re-application (`:577-579`). A numeric packing constant for exactly this purpose, `PATCH_KEY_COL_BITS = 0x100000` (`binary-viewport-buffer.ts:126-128`), is exported and unit-tested (`__tests__/viewport-buffer.test.ts:566-582`) but **unused by production code** — the intended numeric-key optimization was left unfinished, leaving both a dead export and an avoidable allocation on the recalc fast path.
- **The overflow string pool and string cache grow without compaction between fetches.** `appendRawBytesToOverflowPool` (`:574-588`) only ever grows; `_stringCache` (`:260`) only ever accrues. Both reset on `setBuffer()` (`:411-413`), but a long editing session that stays inside the prefetch region (no full fetch) accumulates superseded strings indefinitely — a slow, bounded-only-by-refetch memory growth on the buffer that is, by design, long-lived.
- **`README.md` File Inventory is stale and contradicts the protocol.** It lists `viewport-buffer.ts` ("Legacy JSON-based … still used during migration") and `viewport-data-provider.ts` — **neither file exists**. It omits `palette-binary.ts`, `range-metadata-cache.ts`, and `viewport-coordinator-registry.ts`. The "Binary Protocol Spec" section still says the palette is a "JSON tail" (`README.md:99`) although it is now binary (`palette-binary.ts`). For the module that anchors a cross-language byte contract, the canonical doc misdescribes the surface.
- **Test builders ship in the production barrel.** `index.ts:26-31` re-exports `buildTestViewportBuffer` / `buildTestMutationBuffer` / `buildPackedMultiViewportPatches` from `viewport-test-builder.ts` / `mutation-test-builder.ts`. No non-test production code imports them (only the barrel and `__tests__`), so absent perfect tree-shaking they enlarge the kernel bundle's module graph with test-only code.
- **`getCellImage()` JSON-parses per call with no memoization.** `CellAccessor.getCellImage()` (`:1735-1744`) `JSON.parse`s the error-string field on every invocation for image cells, returning `unknown`. Minor, but it is a per-cell render-path read for image-bearing cells and is untyped at the boundary.
- **Inconsistent public surface.** `range-metadata-cache.ts` and `viewport-coordinator(-registry).ts` are consumed via deep relative paths rather than the barrel (`mutation-result-handler.ts:45-46`, `context/kernel-context.ts:56`), while prefetch's richer API (`getPrefetchConfigForViewport`, `canSkipRefetch`, `ViewportScrollBehavior`) is exported from the file but not the barrel. The module's "public" boundary is ad hoc.

## Improvement objectives

1. **Make wire-version skew fail loud and early**, at the single parse boundary, instead of silently mis-decoding — without adding per-cell cost.
2. **Eliminate the hardcoded version literal** in the registry discriminator by deriving it from `constants.gen.ts`, and harden the full-viewport-vs-mutation sniff.
3. **Restore CF extras and position arrays through `applyDelta()`** so scroll-merge is visually and geometrically lossless relative to a full fetch.
4. **Make palette encoding allocation-safe** (no fixed-size scratch overflow) on the delta-merge path.
5. **Isolate multi-viewport segment application** so one bad segment cannot starve sibling panes.
6. **Add defensive buffer-length validation** so corruption becomes one clean rejection, not scattered `DataView` throws.
7. **Remove hot-path string allocation** in the mutation overlay by finishing the numeric-key design (or formally retiring the dead constant).
8. **Bound overflow-pool / string-cache growth** during long fetch-free editing sessions.
9. **Realign `README.md` and the `index.ts` barrel** with the actual surface; relocate test builders off the production export path.

## Production-path contracts and invariants to preserve or strengthen

- **Byte layout is owned by Rust.** `constants.gen.ts` is generated; the 36B viewport header, 32B cell record, 40B mutation patch, 24B/8B CF entries, and binary palette layout must remain byte-identical to `compute-wire`. Any layout change is co-authored with the Rust crate and flows through `generate_ts` — never a hand edit. (Preserve.)
- **Cross-language roundtrip is the source-of-truth gate.** `__tests__/cross-language-roundtrip.test.ts` decodes Rust-generated `.bin` fixtures against JSON sidecars and fails loudly with a regeneration command if absent. All changes must keep this green; layout-touching changes must regenerate fixtures. (Preserve.)
- **`ReadonlyBinaryViewportBuffer` projection.** Consumers receive a read-only view; only the coordinator's write methods mutate state (`viewport-coordinator.ts:80-137`). New methods must respect this split. (Preserve/strengthen.)
- **Epoch monotonicity and stale-fetch rejection.** `commitFetch`/`commitDelta` reject `fetchEpoch < _lastCommittedFetchEpoch` (`:496,531`); overlay entries with `epoch <= fetchEpoch` are dropped, survivors re-applied, out-of-viewport survivors pruned (`:570-624`). (Preserve.)
- **Scheduler no-contradictory-patch guarantee.** The "no same-batch dedup required" assumption (`binary-viewport-buffer.ts:613-620`, `viewport-coordinator.ts:342-348`) is backed by `compute/core/src/scheduler/spill.rs`. Keep the reference; do not silently take a dependency on it changing.
- **Synchronous, inline subscriber notification** with per-subscriber isolation (`_emit`, `:627-637`). (Preserve; extend the same isolation discipline to `applyMultiViewportPatches`.)
- **Overflow-pool offset routing invariant.** `display_off >= _mainPoolSize` ⇒ overflow pool; resets on `setBuffer` (`:248-256, 797-822`). Any compaction must preserve this routing or rewrite offsets atomically. (Strengthen.)
- **No new per-cell allocations on the render hot path.** `CellAccessor.moveTo` and the string decode cache are explicitly allocation-conscious; changes must not regress this. (Preserve.)

## Concrete implementation plan

**Phase 1 — Version safety and discriminator (correctness, low risk).**
1. Add a single validation in `BinaryViewportBuffer.setBuffer()` after header parse: if `((flags >> 4) & 0xf) !== WIRE_VERSION`, throw a typed `WireVersionMismatchError` (new, in a small `wire-errors.ts`) carrying observed vs expected version. Mirror the check in `BinaryMutationReader`'s constructor (mutation header has no version field today — confirm with the Rust crate whether to add one; if not, validate at the registry boundary where the discriminator already inspects byte 30). One comparison per buffer/blob — not per cell.
2. In `viewport-coordinator-registry.ts`, replace the literal `0x20` with `WIRE_VERSION << 4` imported from `constants.gen.ts`; extract a named helper `isFullViewportBinary(bytes)` that also re-checks minimum-header length and rejects unknown version nibbles explicitly (so a future-version full-viewport binary is rejected loudly rather than mis-routed to the mutation reader).
3. Wrap each segment body in `applyMultiViewportPatches` in a try/catch that logs with the viewport id and continues to the next segment (matching `_emit`'s isolation), and arm `_hydrationDeficit` on a thrown segment so the next register triggers a backfill.

**Phase 2 — Lossless delta merge (visual + geometry correctness).**
4. Extend `applyDelta()` to carry CF extras and position arrays into the merged buffer: include the CF-extras and position sections in `totalSize`, re-emit `data_bar_count`/`icon_count` from the union of existing + delta entries (re-indexed to the new dense cell layout), and write merged row/col position arrays (existing positions for retained rows/cols, delta positions for the new strip, preserving the trailing sentinel). Where delta and existing disagree on a shared row/col position, prefer the delta (it is newer). Add a focused test in `__tests__/binary-viewport-delta.test.ts` asserting data bars/icons and `hasPositions()` survive a representative scroll-merge.
5. If analysis shows the delta path's complexity outweighs its benefit (it is a large, shortcut-laden rebuild), evaluate replacing it with a Rust-side delta that already emits a complete, self-contained buffer (so TS just `setBuffer`s) — coordinated with `compute-wire`. Capture the decision in the plan's follow-up; do not reduce scope by simply disabling the path.

**Phase 3 — Palette encoder safety.**
6. Replace the fixed `new Uint8Array(512)` scratch in `encodeFormatRecord` with a growable writer (size-then-write, or a small dynamic buffer that doubles on demand), so no format record can overflow regardless of border/gradient richness. Add a test that round-trips a maximal format (all 29 fields, full borders, multi-stop gradient) through `encodePaletteBinary`/`decodePaletteBinary`.

**Phase 4 — Defensive parse + overlay key.**
7. Add a `validateLayout()` pass in `setBuffer()` that verifies the final computed section end (`positions end`) equals/does-not-exceed `buffer.byteLength`; on mismatch throw a typed `WireLayoutError` (one clean rejection). The fetch manager already handles fetch failures; route the throw there.
8. Finish the numeric-overlay-key design: key `_cellOverlay` (and the dim overlays where applicable) by `row * PATCH_KEY_COL_BITS + col` (numeric) instead of the `"row,col"` string, eliminating string alloc on `applyMutationPatches` and `parseInt` on re-application. Keep `PATCH_KEY_COL_BITS` (now genuinely used) and delete the string `cellKey` helper, or — if numeric keys are rejected for readability — formally remove the dead `PATCH_KEY_COL_BITS` export and its barrel re-export. Either way the dead-export/allocation contradiction is resolved.

**Phase 5 — Growth bounding (memory).**
9. Add overflow-pool compaction: when `_overflowSize` crosses a threshold relative to live cells (e.g., a multiple of the cell-count's string footprint), rebuild the overflow pool from the cells currently referencing it and rewrite their `display_off`/`error_off`, or trigger a coordinator-level full refetch. Bound `_stringCache` similarly (e.g., clear on compaction). Gate behind a measured threshold so steady-state editing pays nothing.

**Phase 6 — Surface hygiene (docs + barrel).**
10. Rewrite `README.md` File Inventory to match reality (remove `viewport-buffer.ts`/`viewport-data-provider.ts`, add `palette-binary.ts`, `range-metadata-cache.ts`, `viewport-coordinator-registry.ts`; fix the "JSON tail" palette description to "binary palette section"). Add the `WIRE_VERSION` handshake to the spec section.
11. Normalize `index.ts`: export the symbols consumers actually use through the barrel (`ViewportCoordinator`, registry, `RangeMetadataCache`/`decodeRangeMetaJson`, prefetch helpers) and stop deep-path imports, OR document the intentional internal/external split. Move test builders to a `wire/testing` subpath (or `__tests__/`-local) so they leave the production export graph.
12. Memoize `getCellImage()` per cell offset and give it a typed return (a `CellImageMetadata` interface in contracts) — small, but it tightens a render-path boundary.

## Tests and verification gates

- **Cross-language roundtrip (`cross-language-roundtrip.test.ts`)** must stay green. Any byte-layout-touching change (only via Rust) requires regenerating fixtures (`cargo run -p compute-wire --bin generate-test-fixtures`) and `constants.gen.ts` (`cargo run -p compute-wire --bin generate-ts`). (Per the hard constraints, this plan does not run those commands; it specifies them as gates.)
- **New unit tests:**
  - Version mismatch: a buffer/segment with a non-`WIRE_VERSION` nibble throws the typed error; the registry skips/continues and arms hydration deficit.
  - `applyDelta` preserves data bars, icons, and positions across a scroll-merge (extend `binary-viewport-delta.test.ts`).
  - `encodePaletteBinary` round-trips a maximal format without overflow (new palette test).
  - `applyMultiViewportPatches` delivers later segments when an earlier segment is corrupt.
  - Truncated buffer rejected as one `WireLayoutError` (no scattered `DataView` throws).
  - Overlay numeric-key equivalence: mutation→fetch-commit re-application is identical to the string-key baseline (golden test over `viewport-coordinator.test.ts`).
  - Overflow-pool compaction preserves all decoded strings and offset routing.
- **Existing suites must pass unchanged:** `viewport-coordinator.test.ts`, `viewport-buffer.test.ts`, `binary-mutation-apply.test.ts`, `binary-mutation-reader.test.ts`, `cell-format-drift.test.ts`, `cell-metadata-cache-disposal.test.ts`, `viewport-prefetch.test.ts`.
- **Type/build gates:** package typecheck and lint must pass; if any contracts type is added (`CellImageMetadata`), run the contracts declaration rollup (`pnpm --filter @mog-sdk/contracts build`) so consumers typecheck. (Specified as a gate; not run here.)
- **Manual/app verification:** an app-eval scroll over a region with conditional-formatting data bars/icons confirming they persist through delta-merge; a heavy-edit-while-scrolling session confirming no unbounded memory growth.

## Risks, edge cases, and non-goals

- **Risk — bilateral layout drift.** Adding a version field to the mutation header (if chosen in Phase 1) is a Rust-coupled change; until done, mutation-blob version validation lives at the registry boundary only. Keep the change minimal and co-authored.
- **Risk — delta-merge re-indexing bugs.** CF-extras and position arrays are dense-index/relative-offset keyed; the merge must re-index against the new cell grid. This is the highest-risk phase; gate behind the new delta tests and a roundtrip against a Rust full-fetch of the same region (assert merged == fetched).
- **Risk — numeric overlay key Map perf.** Numeric Map keys avoid string alloc but must remain unique for all valid (row,col); `PATCH_KEY_COL_BITS = 0x100000` exceeds the 16,384 column max — the existing test (`viewport-buffer.test.ts:566-582`) already proves uniqueness across the valid range. Preserve that test.
- **Edge case — overflow compaction during in-flight overlay.** Compaction must not run between `applyBinaryMutation` and overlay storage; sequence it at a safe point (e.g., start of `setBuffer`/idle) and never mid-mutation.
- **Edge case — empty viewports / no positions.** Position-array handling already special-cases empty viewports (`:389-405`); the delta merge must keep the "no positions ⇒ null" semantics rather than fabricating zeros.
- **Non-goals:** no behavior change to the Rust serializers beyond what version validation / lossless-delta coordination strictly require; no rewrite of `cell-metadata-cache.ts` / `range-metadata-cache.ts` logic (only barrel/doc hygiene touches them); no change to the prefetch overscan tuning constants; no compatibility shims — the goal is the correct production path, not a fallback.

## Parallelization notes and dependencies on other folders

- **Independent, can land first (no cross-folder coupling):** Phase 1.2-1.3 (registry discriminator + segment isolation), Phase 3 (palette encoder safety), Phase 6 (README + barrel + test-builder relocation), Phase 4.7 (defensive validation). These are self-contained within the folder.
- **Coupled to `compute-wire` (Rust):** Phase 1.1 if a mutation-header version field is added; Phase 2.5 if the delta path is moved Rust-side. Coordinate with the owner of `mog/compute/core/crates/compute-wire`; both require regenerating `constants.gen.ts` and fixtures via the generator binaries.
- **Coupled to `bridges/compute/`:** typed throws from `setBuffer`/discriminator surface to `viewport-fetch-manager.ts` / `compute-core.ts`; those callers need a catch that triggers refetch/hydration-deficit. Land the throw and the catch together or behind a flag.
- **Coupled to `@mog-sdk/contracts`:** Phase 6.12's `CellImageMetadata` type requires the contracts declaration rollup before consumers typecheck (see `[[mog-contracts-declaration-rollup]]`).
- **Suggested sequencing:** Phase 1 → Phase 4 → Phase 8 numeric-key (correctness/safety foundation), then Phase 2 (highest-risk, after version safety is in), with Phases 3 and 6 runnable in parallel by a second contributor at any time.

## Status

Active plan. Not blocked — the folder exists and evidence is sufficient. Phases 1.1 and 2.5 carry a soft dependency on the Rust `compute-wire` crate owner.
