Rating: 8/10

# Review of `018-kernel-src-domain-tables.md`

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about the current state of `kernel/src/domain/tables` checks out against the source, and the diagnosis is correct: the folder is an inconsistent facade over `ComputeBridge` that mixes honest delegation with fabricated state, fire-and-forget mutations, no-op stubs, and placeholder identity. The plan correctly identifies that the *real* production lifecycle path already lives in `kernel/src/api/worksheet/tables.ts` (which uses `createTableLifecycle`), while `domain/tables` still uses the older `createTable` — making the central architectural tension ("two facades, one of them stale") accurate rather than speculative.

The plan's core direction — make Rust compute the single source of truth, await mutations, delete fake data, and pick one canonical TS boundary — is the right one. Its main weakness is scope: it is closer to a multi-workstream epic than a single landable plan, and a few of its verification gates and Rust capability assumptions are asserted rather than confirmed.

## Major strengths

- **Claims are verified against code.** Spot-checks all held:
  - `core.ts:createTable` fabricates a local `TableConfig` (id, column ids via `Date.now()/Math.random()`, timestamps, style) and returns it instead of the canonical compute table — exactly as described (`core.ts:234-285`).
  - `updateTable` only handles `name`/`style` and silently drops every other field (`core.ts:359-374`).
  - `operations.ts` uses fire-and-forget `void ctx.computeBridge.*` for `resizeTable`, `toggleTotalsRow`, `setColumnTotalFunction`, and `removeTableColumn`, despite returning `Promise` (`operations.ts:47,69,109,206`).
  - `renameColumn` performs the no-op `renameTable(tableName, tableName)` and relies on a TS updater (`operations.ts:167`).
  - `setColumnTotalFunction` misuses `setCalculatedColumnFormula` instead of a totals API (`operations.ts:109`).
  - `structured-ref-updater.ts` functions are explicit no-ops returning 0 (`structured-ref-updater.ts:37-45`).
  - `range-resolution.ts` returns `table.range` directly and mints placeholder `CellIdRange` with empty ids; `needsMigration`/`migrateLegacyTable` are no-ops (`range-resolution.ts:31-79`).
  - The bridge methods the plan tells implementers to adopt genuinely exist: `createTableLifecycle`, `renameTableColumn`, `convertTableToRange`, `setTableTotalsFunction`, `addTableColumn`, `tableValidateTableName`, `getTableHitRegion` (`compute-bridge.gen.ts:407-439`).
  - The sort claim is exact: `sortApply` reads via `queryRange`, sorts locally in JS, and writes values back with `setCellsByPosition`, bypassing identity/formulas/formatting; sort state lives in a process-local `sortSpecCache` with a `TODO(4.8)` about persistence (`tables.ts:101-103,1350-1409`).
- **Excellent invariants section.** The "Production-path contracts and invariants to preserve or strengthen" block is the best part of the plan — it converts vague goals into concrete, testable assertions (identity stability across create/rename/delete/convert/undo; calculated formulas only on data rows; filter keyed by stable header CellId; convert-to-range returns a real count). This is the kind of contract clarity that makes a plan executable.
- **Honest about not duplicating Rust.** The non-goals explicitly forbid reimplementing table state/formula-rewrite/sort in TS and forbid compatibility shims that preserve stale no-ops. This is the correct posture for this codebase.
- **Good sequencing and conflict awareness.** The dependency order (Rust capability → domain wrappers → consumers → UI → cleanup) is sound, and the call-out that `tables.ts` and `core.ts` are high-conflict files needing single owners is a realistic operational note.
- **Verification spans real test files.** `table-operations.test.ts`, `filter-operations.test.ts`, `sort-operations.test.ts`, and `table-bridge.test.ts` all exist at the cited paths.

## Major gaps or risks

