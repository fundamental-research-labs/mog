Rating: 7/10

Summary judgment

This is a strong, source-aware plan for hardening the storage layer. It identifies the right architectural center of gravity: yrs is authoritative, `CellMirror` is the hot-path cache, `GridIndex`/axis identities are load-bearing, and the lazy workbook-child bootstrap rule is a real collaborative correctness constraint. The rating is held back because several proposed fixes assume contracts the code does not currently have, some cited bugs are stale or incorrect, and the plan does not fully map the actual production write paths before prescribing API changes.

Major strengths

- The invariant framing is useful. I1/I4/I7/I8 are the right kinds of contracts for this folder, and the plan correctly treats drift between yrs, mirror, grid indexes, compute, and undo as the primary failure mode.
- The plan is mostly production-path relevant. It cites real code in `storage/mod.rs`, `cells/values/storage_methods.rs`, `sheet/structural/mod.rs`, `properties/yrs.rs`, and the pivot hydration TODOs.
- It correctly rejects test-only shims and asks for fail-loud behavior rather than silent no-ops.
- The sequencing is broadly sensible: close coherence holes first, then add invariant verification, then tackle migrations and independent correctness fixes.
- The parallelization notes and cross-folder dependency list are useful, especially around wasm/SDK error-surface coordination and `compute-collab` provider replay coverage.

Major gaps or risks

- The transaction model is underspecified and partly wrong. The plan says to "abort the transaction" by dropping `TransactionMut` after a failed partial write. That is not a safe yrs rollback contract. If a cell map insert has already happened, the fix needs preflight before mutation, construction of the complete prelim before insertion, or explicit compensation. The plan should remove rollback language unless it proves a real rollback API exists.
- The structural mirror proposal assumes `CellMirror::apply_structure_change` returns `Result`. In current source it returns `Vec<RangeId>` and silently returns an empty vector for a missing sheet. Replacing `let _ = ...` with `Err` propagation is impossible without first changing the mirror API and defining what failure means.
- The plan focuses heavily on `YrsStorage::set_cell`, but the primary engine edit path uses `engine/services/cell_editing/direct_edits.rs` and `yrs_persistence.rs`, while batch mutation paths use `engine/services/mutation_handlers/cell_mutations/yrs_writes.rs`. The free `cells/values.rs` paths also discard `SheetDimensionsMut::ensure_capacity` results and silently return on missing maps. A complete Phase 1 needs an entry-point matrix, not only the low-level helper.
- Some evidence is stale or incorrect. The locale-number `rfind(...).unwrap()` is guarded by `s.contains('.') && s.contains(',')`, so the cited panic is not demonstrated. The `char_indices().nth(i).unwrap()` path is also guarded by `i < chars.len()`, though the fixed-width byte/char bug is real. The resize `SheetNotFound` issue already has auto-grow logic and regression coverage in `compute/core/tests/resize_unmaterialized_axis.rs`.
- The lazy workbook-child audit overclaims. There are direct `workbook.insert(...)` sites for `documentProperties`, `stylePalette`, and an inline settings helper. Those may be acceptable or may need conversion, but the plan should classify them instead of saying every writer was already observed using `ensure_workbook_child_map`.
- The plan is very broad. It combines coherence fixes, invariant verifiers, legacy schema retirement, pivot migration, global allocator cleanup, compact property diagnostics, UTF-8 fixes, and several lower-priority TODOs. That breadth is acceptable only if the contracts and phase exit criteria are sharper.

Contract and verification assessment

The contract direction is good, but the plan needs more precise API contracts. It should distinguish top-level `sheets` from workbook children, define whether low-level storage helpers become fallible or remain internal-only, and spell out the serde/bridge/API consequences of any new `ComputeError` variant such as `AxisIdentityMissing`. Given the existing dimension auto-grow fix, that variant may be unnecessary or should be limited to true invariant corruption.

Verification is directionally good but not strict enough. The gates should name `cargo test -p compute-core` and `cargo clippy -p compute-core` for Rust changes, plus targeted tests for production engine APIs. Storage helper tests are useful, but they cannot be the only proof if the production mutation path goes through `YrsComputeEngine`, mutation dispatch, and service modules. The provider replay test and app/api evals are appropriate integration gates for the lazy-bootstrap and structural resize areas.

Concrete changes that would raise the rating

- Add a complete write-path matrix for single cell, batch cells, import values, structural ops, sheet CRUD, workbook children, and hydration. For each path, list the yrs write, mirror update, grid index update, compute update, undo/origin behavior, and current failure handling.
- Rewrite Phase 1 around preflight and fallible APIs. Avoid any claim that dropping a yrs transaction rolls back partial writes unless proven by docs/tests.
- Decide explicitly whether `CellMirror::apply_structure_change` should become fallible. If yes, specify the signature change and migration. If no, remove the impossible `Err` propagation step and test the actual silent-missing-sheet behavior.
- Remove or demote stale bug claims, especially the guarded locale `unwrap` and already-fixed resize case. Keep the real fixed-width UTF-8 slicing issue and compact-property deserialization diagnostics.
- Classify all direct workbook-child inserts as required eager writes, lazy-helper candidates, or safe import-only writes, then make the Provider Protocol rule enforceable.
- Tighten migration contracts for legacy axis stores and pivots: exact old/new schema shapes, read-tolerant window, export/import parity fixtures, and collaboration behavior during mixed-version sessions.
