Rating: 8/10

Summary judgment

This is a strong, source-grounded plan. It correctly scopes `what_if` as the Scenario Manager rather than Goal Seek/Data Tables, separates persisted scenario definitions from session-scoped apply/restore state, and identifies several real production-path issues in the current Rust implementation. The evidence appendix matches the source shape: `active_state` only refreshes definition status, `update` replaces by a pre-read array index, validation uses byte length, corrupt JSON bridge values silently become empty arrays, and the local tests do not cover apply/restore behavior.

The rating is not higher because two pieces are not implementation-ready. First, O1 proposes reporting `cell_mutation_status` as `"dirty"`, but the public TypeScript contract currently narrows `cellMutationStatus` to `'clean' | 'conflicted'`; implementing the plan literally would create a wire-contract mismatch. Second, O6 identifies a real reload/data-loss gap, but leaves the storage/lifecycle contract open enough that it needs a separate design before implementation.

Major strengths

- The plan is evidence-led and prioritizes production correctness rather than cosmetic cleanup. O1, O3, O4, and the apply/restore test backfill are high-value issues for this folder.
- It preserves key architecture boundaries: durable CRDT scenario definitions stay separate from Rust-owned session apply/restore state, and `prepare_apply` / `prepare_restore` remain read-only planners whose edits are committed by the engine.
- O4 is directionally correct: re-resolving by id inside the write transaction and mutating the existing Y.Map is the right CRDT-friendly replacement for remove+insert by stale index.
- The sequencing and parallelization notes are useful. Small local fixes, caller-coupled active-state work, and the design-gated reload work are separated cleanly.
- Verification coverage is much better than the current state. The plan calls out that existing tests miss apply, restore, baseline accumulation, skipped cells, guard rails, and active-state recomputation.

Major gaps or risks

- O1 must resolve the status vocabulary before implementation. Current public contracts expose `cellMutationStatus?: 'clean' | 'conflicted'`, while the plan says to return `"dirty"`. Either use `"conflicted"` for divergence or explicitly change the contracts, generated API types, and verification gates.
- O1 needs sharper equality semantics. It should define how to compare `CellValue::Null` against blank cells, formula cells against saved literal values, missing/skipped cells, and scenarios whose `changing_cells` / `values` definition has changed since apply.
- O3 says `chars().count()` is "grapheme-stable"; it is not. It counts Unicode scalar values. That may still be the right improvement over bytes, but the plan should name the exact cross-language unit and reconcile it with TypeScript/JavaScript behavior if the UI also enforces the limit.
- O4 still leaves duplicate-name validation based on a pre-read snapshot. If collaboration safety is the objective, the update path should either re-check duplicate names inside the write transaction or explicitly declare duplicate-name races as an accepted, later-healed invariant.
- O5 is directionally good but underspecified. "Existing logging/telemetry path" should be a concrete mechanism, likely a `tracing::warn!` target or an established diagnostic sink, with a testable capture strategy. The existing `read_json` helper returns `Option`, so the plan should spell out how to distinguish absent keys from malformed present keys.
- O6 is the biggest open design risk. Persisting a restore baseline "in session/document-scoped storage that survives reload" needs an exact storage location, ownership model, cleanup rule, document identity rule, collaboration visibility rule, and migration/no-leak story. Undo-only recovery is not equivalent to a restore baseline and should not be treated as a substitute without a product contract.
- O2 correctly identifies dead Rust helpers, but the plan should explicitly distinguish them from the public `WorkbookScenarios.getActiveScenarioId()` API, which exists in the TypeScript API surface and should continue to derive from `getActiveScenarioState` if the product surface remains.

Contract and verification assessment

The plan is unusually contract-aware for a folder-local plan, especially around session-scoped state, result shapes, skipped-cell semantics, insertion order, and the two-phase apply/restore planner. The main contract defect is the `cellMutationStatus` string mismatch. Because this field is public, the implementing plan must either stay within `'clean' | 'conflicted'` or include a coordinated contracts/types/API-spec update.

The verification gates are mostly appropriate but need to be more exact. For Rust, use the package gate `cargo test -p compute-core` and `cargo clippy -p compute-core`, not a vague `cargo build + cargo test for mog/compute/core`. If O1 changes public status values or O2 affects API generation, add the relevant contracts/types build or codegen diff check and `pnpm typecheck`. The proposed engine-harness tests are the right level for apply/restore behavior because direct session mutation would not verify the production path.

Concrete changes that would raise the rating

- Replace `"dirty"` with `"conflicted"` in O1, or add an explicit contracts/types/generated-API change plan for a new status value.
- Turn O6 into a concrete mini-spec before implementation: persisted fields, storage map/key, lifetime, cleanup after restore, reload rehydration flow, concurrency semantics, and exact tests.
- Define active-cell comparison semantics for null/blank, formulas, missing cells, changed scenario definitions, and skipped cells.
- Re-check duplicate scenario names inside the write transaction for O4, or state why duplicate-name races are acceptable.
- Specify the JSON bridge diagnostic mechanism and how tests capture it.
- Tighten verification to `cargo test -p compute-core`, `cargo clippy -p compute-core`, bridge/codegen diff checks, and TypeScript type gates when public contracts change.
