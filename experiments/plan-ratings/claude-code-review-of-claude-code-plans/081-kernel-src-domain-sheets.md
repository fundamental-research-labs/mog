Rating: 9/10

# Review of plan 081 — `mog/kernel/src/domain/sheets`

## Summary judgment

This is an unusually strong, evidence-dense plan. Nearly every factual claim it makes is verifiable against the current tree at the exact line numbers cited, and the diagnoses are correct — not just plausible. It correctly frames the folder as a thin, stateless adapter over the Rust compute-core and then targets precisely the places where that contract is violated (process-global caches, a reimplemented O(n) query, a key-space-confused page-break diff, a read-modify-write blob, and inconsistent error propagation). The improvement objectives map cleanly onto the evidence; the contracts-to-preserve section is concrete and correct; and the dependency/sequencing analysis honestly separates self-contained wins from cross-folder (Rust/bridge) work. The few things keeping it from a 10 are that several high-value objectives are gated on bridge additions whose availability is uncertain, and one or two fixes hinge on a semantic fact (the canonical `PageBreakEntry` position field) the plan flags but does not resolve.

## Verification performed

I read all four production modules, the single test, and confirmed the cross-folder claims:

- `dimensions.ts:31,33` — module-level `rowHeightCache`/`colWidthCache` exist exactly as described; written optimistically in `setRowHeight`/`setColWidth` (`:56-62`, `:114-120`) and read as fallback in getters (`:90`, `:148`). Confirmed.
- `getHiddenRows`/`getHiddenColumns` (`:257-291`) do a `getDataBounds`-bounded per-row/col `await isRowHiddenQuery` loop. Confirmed, including the out-of-bounds correctness gap.
- The one-shot bridge alternative exists: `compute-bridge.gen.ts:215 getHiddenRows(sheetId): Promise<number[]>` (and `:216`), declared `read` in `manifest.gen.ts:208-209`, and `api/worksheet/layout.ts:327,336` already calls `ctx.computeBridge.getHiddenRows/Columns` directly. The plan's "delegate to the existing batch method" recommendation is correct and low-risk.
- `setPageBreaks` (`sheet-meta.ts:223-257`) builds `currentIds = currentEntries.map(e => e.id)`, diffs against `desiredSet` of indices, and removes with `removeHorizontalPageBreak(sheetId, b)` where `b` is an entry `id`. The bridge signature is `removeHorizontalPageBreak(sheetId, row: number)` (`compute-bridge.gen.ts:174`). The key-space conflation is real; the add path (`:253`) is index-based and correct. This is the most consequential bug in the folder and the plan nails it.
- `getPrintSettings`/`setPrintSettings` (`:269-315`) do the shared-blob read-modify-write on `'sheetPrintSettings'` exactly as described.
- Fire-and-forget `void` writers (`:56,114,166-208`; `sheet-meta.ts:176`) confirmed, contrasting with the deliberately-awaited `structures.ts` and its test (`structures.test.ts:1-7`).
- `setUsedRange` no-op (`sheet-meta.ts:144-151`) is re-exported at `api/namespaces/sheets.ts:82-87`. Confirmed it is a live public surface that silently does nothing.
- `_maps: any`/`_origin` parameters present on all four `structures.ts` functions; tests pass `null`. `getFirstId` returns `ids[0]` with no guard (`:70-73`). `getMeta` (`:48-58`) does not populate `usedRange`. All confirmed.
- Schema-as-SSOT wiring confirmed: `domain/workbook/core-defaults.ts:122-147 buildSheetSettingsDefaults()` derives `DEFAULT_SHEET_SETTINGS` from `getSheetMetaDefault` over `SHEET_META_SCHEMA`.

The plan's evidence is faithful to the tree; I found no overstated or fabricated claims.

## Major strengths

