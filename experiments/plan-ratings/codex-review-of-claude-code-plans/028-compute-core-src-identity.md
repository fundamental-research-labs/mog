Rating: 7/10

Summary judgment

This is an above-average plan: it is source-grounded, aims at the production identity path, and correctly treats identity as a contract boundary rather than a cosmetic cleanup. The diagnosis of stale facade docs, duplicated tests, mixed `crate::identity::GridIndex` versus `compute_document::identity::GridIndex` imports, and misleading `SheetNotFound` mappings in row/column identity consumers is broadly valid.

The rating is held back by one major architectural error and a few evidence gaps. `GridIndex` is defined in `compute-document`, so compute-core's facade cannot add inherent `GridIndex::require_row_id` / `require_col_id` methods while continuing to re-export that external type. The plan also overstates the public API risk of the current glob re-export: `grid_index` is a private child module and `mod.rs` publicly re-exports only `GridIndex`, so the facade's public surface is not actually `compute_document::identity::*`.

Major strengths

- The plan correctly identifies the current folder shape: stale module docs, private `grid_index.rs` pass-through, and a large local test suite that mostly duplicates implementation-crate `GridIndex` tests.
- The import-path objective is well aligned with the advertised `compute-core` boundary. A grep confirms many direct `compute_document::identity::GridIndex` imports remain under `compute/core/src` while many other call sites already use `crate::identity::GridIndex`.
- The production-path concern is real: `storage/sheet/dimensions/{rows,cols}.rs`, `storage/properties/row_col.rs`, and `storage/sheet/schemas/columns.rs` still map a missing row/column identity to `ComputeError::SheetNotFound` in write paths.
- The plan names the right deeper owners for the actual invariant: `AxisIdentityStore` in `cell-types` and `GridIndex` construction/mutation in `compute-document`.
- The sequencing is mostly sensible: stabilize the facade, migrate imports, fix the identity-resolution contract, then de-duplicate facade tests.

Major gaps or risks

- The proposed facade-level inherent methods on `GridIndex` are not implementable in compute-core because the type is owned by `compute-document`. The plan must choose one: add methods in `compute-document`, add a compute-core extension trait, add free helper functions, or introduce a newtype facade. This is central enough that the current Step 3 contract is not mechanically executable as written.
- The glob re-export critique needs correction. Replacing `pub use compute_document::identity::*;` with a named import is still a good cleanup, but the current public facade surface is already only `GridIndex` because `mod.rs` does `pub use grid_index::GridIndex` and the `grid_index` module is private.
- The defect statement needs tighter production evidence. There is already `storage/engine/services/structural/dimensions.rs` auto-growing axes before resize and materializing compact axes, plus `compute/core/tests/resize_unmaterialized_axis.rs` covering the original beyond-extent resize failure. The remaining target appears to be gapped/corrupt compact axes or lower-level format/schema write paths, not the whole resize path as described.
- Several proposed implementation tests already exist in `compute-document` or `cell-types`: compact run resolution, dense versus ordered row ids, hex bridge round-trips, sort semantics, reorder semantics, and invariant assertions over all `0..row_count()` / `0..col_count()`. The plan should specify only the missing delta before asking to add more coverage.
- Adding `ComputeError::MissingAxisIdentity` is a broader public contract change than the plan details. It needs explicit updates for `value-types` serialization tests, bridge/API error mapping, TypeScript-facing error handling, and any callers that match `SheetNotFound`.

Contract and verification assessment

The desired contracts are mostly the right ones: lazy `CellId`s, full in-bounds row/column identity coverage, allocator monotonicity, explicit `Runs` behavior, and one canonical import path. The missing piece is ownership: compute-core can document and test the facade, but the full in-bounds identity guarantee must be enforced in `cell-types` / `compute-document` constructors and mutations, or exposed through a compute-core helper that does not pretend to be an inherent `GridIndex` method.

The verification plan is strong in shape but too broad and slightly imprecise. Good gates include `cargo test -p cell-types`, `cargo test -p compute-document`, `cargo test -p compute-core`, matching clippy gates, a grep gate for direct `compute_document::identity` imports under `compute/core/src`, and a production-path regression for compact or malformed persisted axes. It should also include a targeted bridge/error serialization test if a new `ComputeError` variant is added.

Concrete changes that would raise the rating

- Move `require_row_id` / `require_col_id` into `compute-document`, or redesign them as a compute-core extension trait/free helper with an explicit name and import contract.
- Rewrite the facade-surface motivation to say "remove private-module implementation leakage and stale docs" rather than claiming the current public API is a glob.
- Narrow the bug contract to the exact remaining failure mode after existing resize auto-grow: compact-axis gaps, corrupt persisted axis payloads, or format/schema callers that bypass engine-level capacity materialization.
- Add an evidence table mapping each proposed deleted facade test to the existing `compute-document` test that preserves coverage, and list only genuinely missing tests.
- Expand the new-error-variant work item to cover `value-types` bridge serialization, TypeScript/kernel error expectations, and every explicit `SheetNotFound` match affected by the change.
