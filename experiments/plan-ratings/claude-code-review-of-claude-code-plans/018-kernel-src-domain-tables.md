Rating: 9/10

# Review of plan 018 — `mog/kernel/src/domain/tables`


## Summary judgment

This is an unusually strong, evidence-grounded plan. Nearly every concrete assertion is verifiable against the source with the cited line numbers, and the diagnosis of the folder's "partially-stale, partially-bypassed" state is correct. The plan correctly identifies a live correctness bug (`renameColumn` never persists), a systemic reliability defect (`void`-discarded mutations), a fabricated-state hazard in `createTable`, and an `updateTable` that silently drops most of the `Partial<TableConfig>` it advertises. It pairs each finding with the already-existing dedicated bridge method and proposes awaited, result-aware replacements. The phasing is sensible, the contracts/invariants section is specific, and the verification gates are concrete (including the repo's contracts-rebuild rule). The one substantive weakness is that the central architectural decision — Phase 6's "make the domain the canonical service and have the API delegate to it" — is asserted as recommended without fully weighing the lower-risk alternative (delete the dead/buggy write modules outright), given the API path already works correctly and directly.

## Verification performed

I read all files in scope and confirmed the plan's claims:

- `void`-discarded mutations: `operations.ts:47,69,109,134,206`, `calculated-columns.ts:30,47` — confirmed; `core.ts` writes (`createTable`, `deleteTable`, `updateTable`) correctly `await`. The inconsistency is real.
- `renameColumn` no-op bug: `operations.ts:167` calls `renameTable(tableName, tableName)` "to trigger sync" and only updates TS-side formulas; the column name is never persisted. `renameTableColumn(tableName, columnIndex, newColumnName)` exists at `compute-bridge.gen.ts:425`. Confirmed — this is a genuine product bug.
- `setColumnTotalFunction` hardcoded SUBTOTAL map: `operations.ts:90-109`; `setTableTotalsFunction` exists (`compute-bridge.gen.ts:421`) and is used correctly by the API at `api/worksheet/tables.ts:1013`. Confirmed.
- `createTable` fabricates `TableConfig` with `Date.now()`/`Math.random()` ids and `Column${i+1}` names and calls the legacy `createTable` bridge method: `core.ts:236-282`. `createTableLifecycle(..., style)` exists (`compute-bridge.gen.ts:409`) and is used by the API at `tables.ts:292`. Confirmed.
- `updateTable` forwards only `name` and `style.preset`: `core.ts:367-373`. All other dedicated setters (`setTableAutoExpand`, `setTableAutoCalculatedColumns`, `setTableBoolOption`, `toggleTotalsRow`, `toggleBandedRows`) exist in `compute-bridge.gen.ts:414-425`. Confirmed.
- Dead stubs: `createTableCellIdRange`, `needsMigration`, `migrateLegacyTable` (`range-resolution.ts:49-79`) and `hasMergedCellsInRange` always returns `false` (`core.ts:195-201`). Confirmed.
- `console.log` diagnostics: `core.ts:395,436`, `operations.ts:139,171,201`. Confirmed.
- Non-deterministic ids: `custom-styles.ts:200-201` (`ts-${Date.now()}-${Math.random()...}`) and `core.ts:238,254`. Confirmed.
- Duplicated row-band geometry: identical `dataStartRow/dataEndRow` math in `core.ts:493-494`, `calculated-columns.ts:82-83,111-112`, `auto-expansion.ts:40-41`. Confirmed.
- API bypasses the domain write modules: `api/worksheet/tables.ts` calls the bridge directly at `:292,528,668,1013`; no production module imports `operations.ts`, `auto-expansion.ts`, or `calculated-columns.ts`. The `apps/spreadsheet` table coordination reaches table behavior through the public `@mog-sdk` Workbook API, not these domain functions. Confirmed.

## Major strengths