- **Scope is epic-sized, not plan-sized.** 17 implementation steps spanning Rust compute, the kernel domain, the worksheet API, slicers/records/charts, the spreadsheet UI grid, and contracts/file-IO. As written this is several quarters of work across many owners. The parallelization section mitigates this, but there is no MVP / first-landable-slice carved out. A reader cannot tell what the smallest shippable increment is. The plan would be stronger if it named a phase-1 that is independently valuable and verifiable (e.g. "await all mutations + route create through `createTableLifecycle` + delete `createTableCellIdRange` from production imports").
- **Some Rust capabilities are assumed to exist or be addable without confirmation.** Steps 10 and 11 say "Add or use a compute table-sort API" and "Implement Rust detection/application for adjacent writes." The plan does not establish whether a compute table-sort/row-move primitive or an auto-expansion primitive already exists, so it cannot tell the implementer whether this is "wire up" or "build from scratch" work — a large difference in cost and risk. The bridge surface I could verify covers lifecycle/rename/convert/totals/column ops, but not a named sort or auto-expand entry point.
- **A few verification gates are asserted, not verified.** The Rust gates name specific tests (`formula_accuracy_structured_refs`, `xlsx_auto_filter_roundtrip`, `xlsx_sort_roundtrip`, `cargo test -p compute-table`). These are plausible but unconfirmed; if any are misnamed an implementer will burn time. Listing them as "the closest targeted test, e.g. …" would be safer than presenting them as exact.
- **The central facade-vs-shrink decision is deferred into implementation.** Step 1 presents "preferred (facade)" vs "acceptable (shrink to helpers)" and then proceeds assuming the preferred shape. That is a reasonable default, but the decision materially changes steps 2–9 and the consumer-rewrite work in step 16. Because the cheaper option may be "shrink `domain/tables` and let the already-correct worksheet API stay the facade," committing to the heavier facade-everything direction before the audit is a real risk of over-building. The plan acknowledges this but does not gate the decision behind a concrete audit deliverable.
- **`updateTable` strictness is a breaking change with under-specified blast radius.** Step 8 proposes making `updateTable` throw on unsupported fields, and step 16 notes the app kernel API may pass `{ columns }`. The plan flags this but does not enumerate current callers or propose a migration/deprecation window, so "make it strict" could break consumers on landing.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension: the identity, column, structured-reference, filter/sort, and style invariant lists are specific and falsifiable, and they map cleanly onto the minimum-behavior scenarios at the end. The convert-to-range contract (rewrite refs to A1, drop table + table-owned filter, return real count) and the "no placeholder CellId in TS" rule are exactly the right contracts to pin.

Verification is good but uneven. Strengths: it insists on real UI/E2E input paths rather than direct API setup, lists undo/redo and XLSX roundtrip gates, and ties tests to named files that exist. Weaknesses: several Rust `cargo test` selectors are unconfirmed; the TS gate `pnpm test -- kernel/src/domain/tables` presupposes tests that don't exist yet (the plan does acknowledge there are currently none and adds them in step 17); and there is no gate that proves the *negative* — that the removed no-op/placeholder paths are genuinely unreferenced after the change. A "grep proves no production import of `createTableCellIdRange`/`convertStructuredRefsToA1`/`updateFormulasFor*`" check would close that loop.

The constraint against editing the plan or production code was respected; this review only inspected source read-only.

## Concrete changes that would raise the rating

1. **Carve an explicit Phase 1 MVP** that is landable and valuable on its own (await all `domain/tables` mutations, route `createTable` through `createTableLifecycle` returning canonical state, delete placeholder `CellIdRange`/no-op updater imports from production). Defer sort/auto-expansion/consumer rewrites to clearly-labeled later phases.
2. **Confirm or flag the Rust prerequisites** for steps 10–11: state plainly whether a compute table-sort/row-move API and an auto-expansion primitive already exist. If they don't, mark those steps as net-new Rust work with their own design note, not "add or use."
3. **Gate the facade-vs-shrink decision behind a named audit deliverable** (a short doc enumerating every external caller of `domain/tables` mutation exports) and only then commit to a shape, instead of pre-selecting the heavier facade rewrite.
4. **Enumerate `updateTable` callers** and specify the migration path before making it strict, including which fields app/kernel APIs currently pass.
5. **Verify the cited Rust test selectors** or soften them to "closest targeted table/structured-ref test," and add a negative-verification gate that the deleted stubs/placeholders have no remaining production imports.
6. **Tighten the convert-to-range count contract**: specify what `MutationResult` field carries the converted count and add the typed decode helper as an explicit deliverable, since today's path returns the TS no-op's 0.
