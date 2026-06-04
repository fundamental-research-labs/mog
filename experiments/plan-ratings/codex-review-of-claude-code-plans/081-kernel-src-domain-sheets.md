Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan. It correctly frames `kernel/src/domain/sheets` as a thin TypeScript adapter over Rust compute state and identifies real defects with concrete production consequences: bounded hidden-row scans, process-global dimension caches, page-break id/position conflation, fire-and-forget writers, a no-op `setUsedRange`, and very thin test coverage. The sequencing is generally pragmatic and the verification section focuses on observable behavior rather than cosmetic checks.

It is not a 9 or 10 because a few contracts are imprecise. Most notably, generated `ComputeBridge` already exposes per-sheet `getPrintSettings(sheetId)` and `setPrintSettings(sheetId, settings)`, so the print-settings section should not treat a per-sheet bridge setter as a possible missing dependency. The plan also needs a sharper production-path map because several high-level worksheet APIs already bypass these domain functions and call the bridge or sheet-management operations directly.

Major strengths

- The evidence section is unusually specific and mostly matches the source: the hidden visibility scan, module-scope caches, page-break diff bug, `getFirstId` empty-list risk, and missing non-`structures.ts` tests are all real.
- The architectural fit is good. The plan preserves Rust as the source of truth, avoids manual event emission, and keeps the synchronous render getter contract visible.
- It separates self-contained fixes from cross-folder dependencies and calls out generated bridge files as generated rather than hand-editable.
- The proposed tests target contracts that would have caught the actual bugs, especially hidden indices outside data bounds, page-break positions where `id != position`, and bridge rejection propagation.
- The ordering is sensible: low-risk correctness fixes first, then cache and API-surface changes that require more coordination.

Major gaps or risks

- Print settings are mis-sequenced. The existing generated bridge has `getPrintSettings` and `setPrintSettings`, and `api/worksheet/operations/sheet-management-operations.ts` already uses them. The plan should make `sheet-meta.ts` migrate directly to those canonical per-sheet bridge methods, then verify mirror/mutation-result behavior, instead of treating the per-sheet setter as uncertain.
- Production-path relevance needs a matrix. `WorksheetLayoutImpl`, `WorksheetViewImpl`, `WorksheetPrintImpl`, and `WorksheetStructureImpl` often call `computeBridge` or operation helpers directly rather than using these domain wrappers. The plan should distinguish fixes to low-level domain exports from fixes that users hit through the main worksheet APIs and UI.
- The dimension-cache replacement is under-specified. `getRowHeight` and `getColWidth` are synchronous, so an async bridge accessor cannot be their fallback without breaking the stated invariant. The plan should choose a concrete synchronous contract: document-scoped mirror state, a synchronous viewport/snapshot API, or default-only off-viewport behavior.
- The direct sheet-to-viewport lookup is directionally right but currently crosses into bridge/viewport coordination. It needs an explicit dependency contract: how a sheet maps to one or more buffers, which buffer wins, and when entries are invalidated.
- The schema/`getMeta` discussion should separate `SheetMeta` from broader `SheetSettings`. The current `SheetMeta` type visibly misses `usedRange`; the schema contains many additional settings fields that may not belong in `getMeta`.
- Removing `_maps`, `_origin`, and `setUsedRange` may be source-breaking. The plan should specify deprecation vs removal, affected namespace exports, and expected public API compatibility.

Contract and verification assessment

The contract section is one of the plan's best parts. It names the right invariants: Rust-owned state, `MutationResultHandler` ownership of events, synchronous render-path reads, source-compatible API callers, and schema-derived defaults. The test plan is also strong for domain behavior.

The verification gates should be tightened in four places: use the existing per-sheet print-settings bridge methods and assert mutation/mirror behavior; add high-level API or UI/eval coverage for paths that bypass this folder; require cache tests that prove two documents with the same `sheetId` cannot cross-read; and assert the sync getters never call async bridge methods.

Concrete changes that would raise the rating

- Rewrite the print-settings section around existing `computeBridge.getPrintSettings` and `computeBridge.setPrintSettings`.
- Add a production-path matrix listing each planned change, affected public/domain/UI path, caller updates, and required tests.
- Pick one concrete dimension fallback design and make its synchronous contract explicit.
- Define cross-folder dependencies as contracts with owner, generated source, lifecycle, invalidation, and verification requirements.
- Clarify whether `getMeta` only adds `usedRange` or intentionally expands beyond the current `SheetMeta` type.
- Add a source-compatibility plan for removing or deprecating `setUsedRange`, `_maps`, and `_origin`.
