Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan. It correctly identifies `kernel/src/domain/charts` as a bridge/projection/cache/lifecycle layer rather than the chart storage or rendering owner, and it is grounded in real modules such as `ChartBridge`, `ChartDataResolver`, `chart-range-references`, `chart-reference-invalidation`, `chart-cell-accessor`, converter modules, cache state, and resolved-spec builders. The plan is especially good at preserving critical invariants around synchronous cached canvas painting, compute-owned chart identity, one-off export compilation, hidden-cell behavior, duplicate imported chart IDs, and public snapshot stability.

The rating is not higher because the plan is broad enough to become several implementation programs, and a few proposed contracts are still described as intent rather than executable acceptance criteria. The dependency index, batching migration, import-boundary checker, and snapshot/hash stability work need more concrete data structures, pass/fail fixtures, and sequencing before multiple agents can implement them independently without overlap or accidental schema churn.

Major strengths

- The ownership model is architecturally sound: compute owns storage/mutations/CellId identity; kernel charts owns live resolution, cache lifecycle, public bridge behavior, and diagnostics; `@mog/charts` owns compiler semantics; canvas owns synchronous paint scheduling.
- The plan focuses on production paths. It targets the real EventBus subscriptions and `ChartBridge` invalidation path instead of benchmark-only shortcuts, and it keeps `renderCached` synchronous.
- It identifies real current issues: per-cell sequential reads in `createCellAccessor`, workbook-wide chart scans on cell events, shared diagnostics mutation inside parallel range resolution, broad casts in `chart-store.update`, and partially informal converter boundaries.
- The invariants section is unusually useful. It names cache miss, stale marks, error retry, stopped-bridge commit rejection, sheet-scoped identity, CellId-before-A1 precedence, hidden-cell masking, and export cache isolation as contracts to preserve.
- The verification matrix is relevant and layered: focused kernel chart tests, neighboring package tests, package typechecks, repo-wide typecheck, Rust gates when compute APIs change, and real UI exercise when chart workflows change.
- The parallelization split is sensible once shared contracts are written first.

Major gaps or risks

- The scope is too large for one unversioned plan. Ownership docs, pipeline contract refactor, deterministic range resolution, dependency indexing, batching, cache-key migration, resolved-spec decomposition, converter audits, manager helper reconciliation, and consumer integration each have non-trivial blast radius.
- The dependency index is under-specified. It needs a named API, entry shape, conservative-sentinel representation, update/query rules, cold-start behavior, and exact behavior for chart create/update/delete, sheet rename/delete, structural edits, table-link changes, import-status transitions, hidden dimension changes, and format/theme events.
- The batching step needs a golden equivalence contract before implementation. `getRangeValues2d` must be compared against current `getValue` behavior for blanks, formulas, errors, rich text, formatted/materialized values, hidden cells, cross-sheet aliases, duplicate cells, and source-linked format lookups.
- Some proposed work overlaps existing implementation. Frame-aware cache suffixes, a cache-key helper module, converter boundary documentation, resolved-spec submodules, package-authority logic, and many targeted tests already exist. The plan should separate "extend existing facility" from "introduce new facility" to avoid churn.
- The checker/lint-rule proposal is not concrete enough. It should name whether this is an ESLint rule, script, test fixture, or package-boundary rule extension, and provide an allowlist for converter submodules that intentionally import generated `*Data` and public config types.
- Snapshot/schema work is risky. The plan says not to change schema by accident, but it should require explicit before/after fixtures for `schemaVersion`, `compilerInputHash`, diagnostics ordering, and public `ResolvedChartSpecSnapshot` declaration output before refactoring builders.
- UI verification is currently manual. For user-facing chart workflows, at least one scripted app/eval or Playwright path using real UI input should be required in addition to manual dev-server exercise.

Contract and verification assessment

The render/cache/lifecycle contracts are clear and fit the production architecture. The range-resolution contracts are also strong, especially identity precedence, unknown-sheet behavior, sheet-qualified range resolution, and deleted CellId diagnostics. The converter and resolved-spec contracts are directionally correct but need stronger executable boundaries.

Verification is mostly appropriate. The plan should add the exact boundary checker command once introduced, likely `pnpm lint:boundaries` or a package-specific script, and should include public contract/declaration gates if `IChartBridge`, snapshot types, generated bridge types, or exported chart config shapes change. For the dependency index and batching work, tests should assert not only final invalidation/render output but also call counts and equivalence with the old semantics on representative chart fixtures.

Concrete changes that would raise the rating

- Split the plan into ordered milestones with explicit merge points: contracts/docs/checker, deterministic resolver, dependency index, batching, cache lifecycle, resolved-spec refactor, consumer integration.
- Define `ChartDependencyIndex` precisely, including its stored key type, query result type, stale/cold sentinel behavior, update methods, and invariants.
- Add acceptance fixtures for range diagnostics and resolved-spec hash determinism that fail under async completion reordering and object-key reordering.
- Specify the exact batch-read semantics and require a test harness that compares old per-cell reads to new range reads across value/error/blank/rich-text/hidden/cross-sheet cases.
- Inventory existing cache-key, converter, and resolved-spec facilities and state the exact deltas instead of reintroducing already-present concepts.
- Turn the converter-boundary checker into a named command with allowlisted files and negative fixtures.
- Add at least one real-input UI/eval test for chart create/edit/invalidate/render, plus the manual dev-server smoke for broader visual confirmation.
