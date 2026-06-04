Rating: 8/10

Summary judgment

This is a strong storage-layer improvement plan. It accurately identifies the production role of `compute/core/src/storage`: Yrs as the collaborative source of truth, `CellMirror` and identity/layout/merge indexes as hot-path mirrors, lazy workbook-child creation as a provider-replay requirement, `gridIndex/posToId` as the CRDT position winner, and observer/sync/undo/export as equally important production paths. The plan is appropriately ambitious for a folder that owns workbook, sheet, and cell invariants.

The main weakness is that it is still more of a comprehensive architecture roadmap than an executable implementation specification. It repeatedly says "all metadata families" and "every production writer" without first producing the concrete inventory tables that would make those claims auditable. For this folder, the correct first deliverable is not code; it is a machine-checkable contract matrix covering current Yrs keys, sheet submaps, direct transaction sites, mutation families, mirrors, rebuild/export owners, and expected `MutationResult` payloads. Without that, implementation agents can easily make locally reasonable changes that fail to compose.

Major strengths

- The plan matches the source architecture. `storage/mod.rs` documents the hybrid storage contract, lazy root-vs-workbook-child distinction, and `ensure_workbook_child_map`; `engine/mod.rs` and `engine/stores.rs` confirm the orchestrator and shared-store model the plan describes.
- It correctly treats provider replay, sync rebuild, undo/redo, deferred hydration, XLSX hydration/export, and kernel-facing mutation results as production paths, not ancillary tests.
- It identifies the high-value invariant categories: root schema, workbook-child laziness, visible sheet graph, sheet schema completeness, row/column axes, cell/grid identity, mirror/compute registration, metadata-only anchors, structural edits, and stale conflict losers.
- It avoids whack-a-mole fixes. The plan is category-oriented and asks for systematic coverage across cell writes, sheet lifecycle, metadata families, observer replay, structural operations, and export.
- The verification section is much stronger than average: it calls for compute-core tests, clippy, conditional compute-collab/compute-document gates, sync/provider replay tests, undo/redo tests, hydration/export tests, corrupt-state tests, and production entrypoints.
- The parallelization notes are useful and mostly respect dependency order: invariant matrix first, then registry/schema/write-plan/rebuild/structural work, then final verification.

Major gaps or risks

- The plan needs an explicit current-state inventory before implementation. At minimum, it should list every workbook child key and type, every per-sheet key and type, every direct `transact_mut`/`transact_mut_with` site under storage, every direct `workbook.insert` site, and every production cell-map/grid-index writer. Source inspection shows these are spread across `workbook/settings/map.rs`, `infra/hydration/workbook.rs`, `sheet/crud.rs`, `infra/hydration/sheet/mod.rs`, `cells/values.rs`, `properties/*`, and many engine service modules.
- The invariant checker is under-specified. A production-compiled `StorageInvariantReport` needs a concrete schema: severity, store path, expected value, observed value, owning mutation family, affected entity IDs, whether the failure is hard divergence vs stale cache, and whether legacy/corrupt Yrs input should error or be ignored. Without that, "validate everything" can become either too noisy or too expensive.
- The plan blurs persistent invariants and cache freshness. CF caches, security caches, layout indexes, merge indexes, and compute caches do not all have the same contract as durable Yrs state. The plan should distinguish persistent source-of-truth agreement from lazily invalidated or rebuildable cache state.
- `StorageWriteContext` is conceptually right but needs a precise migration contract. Existing code uses caller-supplied Yrs origins, undo grouping, observer suppression, update buffering, and transactions opened in domain-specific helpers. A new context can silently change undo stack grouping or observer timing unless its API specifies commit sequencing, origin mapping, nested-call policy, and interaction with `MutationCoordinator`.
- The workbook-child registry needs stronger typing and exceptions. The source has workbook-level maps and arrays, but also workbook-level scalars such as schema/version or presence/order flags. A "forbid direct `workbook.insert`" gate will be too blunt unless it distinguishes child YMap/YArray ownership from allowed scalar writes and intentional root-level metadata.
- Sheet lifecycle consolidation is correct but underspecified. The plan should explicitly reconcile the two current schema-construction paths in `sheet/crud.rs` and `infra/hydration/sheet/mod.rs`, plus copy-sheet remapping. It also leaves row/column identity policy as an open question; that policy should be resolved in the first phase before any builder migration.
- `CellWritePlan` risks duplicating existing concepts such as `scheduler::input::CellWrite` and the engine cell-editing write helpers. The plan should define ownership boundaries: parsed user input, storage write plan, compute registration, Yrs write, mirror update, and mutation result building should each have one owner.
- The rebuild/export projection objective is right, but it needs a field-level source-of-truth table. "Current visible workbook state" spans Yrs-only fields, mirror fields, compute-derived fields, cache-backed fields, and XLSX fidelity metadata. Without a table, consolidation can accidentally erase deliberate differences between snapshot, sync hydration, viewport, and export paths.
- The plan reaches into `compute_document`, `compute_collab`, kernel mirror payloads, XLSX import/export, and possibly bridge APIs. It says those dependencies must be considered, but it does not define which public contracts may change and which must remain stable.
- The work is too broad for one implementation slice. It should be split into deliverable phases with independent acceptance gates; otherwise agents may start large migrations before the shared contract exists.

