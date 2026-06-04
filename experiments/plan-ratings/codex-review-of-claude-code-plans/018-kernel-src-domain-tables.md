Rating: 8/10

Summary judgment

This is a strong plan. The source diagnosis is concrete and mostly validated: `operations.ts` and `calculated-columns.ts` discard bridge promises, `renameColumn` is a no-op for persistence despite `renameTableColumn` existing, `createTable` fabricates ids/columns instead of returning bridge truth, `updateTable` accepts far more than it applies, range geometry is duplicated, and the healthy modules are correctly treated as behavior-stable refactor targets.

The rating is not higher because the plan's consolidation boundary is under-specified for the amount of public/API behavior involved. Moving worksheet table writes through the domain is architecturally right, but the plan does not fully preserve the contracts currently owned by `api/worksheet/tables.ts`: protected-operation checks, event emission, sort cache updates, receipts, undo grouping, calculated-column cell fills, totals-row formula behavior, and table-specific authorization gates. It also misses at least one duplicate table operations module and several active `TablesCore.updateTable` callers that rely on fields the current domain silently drops.

Major strengths

- It is evidence-rich and source-grounded. The listed defects correspond to real code paths in `kernel/src/domain/tables`, and the bridge methods it wants to use already exist.
- It frames Rust compute as the authoritative table state and rejects locally fabricated `TableConfig` state. That is the right architectural invariant for this folder.
- The plan avoids whack-a-mole fixes. Awaiting every mutation, replacing workaround bridge calls, centralizing geometry, and consolidating duplicate write paths are the right systemic moves.
- The sequencing is mostly sound: make mutations awaited and correct before fixing read-after-write auto-expansion and before delegating API calls through the domain.
- The contract section is useful. It calls out mutation ordering, structured-reference/filter lifecycle ordering, style normalization stability, naming, and geometry invariants instead of only listing edits.
- The verification list includes the right categories: rejecting bridge mocks, `renameColumn` persistence, create-table authority, update coverage, naming tables, geometry goldens, and style round trips.

Major gaps or risks

- API consolidation is too broad without an API-level contract. `api/worksheet/tables.ts` does more than call the bridge: it checks protection policies, emits table events, updates `sortSpecCache`, returns operation receipts, wraps calculated-column updates in undo grouping, and has a specific totals-formula workaround after `setTableTotalsFunction`. The plan should specify how each of these moves or stays.
- The plan misses `kernel/src/api/worksheet/operations/table-operations.ts`, which also contains direct table bridge operations and duplicate geometry helpers. A "single implementation" plan that only names `api/worksheet/tables.ts` can still leave drift behind.
- Active production callers pass unsupported fields to `TablesCore.updateTable`, including `columns`, `range`, and `rangeIdentity` in `api/app/app-kernel-api.ts` and `api/namespaces/records.ts`. The plan notes silent no-ops but does not map these callers to dedicated operations such as add/remove/rename column, resize, add row, or records-specific behavior.
- Removing `createTableCellIdRange` is not currently a local cleanup only; app/records callers still call it. The plan should either rewrite those callers first or mark removal as dependent on that migration.
- The totals-function change is under-contracted. Replacing the hand-built formula with `setTableTotalsFunction` updates table metadata, but the worksheet API also writes the visible totals cell formula and works around structured-reference normalization. The acceptance contract should say what must happen to metadata, cell contents, and formula evaluation.
- The logger/id cleanup is directionally right but not actionable enough. I did not find an obvious domain logger surface in the inspected paths, so the plan should name the actual logger/id utility or state that the cleanup depends on creating one.
- The verification gate names `pnpm --filter @mog/kernel typecheck`, but the package is `@mog-sdk/kernel`. That kind of detail matters in a plan that is meant to be executed by workers.

Contract and verification assessment

The plan's core invariants are strong: Rust is source of truth, mutations must await `MutationResult`, table geometry must be centralized, structured-reference/filter delete ordering must remain intact, and style normalization must be byte-stable. Those contracts are specific enough to guide implementation inside `kernel/src/domain/tables`.

The missing contract is the public API boundary. Before Phase 6, the plan should define the domain service surface and a field-by-field mapping from public worksheet/app/records operations to domain operations, including permission checks, emitted events, receipts, cache invalidation, undo groups, and formula side effects. Verification should include `pnpm --filter @mog-sdk/kernel typecheck` and the relevant kernel tests, plus contracts/type-package gates if table contracts move. API/app evals are appropriate only after the production API paths are actually rewired.

Concrete changes that would raise the rating

- Add a complete call-graph inventory for all table mutation paths: `domain/tables`, `api/worksheet/tables.ts`, `api/worksheet/operations/table-operations.ts`, `api/worksheet/internal.ts`, app table/column/record APIs, and records namespace callers.
- Define the canonical domain API before implementation: return types, `MutationResult` handling, error semantics, event/callback responsibilities, permission-gate placement, and which layer owns receipts.
- Replace the vague `updateTable` choice with a field matrix: every accepted field, current callers, desired bridge method, side effects, and tests. Include `columns`, `range`, `rangeIdentity`, `hasHeaderRow`, `hasTotalRow`, style flags, auto options, and filter buttons.
- Specify the totals-function contract across table metadata, totals-row cell contents, structured-reference normalization, and formula evaluation.
- Sequence cleanup after caller migration: do not remove `createTableCellIdRange` or other stubs until app/records callers no longer depend on them.
- Name the actual logger and id-generation utilities, or add a small prerequisite task to introduce them.
- Correct the package gates to `pnpm --filter @mog-sdk/kernel test` and `pnpm --filter @mog-sdk/kernel typecheck`, and include any needed `@mog/types-data` or contracts gates if table types are touched.