- **Diagnosis precision.** Each defect is pinned to a line range and an authoritative alternative, not described vaguely. The page-break and hidden-row findings are genuine correctness bugs, not stylistic nits, and the plan distinguishes the two.
- **Architectural fidelity.** It repeatedly reasserts the real invariant (Rust owns authoritative state; events come from `MutationResultHandler`; render-path getters stay sync) and frames every fix as restoring the adapter contract rather than adding TS-side logic. This is exactly the right altitude for this folder.
- **Honest dependency accounting.** It does not pretend the cache retirement or per-sheet print setter can be done in-folder; it flags them as bridge/Rust changes against generated files and sequences them after the self-contained wins. The "do 1, 3, 6c, 7 first" ordering is sound.
- **Verification gates tied to specific regressions.** The "row hidden outside data bounds is included" test and the "break positions ≠ entry ids round-trip" test directly gate the two real bugs, which is the mark of a plan that understood its own findings.
- **Caller-compat awareness.** It correctly notes that signature changes (await-ification, `_maps`/`_origin` removal, `setUsedRange` deletion) must move in lockstep with `api/` callers and `structures.test.ts`.

## Major gaps or risks

- **Several objectives are not independently landable.** Objectives 2 (retire cache) and 4 (per-sheet print setter) explicitly depend on new bridge methods that may not exist. The plan offers fallbacks ("serialize the RMW," "document-scope the cache onto `DocumentContext`"), but it does not commit to a decision criterion or a definite deliverable for this cycle — so a reader cannot tell what actually ships if the bridge work slips. A clearer "if the bridge method is unavailable, the in-folder deliverable is exactly X" would remove this ambiguity.
- **Page-break fix rests on an unconfirmed fact.** The fix correctness depends on which `PageBreakEntry` field is the canonical position (`min` vs `id`). The plan flags this as a risk and proposes a round-trip test as the guard, but does not resolve it. Since this is the highest-value fix, leaving the keying decision unverified means the implementer could swap one wrong key for another; the plan should require confirming the compute-core semantics before the change, not only after via test.
- **`getMeta`/`usedRange` resolution is left as an either/or.** Objective 7 says "populate it, or remove it from type/schema." Both are reasonable, but the plan does not check whether the `SheetMeta` contract type actually declares `usedRange` as required (which would force one branch). It hand-waves "pick one" without surfacing the constraint that decides it.
- **Optimistic-UI timing risk under-specified.** Making the dimension writers `async` and moving the cache write after bridge resolution (objective 5) could regress UI that relied on synchronous optimistic update. The plan acknowledges this but does not identify which callers, if any, actually depend on the pre-resolve ordering — leaving the audit scope open.

## Contract and verification assessment

The contracts section is the plan's strongest part: it correctly enumerates the invariants that must survive (Rust SSOT, event emission ownership, sync render-path signatures with hidden⇒0 / off-viewport⇒default semantics, `api/` source-compatibility, schema-as-defaults SSOT, idempotent no-op guards) and ties each proposed change back to them. The verification gates are specific and regression-anchored, and the plan appropriately defers the static/build gates (`typecheck`, lint, Jest, contracts declaration rollup) to the normal kernel pipeline rather than running them itself. The one weakness is that the most load-bearing test (page-break round-trip) guards a fix whose key-space choice is still unverified — the gate catches the wrong-key case only if the test data deliberately uses positions that differ from ids, which the plan does say ("break positions ≠ entry ids"), so this is mostly covered. Concurrency framing for the print-settings race is accurate for the single-threaded JS event loop (the lost update is via interleaving across `await` boundaries, which the plan describes correctly).

## Concrete changes that would raise the rating

1. **Resolve the `PageBreakEntry` position-field question inside the plan** (state whether `min` is the canonical position and that `removeHorizontalPageBreak` keys on it), so the fix is not contingent on a fact discovered during implementation.
2. **Commit to a definite in-folder deliverable for objectives 2 and 4** when the bridge methods are unavailable — e.g., "ship the document-scoped, dispose-invalidated cache now; the bridge-backed read is a follow-up" — rather than leaving both branches open.
3. **Surface the `SheetMeta` type constraint for `usedRange`** (required vs optional) and let it decide the populate-vs-remove branch in objective 7, instead of "pick one."
4. **Name the specific `api/` call sites** affected by await-ification and `_maps`/`_origin` removal (the plan already cites `layout.ts:316,322`; extend that to the full set for `setFrozenPanes`, `setUsedRange`, and the structure callers) so the lockstep change set is bounded.
5. **Specify orphan-pruning ownership concretely** — which function in `domain/workbook`'s sheet-delete path invokes the print-settings/cache prune, and via what call — since this is the one place the fix reaches outside the folder for correctness rather than just type-compat.