Contract and verification assessment

The high-level contract is good: Yrs remains the collaborative source of truth; mirrors and indexes are synchronized read accelerators; workbook-child creation must remain lazy; sheet creation must be complete and deterministic; `posToId` wins concurrent cell-position conflicts; local mutation, remote replay, undo/redo, hydration, rebuild, and export must converge.

The contract is not yet executable enough. The plan should add concrete matrices for mutation family ownership, storage-family persistence, source-of-truth per field, observer/hydration result payloads, and rebuild/export coverage. Those matrices should be committed before broad refactors and used by tests and review checklists.

The verification gates are production-path relevant and mostly appropriate. The plan correctly avoids test-only proof paths and calls out `YrsComputeEngine::from_snapshot`, `from_yrs_state`, bridge-facing mutations, sync update APIs, undo/redo APIs, import/export APIs, and rebuild APIs. It should tighten the gates by defining phase-specific tests, adding an explicit compile-time or dev-tool gate for workbook-child registry bypasses, and requiring invariant reports to be compared in local-vs-sync-vs-rebuild fixtures. It should also state that broad invariant scans are test/debug/diagnostic tools unless a narrow production invocation point is explicitly justified and performance-checked.

Concrete changes that would raise the rating

1. Add a Phase 0 deliverable: a checked-in storage contract matrix with all Yrs keys, expected Yrs types, owners, lazy/eager creation policy, mirror/cache owners, mutation families, observer result coverage, rebuild/export coverage, and current direct writer sites.
2. Define `StorageInvariantReport` precisely, including severity levels, store paths, entity IDs, expected/observed data, legacy/corrupt-state behavior, and cache-vs-persistent-state classification.
3. Specify the `StorageWriteContext` API before migration: origin enum mapping to current compute-document origins, transaction lifetime rules, observer suppression/update-buffer behavior, undo grouping semantics, nested helper policy, and post-commit invariant hook timing.
4. Replace the generic workbook-child registry proposal with a typed registry table that separates YMap, YArray, and allowed scalar workbook fields, then define the exact static/code-search gate around that table.
5. Resolve row/column identity policy as a prerequisite, or make the first implementation phase an audit that proves the current policy and only then allows sheet schema and structural-operation changes.
6. Define the relationship between `CellWritePlan`, existing `CellWrite`, `write_cell_to_yrs_in_txn`, low-level `YrsStorage::set_cell`, import writes, formula updater writes, and test-support writes.
7. Split the plan into 5-7 implementation phases with independent acceptance criteria: contract matrix/invariant report, workbook-child registry, sheet schema builder, cell identity write consolidation, rebuild/export projection, observer result coverage, structural deltas.
8. Add a field-level source-of-truth table for snapshot, sync hydration, rebuild, export, viewport, and kernel mirror payloads so "canonical visible workbook state" is not left to interpretation.
