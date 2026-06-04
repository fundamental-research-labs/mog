Rating: 8/10

Summary judgment

This is a strong, source-aware plan that identifies real defects in `mog/kernel/src/domain/cells`: divergent read paths between `cell-values.ts` and `cell-reads.ts`, lossy error conversion in `computeValueToRaw`, fire-and-forget bridge writes, TS-side full-range/current-region scans, and a misleading barrel surface. The sequencing is mostly right: consolidate reads first, then make writes awaitable, then move heuristic computations to Rust, then clean up exports and stubs.

The rating is not higher because the plan overstates a few audit findings and misses some current production-path details. It omits `cell-viewport-iteration.ts` from the folder inventory, says `getCellIdAt` exists in `cell-values.ts` when the current code only shows duplicates in `cell-reads.ts` and `cell-identity.ts`, and proposes adding a Text-to-Columns preview bridge primitive even though `computeBridge.previewTextToColumns(...)` already exists in the generated bridge. It also does not fully separate high-impact production read paths from apparently legacy or low-use domain write exports.

Major strengths

- The plan correctly treats `cell-reads.ts` as the richer canonical read path. Current code confirms it handles region metadata, spill-anchor formula resolution, materialized/mirror cells, and tracked external formulas, while `cell-values.getData` is a strict CellId plus `getActiveCell` path.
- It is architecturally aligned with Mog's Rust-owned compute model. The plan keeps formula parsing, storage identity, event emission, text-to-columns commit logic, and current-region/count primitives in Rust rather than adding more TS orchestration.
- It specifies meaningful invariants instead of only listing edits: stable Rust-owned CellIds, formula effective-value behavior, region membership, spill/materialized resolution, clear-vs-delete behavior, MutationResultHandler ownership, and forced-text behavior.
- The proposed verification covers the riskiest observable behaviors: read parity, formula null behavior, error preservation, spill/materialized reads, rejected writes, empty-input clear parity, Text-to-Columns preview/commit parity, and current-region correctness beyond the old sampling window.
- It acknowledges cross-folder dependencies on compute bridge, generated types, contracts, and Rust compute-core instead of pretending the cells folder can solve all contract problems locally.

Major gaps or risks

- The scope inventory is incomplete. `cell-viewport-iteration.ts` exists in the source folder and exports an already-awaitable deprecated `clearRange` wrapper over `clearRangeByPosition`, but the plan does not mention it. That matters because the plan is about hardening the whole folder and clear semantics.
- Some audit claims are imprecise. `getCellIdAt` is duplicated in `cell-reads.ts` and `cell-identity.ts`; I did not find a `cell-values.ts` `getCellIdAt` export. The plan should avoid presenting that as a three-way duplication.
- The Text-to-Columns phase is partly stale. The generated compute bridge already exposes `previewTextToColumns(sheetId, sourceStartRow, sourceEndRow, sourceCol, options, maxPreviewRows)`, and Rust has preview implementation/tests. The plan should say to route the domain preview through the existing bridge method and handle the contracts API options to generated bridge options conversion, not start by adding a new primitive.
- Production-path relevance needs a sharper call-site map. Public namespace and worksheet write paths already use awaited bridge calls in several places, while `cell-values.setValue`, `setValues`, and `setFormulaDirect` appear exported but not heavily imported from production APIs. The async-write work is still valuable for exported domain correctness, but the plan should rank these by actual callers and avoid overstating the blast radius.
- The async conversion contract is under-specified. Changing functions from sync `CellAddress`/`void` returns to `Promise<...>` can affect any consumers of the barrel. The plan should define whether this is an internal-only breaking change, whether public API declarations change, and whether any compatibility wrappers are intentionally rejected.
- Error propagation is underspecified. "Wrap bridge rejections in `KernelError`" is directionally right, but the plan should name the error category, preserve original cause/message, and decide whether mutation failures from generated bridge methods should be normalized at this layer or left as transport/kernel errors.
- The typed wire-boundary objective needs exact DTO contracts. `getCellData` is currently generated as `Promise<unknown | null>`, while `RangeQueryResult` and `ActiveCellData` are typed. The plan should specify the Rust/contract type to generate for mirror cell data, including `value/raw`, `cellId/cell_id`, `region`, error values, formula, format, hyperlink, and null handling.
- Current-region semantics need a stronger contract before Rust implementation. The plan should define behavior for empty starting cells, formula cells with null/error results, formatting-only marker cells, merged cells, hidden/filtered rows, full-row/full-column selections, and maximum sheet bounds.

Contract and verification assessment

The plan is contract-oriented and much better than a patch list. Its strongest contract sections are around read invariants, spill/materialized behavior, CellId ownership, and MutationResultHandler ownership. The test plan also targets production behavior rather than test-only paths.

The weak point is that several contracts remain descriptive rather than executable. The typed wire boundary lacks concrete generated type names and field shapes. The awaitable-write conversion lacks an explicit caller compatibility matrix. The Rust primitives for `countCells` and `currentRegion` lack method signatures, return shapes, and semantic fixtures. The Text-to-Columns preview contract should explicitly use the existing bridge method and prove parity against the commit path with the same normalized options object.

The verification gates are broad enough for the intended blast radius. They should be made more concrete by naming the package-level commands expected after implementation, adding a focused `rg "void ctx.computeBridge|void \\(async"` audit gate for this folder, and including generated-bridge/contract regeneration checks when wire types change. Since this review task forbids running verification commands, I did not execute any tests or builds.

Concrete changes that would raise the rating

- Add `cell-viewport-iteration.ts` to the source inventory and decide whether to delete it, keep it as the canonical clear wrapper, or migrate callers away from it.
- Correct the duplication inventory for `getCellIdAt`, and add a small call-site table showing which module currently imports each duplicated read/write API.
- Replace the Text-to-Columns phase with: convert contract `TextToColumnsOptions` to generated bridge `TextToColumnsOptions`, call existing `computeBridge.previewTextToColumns`, delete local split helpers, then verify preview/commit parity.
- Add exact bridge contract specs for `countCells`, `currentRegion`, and typed `getCellData`, including TypeScript signatures, Rust DTO names, generated type locations, and null/error/region field behavior.
- Add an async-write compatibility matrix covering every exported sync write in `cell-values.ts`, `cell-iteration.ts`, and `cell-properties.ts`, plus every importer that must become `await`-based.
- Define the canonical error normalization helper and the formula effective-value helper as named modules/functions before implementation begins, so all read paths can converge on the same contract.
- Expand current-region acceptance tests to include far-out data beyond the old sample window, empty starts adjacent to data, formula-null/error cells, marker/format-only cells, merged cells, and full-row/full-column constraints.
- Add a final cleanup/audit gate: no remaining duplicated read accessors, no untyped `getCellData` parsing where generated types exist, no local Text-to-Columns splitting, no exported no-op `updateCellPosition`, and no fire-and-forget bridge mutations in this folder unless explicitly documented.