- **Diagnosis is accurate and falsifiable.** Line-number citations resolve to exactly what the plan describes. This is the difference between a plan a reviewer can trust and one that must be re-derived from scratch.
- **Bridge-method readiness is verified, not assumed.** Every dedicated method the plan proposes routing to (`renameTableColumn`, `setTableTotalsFunction`, `createTableLifecycle`, `setTableAutoExpand`, `setTableAutoCalculatedColumns`, `setTableBoolOption`, `toggleTotalsRow`) genuinely exists, so "no bridge changes required" holds and the cross-folder dependency on `bridges/compute` is read-only.
- **Correct identification of "Rust is source of truth" as the governing invariant**, with the `createTable` read-back fix flowing directly from it.
- **The `updateTable` decision is framed correctly**: honor the full `Partial` or *narrow the type so unsupported fields cannot compile*. Preferring the compile error over silent drop is the right call and surfaces hidden callers.
- **Verification gates are real gates**: per-mutation bridge-call assertions, an explicit regression test for the `renameColumn` persistence bug, `createTable` authority equality against `getTableByName`, geometry golden tests, and the contracts-rebuild requirement (consistent with the repo rule that consumers can't typecheck until `@mog-sdk/contracts` is rebuilt).
- **Risks section anticipates the right hazards**: behavior shift from awaiting previously-swallowed errors, `createTableLifecycle` auto-naming parity (`requestedName: null`), and `setTableTotalsFunction` depending on a stable `column.id` from the wire converter.

## Major gaps or risks

- **Phase 6 (consolidation) is the weakest link and the largest risk, yet least justified.** The API path is already correct and directly awaited. The plan's recommended direction — invert it so the API delegates to the domain — is a substantial refactor touching a healthy, working file, justified mainly by "single implementation." The lower-risk alternative is to **delete the dead/buggy domain write modules** (`operations.ts`, `calculated-columns.ts` writes, `auto-expansion`'s resize-then-rename) and keep the read helpers + pure modules. The plan should explicitly weigh delete-vs-delegate with a decision rule, not defer the entire direction to a one-paragraph Phase 0. As written, a reader could execute Phases 1–5 (hardening modules that no production caller uses) and only discover in Phase 6 that the cleaner outcome was deletion.
- **"Test-only callers" framing is slightly imprecise.** I could not confirm even test imports of these write modules within the kernel; the public-API test (`__tests__/api/worksheet/tables.test.ts`) exercises the API path. The plan should state the caller inventory precisely, because the entire risk calculus for Phases 1–3 depends on who actually invokes these functions today. If the answer is "nothing," that strengthens the deletion option and weakens the "behavior shift from awaiting" risk.
- **`autoExpandTableColumn` Phase 3 has a subtle ordering issue the plan half-addresses.** It proposes `addTableColumn(tableName, name, position)` to make column addition atomic — good — but `addTableColumn` adds a column whereas the current code *resizes the range* by one column. The plan should confirm these are semantically equivalent in Rust (does `addTableColumn` extend the range/shift neighbors the same way resize does?) before declaring the two-step eliminable. This is asserted, not verified.
- **`isValidTableName` rewrite is under-specified for the hard case.** The plan says "express the reserved-name guard as an A1-cell-reference test," which is correct in spirit, but the current code's bug is precisely the boundary logic (`letterPart.length === 3 && letterPart <= 'XFD'` is a lexicographic string comparison that misclassifies, e.g., `ZZ1` style names and treats `XFD`-vs-`XFE` incorrectly). The plan should name the exact failure mode it intends to fix and pin the column-bound semantics (max column is `XFD`), not just "explicit predicates."
- **No measurement attached to the O(sheets × tables) concern.** It's flagged then deferred. Either drop it as a non-goal or state a threshold; leaving it as a noted-but-unscoped item invites scope creep.

## Contract and verification assessment

The contract surface is handled well. The plan correctly enumerates the `TableConfig` shape it must preserve, commits to "no field semantics change," and ties `setTableTotalsFunction` to `column.id` provenance through `compute-wire-converters.ts` — the right dependency to flag, since the index→id resolution is where this can silently break. The geometry invariants (`dataRows >= 1`, `colCount >= 1`, immutable start corner) match `core.ts:101-123` and `validateTableResize`. The mutation-ordering invariant ("not complete until `MutationResult` resolves and undo notification runs") is the correct justification for awaiting, and the unit-test requirement that a rejecting bridge mock surface as a rejected promise (not an unhandled rejection) is exactly the assertion that locks in the fix. Gaps: the plan does not specify how it will assert undo *ordering* (only that writes are awaited), and it does not define the acceptance bar for "byte-stable" style normalization round-trips beyond "existing tests stay green" — fine, but it leans on tests it has not inventoried.

## Concrete changes that would raise the rating

1. **Resolve delete-vs-delegate up front.** Replace the deferred Phase 0 with a stated decision and rule: if the caller inventory confirms zero production importers of the write modules, default to deleting them and *not* inverting the API; reserve delegation for the case where a non-API caller exists. This is the single change that most de-risks the plan.
2. **Pin the exact caller inventory** for `operations.ts`, `calculated-columns.ts`, and `auto-expansion.ts` (production and test) and adjust Phases 1–3 scope accordingly. Replace "only tests do" with the verified list.
3. **Verify `addTableColumn` vs resize semantics in Rust** (range extension, neighbor shifting, header naming) before asserting the two-step is eliminable in Phase 3; add a test that the auto-expanded column lands at the right position with the right name.
4. **Specify the `isValidTableName` fix precisely**: state that the A1 guard must treat the column bound as `XFD` and replace the lexicographic `<=` comparison with a numeric column-index comparison; include `XFD1` (reject), `XFE1` (accept as a name), `R1C1`, `_x`, `A1`, leading-digit, and case-insensitive-duplicate cases in the parametrized table (the plan already lists most of these — make the `XFD` boundary explicit).
5. **Define the undo-ordering assertion**, not just await: e.g., a test that interleaves two mutations and asserts the forward-mutation notifications resolve in submission order.
6. **Scope or drop the O(sheets × tables) item** with a concrete threshold, so it doesn't expand Phase 5.
