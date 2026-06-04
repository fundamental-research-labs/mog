Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan for `mog/types/data/src`. It correctly treats the folder as a production contract surface, not an implementation folder, and it identifies real issues in the current tree: mirrored Rust-generated types, the non-discriminated filter criteria shape, divergent aggregate/sort vocabularies, inconsistent ID branding, `ChartConfig` bloat, deprecated chart aliases, stalled table identity migration, transient fields mixed into persisted filter state, and the empty root barrel.

The rating is not higher because several of the most important changes are still specified as directions rather than verifiable contracts. In particular, the generated-type re-export strategy is the architectural hinge of the plan but is left unresolved; the canonical aggregate/sort vocabulary is not enumerated; and some "independent" steps actually require persistence, migration, or consumer coordination.

Major strengths

- The plan is grounded in concrete source evidence. The cited line-level observations match the current package shape, including the 12 source files, package exports, empty `src/index.ts`, generated-type mirror comments, flat `ColumnFilterCriteria`, `FilterState` runtime fields, and the chart/table deprecations.
- It fits Mog's architecture by preserving the Tier 1 type-package boundary, the cell identity model, subpath imports, conditional-format re-export, and near-zero runtime footprint.
- It prioritizes production-path contract quality: stricter discriminated unions, branded IDs, generated-vs-handwritten drift prevention, persisted/runtime separation, and declaration-surface checks are all appropriate for this folder.
- The sequencing mostly starts with low-risk type-surface cleanup and defers broad migrations until dependent consumers can be updated.
- The verification section is materially better than a generic "run typecheck" list: it calls for declaration diffs, serde/round-trip gates, import-boundary linting, generated-vs-manual drift checks, and app/api eval coverage for filters, pivots, and charts.

Major gaps or risks

- Step 10 is under-specified. `@mog/types-data` is layer 0, while `kernel/src/bridges/compute/compute-types.gen.ts` is kernel-layer generated output. The plan recognizes the import-direction hazard, but it does not choose an implementable target such as generating the shared DTOs into `types-data`, moving codegen output to an allowed type package, or creating a separate generated type package. Without that decision, the primary objective remains blocked.
- The aggregate and sort vocabulary unification needs an explicit mapping table. It should define the canonical domain names, the exact wire spellings, legal per-feature subsets, deprecated aliases if any, and serialization adapters. Saying "generated pivot type wins" is not enough for grouping subtotal codes, table totals, filter sort state, and existing API consumers.
- The SheetId/FieldId branding objective should distinguish public domain contracts from Rust wire DTOs. There is already a kernel invariant that treats generated wire `sheetId: string` as a seam to brand on read. The plan should say which generated shapes remain raw wire types, which public contracts become branded, and where `toSheetId`/field-id factories live.
- Versioning additions are not just local type edits. Adding `schemaVersion` to persisted Yjs shapes needs default-fill rules, migration ownership, old-document behavior, and acceptance tests. The plan currently labels part of Step 9 as independently parallelizable, but the persistence contract makes it cross-folder.
- Chart cleanup is directionally right but too broad for a single acceptance contract. `ChartConfig` decomposition, alias removal, string-union tightening, z-order relocation, and `extra?: unknown` narrowing should each name the exact non-breaking shape guarantee or the exact consumer migration gate.
- There is a small sequencing inconsistency: the concrete steps place axis-string tightening before chart decomposition, while the parallelization notes say decomposition should precede or merge with it.

Contract and verification assessment

The plan has good verification instincts: whole-workspace typecheck, declaration output comparison, serde/OOXML round trips, import-boundary lint, generated drift checks, and app/api evals all match the risk profile. The missing piece is precision. Each step should have a crisp "done when" contract, including the scoped package typecheck, the exact declaration/export snapshot to compare, the precise app/api eval scenario names, and the import-boundary rule expected to fail if generated types are imported from the wrong layer.

For wire-facing changes, the plan should require before/after fixtures that prove serialized field names and enum members are byte-compatible, not only assignability-compatible. For persisted-shape changes, it should require old-document read/default tests in addition to typecheck.

Concrete changes that would raise the rating

- Choose the generated-type architecture before implementation: generate canonical DTOs into `types/data/src/generated`, promote them to a new allowed type package, or explicitly defer re-exporting and add only a structural drift test as this plan's deliverable.
- Add mapping tables for aggregate functions, sort axes, color axes, deprecated chart aliases, and generated-vs-public ID branding boundaries.
- Split the plan into type-only local steps and cross-folder migration steps with separate acceptance gates, especially for table `rangeIdentity`, chart alias removal, schema versioning, and generated DTO adoption.
- Add exact verification commands and artifacts: scoped `@mog/types-data` typecheck, repo-wide TypeScript typecheck, declaration/export-surface diff, import-boundary lint, generated drift test, relevant serde/OOXML round-trip suites, and named filter/table/pivot/chart app/api evals.
- Define rollback-free migration contracts for persisted documents: default `schemaVersion`, legacy field read behavior, and the point at which deprecated fields may be removed.
