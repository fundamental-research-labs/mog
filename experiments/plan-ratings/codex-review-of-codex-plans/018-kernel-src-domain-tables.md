Rating: 8/10

Summary judgment

This is a strong plan with the right architectural direction: it treats Rust compute as the durable owner of table lifecycle, structured references, filters, sorting, range identity, and mutations, and it correctly identifies that `kernel/src/domain/tables` currently presents a misleading TypeScript facade over mixed canonical and stale behavior. The diagnosis matches the source: `core.ts` still fabricates returned table configs after `createTable`, `updateTable` ignores most fields, `operations.ts` and `calculated-columns.ts` fire bridge mutations without awaiting them, `renameColumn` is effectively a no-op, `range-resolution.ts` mints empty CellId ranges, and the worksheet table API already uses newer compute paths for lifecycle and convert-to-range.

The plan is not a 9 or 10 because it is more of a broad architecture program than a fully executable implementation contract. It names the right systems and invariants, but several crucial bridge/result contracts remain unresolved, and the sequencing leaves high-conflict cross-folder workstreams with too much discretion.

Major strengths

- Correct production-path focus. The plan explicitly rejects TypeScript reimplementation of table state, formula rewriting, filtering, and sorting, and it targets the actual worksheet API, compute bridge, records, slicers, UI, and import/export surfaces that consume table behavior.
- Accurate source-level findings. The plan calls out the real stale paths: local `TableConfig` construction in `createTable`, fire-and-forget `void ctx.computeBridge.*` mutations, the no-op column rename, no-op structured-ref updater dependency, fake `CellIdRange`, partial `updateTable`, local value-rewrite table sort, and inconsistent custom style name/id handling.
- Good architectural fit. Making `domain/tables` either a canonical awaited facade or a deliberately shrunken helper layer is the right boundary decision. The plan also preserves the genuinely useful pure helpers, especially style normalization and selection geometry.
- Strong invariant coverage. Lifecycle, identity, range, structured-reference, filter/sort, style, async/error, and edge-case invariants are laid out clearly enough to guide reviewers and parallel implementers.
- Verification is broad and mostly production-relevant. It includes targeted TypeScript tests, Rust table/structured-ref tests, app UI exercise through real input paths, XLSX roundtrip, undo/redo, and representative minimum behavior scenarios.

Major gaps or risks

- The facade ownership decision is still deferred. The plan says to choose between a canonical domain facade and shrinking `domain/tables`, then assumes the preferred facade. That is a major architectural choice and should be made explicitly before implementation, with a call graph showing which public consumers move and which helpers remain.
- Bridge result contracts are underspecified. `createTableLifecycle`, `convertTableToRange`, table rename, column rename/delete, table sort, auto-expansion, and filter creation need typed result data contracts. The plan says to extend results if missing, but does not specify exact payloads such as created table name/id, changed formula counts, table filter id, deleted column id, converted count, or sort/filter state receipts.
- Table identity remains too unresolved. The plan correctly flags name/id conflation, but it does not define the target contract for `TableConfig.id`, compute table name, table filter `tableId`, event `tableId`, slicer binding, records, and chart links. Without that, parallel fixes could preserve different identity semantics.
- Range identity is diagnosed but not specified. Saying to audit compute/Yrs bindings is not enough for a high-confidence plan. The target schema for `rangeIdentity`, deprecated `range`, bridge wire conversion, and behavior after row/column structural edits should be pinned down before code changes.
- Scope is very large for one folder plan. The plan reaches Rust compute, generated bridge contracts, worksheet API, sorting/filtering, records, slicers, charts, UI layout, app editing coordination, contracts, XLSX import/export, and docs. That breadth is justified by the table domain, but the plan needs sharper milestones and acceptance criteria per workstream to avoid an unbounded refactor.
- Some implementation suggestions are risky as written. Locating a newly created table by sheet/range when Rust generated the name is not a robust contract; the lifecycle mutation should return the canonical created table identity. Likewise, adding direct domain tests for awaited bridge calls is useful, but it cannot substitute for behavior tests through the public API and compute-backed integration path.

Contract and verification assessment

The contract section is the best part of the plan. It describes the invariants that matter: compute-canonical state after awaited mutations, atomic structured-reference rewrites, table-owned filters, stable header identifiers for filter criteria, no fake CellIds, compute row-move sorting, and consistent async error propagation.

The missing piece is precision. The plan should turn those invariants into concrete API contracts: exact bridge method signatures or result payloads, exact error behavior for missing table/column cases, exact identity fields used by filters/slicers/events, exact update semantics for every mutable `TableConfig` field, and exact sort persistence expectations.

The verification gates are appropriately serious and production-oriented. They should be split into required gates per implementation slice and final integration gates. As written, the list is comprehensive but not operationally bounded, so implementers may either under-run the important gates or treat the full list as too expensive for every small slice.

Concrete changes that would raise the rating

- Decide the TypeScript boundary up front: either make `domain/tables` the canonical facade and list every consumer to route through it, or delete/deprecate mutation wrappers and keep only canonical reads plus pure helpers.
- Define typed bridge result payloads before implementation: created table identity/config, structured-ref update counts, convert-to-range count, filter id/table id, column ids, sort receipts, and auto-expansion receipts.
- Write a target identity contract covering table id/name, filter id/tableId, event tableId, slicer source ids, records row/column ids, and chart table references.
- Replace the range-identity audit item with a concrete desired `TableConfig.rangeIdentity` schema and a bridge/Rust work item when compute cannot currently provide it.
- Break the plan into sequenced milestones with file ownership and acceptance checks: compute contracts first, domain facade second, worksheet API third, records/slicers/charts fourth, UI/import-export final.
- Add a small matrix mapping each currently exported `domain/tables` function to its final status: canonical facade, pure helper, compatibility wrapper with documented behavior, or removed/deprecated.
- Make final verification mandatory through at least one public worksheet API integration test and one real UI input path for create/rename/column rename/convert/filter/sort/auto-expansion, with direct domain tests limited to helper and wrapper behavior.
