Rating: 8/10

Summary judgment

This is a strong plan. It correctly treats `compute/core/src/identity` as a public facade over the real `compute-document` identity implementation, and it focuses on production identity paths rather than polishing facade-only tests. The plan identifies real architectural pressure points: debug-only permutation checks, silent hydration skips, duplicated `posToId`/`idToPos` key handling, partial compact-axis adoption, and ambiguous read-vs-materialize behavior for virtual/range-resident cells.

The rating is not higher because several changes are specified at the right conceptual level but not yet as crisp implementation contracts. In particular, the mixed compact/explicit axis representation, strict-versus-repair hydration modes, validation report API, and cross-module migration sequence need sharper ownership, API signatures, and compatibility rules before this can be handed to parallel implementers without drift.

Major strengths

- The plan accurately locates the implementation boundary. The public folder is a thin `GridIndex` re-export, while the real behavior lives in `compute-document` and the storage, mirror, scheduler, sync, and structural mutation paths.
- It is production-path relevant. The plan names the actual persisted Yrs shape, in-memory `GridIndex`, `CellMirror`, row/column axis stores, structural operations, sync observer rebuilds, and range/virtual identity paths.
- The invariant list is useful and mostly contract-grade. It captures sparse materialized cells, `CellId` as logical identity, `posToId` as authority over `idToPos`, allocator behavior for virtual IDs, and row/column identity resolution after structural changes.
- It catches a real release-build gap: `sort_rows` and `reorder_row_ids` currently rely on debug-only permutation checks while mutating production state.
- It correctly pushes detailed tests into the canonical `compute-document` identity suite and keeps compute-core facade tests as API smoke coverage.
- The verification gates are appropriately scoped to `compute-document` and `compute-core`, with integration gates called out for sync, structural ranges, relocation, collaboration, and import/export paths.

Major gaps or risks

- The axis-store proposal is under-specified relative to the existing code. `AxisIdentityStore` already supports explicit and compact run stores, plus delete and move operations; the concrete missing piece is insertion without full materialization and persistence of mixed generated/explicit segments. The plan should define the exact representation, serialization shape, and transition rules instead of saying to "extend" it broadly.
- It does not define exact fallible API signatures or mutation atomicity contracts. For example, `register_cell`, `insert_rows`, `delete_rows`, `sort_rows`, `reorder_row_ids`, and hydration helpers need specified `Result` return types, error variants, and "no partial mutation on failure" guarantees.
- The strict-versus-repair hydration model is conceptually right but not actionable enough. The plan should say which callers use strict mode, which use best-effort repair, where repaired Yrs state is written back, and how reports surface to `ComputeError` or diagnostics.
- The call-site inventory is broad but not complete enough for parallel execution. It names many domains, but it should list the exact files/functions that own duplicated key parsing and map maintenance, including both `build_grid_indexes_from_yrs` and `build_grid_from_yrs_for_sheet`, observer changes, value writes, cell editing persistence, snapshots, relocation, comments/hyperlinks, and test canonicalization.
- It risks scope creep by bundling validation, compact-axis redesign, Yrs codec centralization, hydration repair, virtual identity semantics, formula/range anchor behavior, and broad integration tests into one plan. These are related, but the sequencing needs stronger dependency boundaries.
- It does not specify compatibility behavior for documents that have only legacy `rowOrder`/`colOrder`, only compact `rowAxis`/`colAxis`, both, malformed axis JSON, or mismatched axis lengths. That is critical because the current implementation has both legacy and compact entry points.
- It lacks performance acceptance criteria for the compact-axis objective. If the goal is avoiding million-row dense materialization, the plan should include a concrete regression guard or memory/allocation assertion around insert/reorder on large compact axes.

Contract and verification assessment

The contract direction is excellent: make identity validation explicit, centralize position-key encoding, validate inverse maps, and distinguish read-only identity lookup from writes that allocate real IDs. The plan also correctly treats `posToId` as the CRDT winner map and `idToPos` as a derived inverse. That is the right production contract.

The missing contract detail is mostly at API boundaries. `GridIndexValidationReport` needs defined fields and severity semantics. `GridIndexError` needs precise variants for duplicate cell, duplicate position, missing row/col identity, malformed key, out-of-bounds axis, invalid permutation, allocator regression, virtual-real collision, and stale inverse map. The plan should also define whether validation is a pure check, a repairing normalizer, or both.

The verification matrix is broad and relevant. It covers unit, property, hydration, compute-core integration, and formula/range behavior. To be fully implementation-ready, it should add explicit gates for compact-axis non-materialization, malformed persisted axis payloads, both strict and repair hydration modes, and release-build permutation rejection. The listed `cargo test` and `cargo clippy` gates are the right baseline for this Rust work.

Concrete changes that would raise the rating

- Add a call-site inventory table with file/function, current behavior, target behavior, and owning workstream for every identity key parse/write and every Yrs rebuild path.
- Define the exact `GridIndexError`, `GridIndexValidationReport`, and `RowPermutation` APIs, including mutation rollback/no-op guarantees on validation failure.
- Specify the mixed compact/explicit axis representation and serialized schema, including migration rules from existing `Explicit` and `Runs` stores and how `rowOrder`/`colOrder` stay compatible.
- Split hydration into named modes such as `Strict`, `RepairAndReport`, and `BestEffortReadOnly`, then assign each production caller to one mode.
- Add measurable compact-axis performance/memory acceptance tests so structural inserts on large compact sheets cannot silently regress to dense materialization.
- Include an implementation sequence that first centralizes the codec and validation report, then converts hydration/build paths, then changes mutators to fallible contracts, then updates compact-axis insertion, then audits virtual/range call sites.
