# 028 — Consolidate and harden the compute-core identity facade (`mog/compute/core/src/identity`)

## Title

Turn `compute/core/src/identity` from a leftover glob re-export shim into the single, curated, well-documented identity boundary for `compute-core`, and close the correctness gap behind misleading resize/format `SheetNotFound` errors.

## Source folder and scope

- Public source folder: `mog/compute/core/src/identity`
- Files in scope (the only three in the folder):
  - `mod.rs` — module doc + `mod grid_index;`, `#[cfg(test)] mod tests;`, `pub use grid_index::GridIndex;`
  - `grid_index.rs` — a one-line glob re-export: `pub use compute_document::identity::*;`
  - `tests.rs` — ~660-line unit-test suite exercising `GridIndex`
- Out of scope but directly adjacent (the real implementation this folder re-exports):
  - `mog/compute/core/crates/compute-document/src/identity/` (`grid_index.rs`, `construction.rs`, `axes.rs`, `axis_mutations.rs`, `cell_lifecycle.rs`, `queries.rs`, `sorting.rs`, and its own `tests/` directory)
  - `mog/compute/core/crates/types/cell-types/src/identity/axis_store.rs` (`AxisIdentityStore<Id>` = `Explicit(Vec<Id>)` | `Runs(CompactAxisIdentityStore)`)
- This folder is treated as public Mog source; this plan file is the only artifact produced and lives entirely under `mog-internal`.

## Current role of this folder in Mog

`compute-core`'s `lib.rs` presents the *Cell Identity Model* as a first-class, top-level box ("per-sheet identity↔position tracker") and declares `pub mod identity;`. The intent is that identity is a named architectural concern owned at the `compute-core` boundary.

In reality the folder no longer contains an implementation. The canonical `GridIndex` was extracted into the lower `compute-document` crate, and this folder is the residue of that extraction:

- `grid_index.rs` is a glob re-export (`pub use compute_document::identity::*;`); `mod.rs` then re-publishes only `GridIndex` from it. So `crate::identity::GridIndex` resolves transitively to `compute_document::identity::GridIndex`.
- The `mod.rs` doc comment still says "This is the Rust port of the TypeScript `GridIndex` from the spreadsheet engine" and describes the implementation as if it lived here. Both statements are stale — the implementation moved and the model grew an `Explicit`/`Runs` compact-axis split (`AxisIdentityStore`) that this folder's doc and tests never acknowledge.
- `tests.rs` is a ~30-test suite that duplicates a *subset* of the tests now maintained alongside the implementation in `compute-document/src/identity/tests/` (`construction`, `row_mutations`, `col_mutations`, `cell_lifecycle`, `sorting`, `queries`, `capacity`, `register_cell`, `combined_operations`, `boundary_mutations`, `invariants`).

What `GridIndex` actually does (for grounding the invariants below): per sheet it maintains row identities (`row_axis: AxisIdentityStore<RowId>`), column identities (`col_axis: AxisIdentityStore<ColId>`), and a *sparse* cell identity map (`cell_at_pos: (row,col)->CellId` and the inverse `cell_to_pos`). RowIds/ColIds are dense from creation; CellIds are lazy (materialized only on first write). It supports construction (`new`, `from_yrs_arrays`, `from_axis_stores`), structural mutation (`insert_rows`/`delete_rows`/`insert_cols`/`delete_cols`, `ensure_capacity[_returning]`), cell lifecycle (`ensure_cell_id`, `register_cell`, `remove_cell`), sorting (`sort_rows` keeps RowIds fixed; `reorder_row_ids` permutes them), range queries, and hex bridges (`row_id_hex`, `row_index_from_hex`, `row_ids_ordered`/`row_ids_dense`, and column equivalents).

### Two problems this folder currently causes

1. **Dual import path / ambiguous ownership.** Within `compute-core/src` alone there are ~33 files importing `crate::identity::GridIndex` and ~26 importing `compute_document::identity::GridIndex` *for the same type*. Half the crate reaches through the facade; half bypasses it into the sub-crate's private module layout. The boundary advertised by `lib.rs` is therefore not actually enforced, and `grid_index.rs`'s glob re-export means the facade's public surface silently tracks whatever `compute-document::identity` exports.

2. **Stale, redundant, and incomplete tests.** `tests.rs` only ever constructs grids via `GridIndex::new`, which always yields `AxisIdentityStore::Explicit`. It never exercises the compact `Runs` path, `from_axis_stores`, `from_yrs_arrays`, `ensure_capacity[_returning]`, `reorder_row_ids`, the hex bridges, or `row_ids_ordered`/`row_ids_dense` (the dense slice that returns `&[]` for compact axes). These are exactly the paths where a real production defect lives.

### The latent production defect

`row_id(row)` / `col_id(col)` delegate to `AxisIdentityStore::identity_at`, which returns `None` when no identity is stored at an in-bounds index — possible for a `Runs` store hydrated from compact persisted axes, or any axis where `len()` (capacity) and identity coverage diverge. Downstream, `storage/sheet/dimensions/rows.rs` and `cols.rs` map that `None` to `ComputeError::SheetNotFound` (e.g. `rows.rs`: `row_id = row_hex.ok_or_else(|| ComputeError::SheetNotFound { .. })`). The user-visible symptom is a row/column *resize* or *format* op failing with a misleading "sheet not found" error even though the sheet exists. (Prior triage of this class of bug concluded it is data-dependent and does not reproduce on freshly-`new`'d/blank sheets — consistent with `tests.rs` only covering the `Explicit`/`new` path.)

This folder is the correct architectural home for stating and guarding the invariant "*every in-bounds row/column index resolves to an identity*", because it owns the boundary type the dimensions code consumes.

## Improvement objectives

1. **One canonical identity path.** Make `crate::identity` the single, intentional way `compute-core` code refers to identity types; eliminate direct `compute_document::identity::…` imports inside `compute-core/src`.
2. **Explicit, curated re-exports.** Replace the glob (`pub use …::*`) with named re-exports of exactly the public surface `compute-core` depends on, so the facade's API is reviewable and stable rather than implicitly tracking a sub-crate.
3. **Accurate documentation.** Rewrite the module doc to describe the facade's role and the real `Explicit`/`Runs` identity model, and to point to the implementation crate — removing the stale "Rust port" / "implemented here" framing.
4. **Strengthen the in-bounds⇒identity invariant** so the `SheetNotFound`-on-resize class of defect is either impossible or surfaces as a precise, diagnosable error rather than a misleading one.
5. **De-duplicate tests.** Stop maintaining a partial copy of the implementation's unit tests here. Keep only tests that genuinely belong at the `compute-core` facade/boundary (path resolution + the cross-boundary resize invariant); move/delete the rest so the implementation's own `compute-document/src/identity/tests/` remains the single source of unit coverage.

These are deliberately not a reduced-scope or test-only patch: the core of the work is a production refactor of the module boundary plus a correctness fix to identity resolution; the test changes are a consequence, not the goal.

## Production-path contracts and invariants to preserve or strengthen

Preserve (must remain true after the change):

- **Path stability for `GridIndex`.** `crate::identity::GridIndex` and `compute_document::identity::GridIndex` must both continue to name the same type during migration; no behavioral change to `GridIndex` itself.
- **Lazy cell identity.** Empty cells have no `CellId`; `cell_count()` counts only materialized cells; `new` materializes zero cells. (`tests.rs::test_new_no_cells_materialized`.)
- **Dense, unique axis identities at construction.** Every in-bounds row/col created by `new` has a unique RowId/ColId; out-of-bounds lookups return `None`.
- **Structural-shift correctness.** `insert_*`/`delete_*` shift sparse cell positions via remove-all-then-insert-all (no mid-shift collisions); deletes return the removed `CellId`s; `at`/`count` clamp to bounds.
- **Sort semantics split.** `sort_rows` remaps cell positions but leaves RowIds fixed (Yrs `rowOrder` authoritative); `reorder_row_ids` permutes RowIds. Both validate bijection under `debug_assertions`.
- **Allocator monotonicity / no duplicate IDs across clones.** `Arc<IdAllocator>` is shared across clones; `from_*` constructors call `ensure_past` so re-hydration never re-issues a live id; virtual `CellId`s (SipHash low bits) deliberately skip `ensure_past` (`cell_lifecycle.rs`).

Strengthen (the substantive production change):

- **In-bounds index ⇒ resolvable identity.** For any axis (`Explicit` or `Runs`) and any index `i < len()`, `identity_at(i)` must return `Some`. The fix belongs at the axis-store / hydration layer (see Dependencies); the facade documents and contract-tests it.
- **Diagnosable failure, not misleading errors.** If a missing identity is ever genuinely possible (e.g. corrupt persisted axis), resize/format paths must produce an identity-specific error (e.g. a dedicated `ComputeError` variant such as `MissingAxisIdentity { sheet, axis, index }`) rather than overloading `SheetNotFound`. The facade is the natural place to expose the helper that classifies this.
- **Reviewable facade surface.** The set of symbols re-exported from `crate::identity` is explicit and enumerated, so adding to it is a deliberate, reviewed act.

## Concrete implementation plan

Ordered so each step is independently compilable and low-risk. Production code edits in steps 2–4 touch consumer files outside the folder; the folder itself changes in steps 1, 3, and 5.

**Step 1 — Make the facade explicit and re-documented (in-folder).**
- In `grid_index.rs` (or a renamed `mod.rs` body), replace `pub use compute_document::identity::*;` with named re-exports of exactly what `compute-core` uses: `pub use compute_document::identity::GridIndex;` plus any axis-store types `compute-core` legitimately needs at this boundary (audit `crate::identity::…` usages first; if only `GridIndex` is consumed via the facade today, keep the surface to `GridIndex` and add others only as the migration in Step 2 reveals real needs).
- Rewrite the `mod.rs` doc comment: describe this module as *the compute-core identity facade* that re-exports the canonical `GridIndex` implemented in `compute-document`, summarize the `Explicit`/`Runs` axis model, and drop the stale "Rust port of the TypeScript GridIndex"/"implemented here" language. Cross-link `cell-types`'s `AxisIdentityStore`.
- Collapse the redundant indirection: `mod.rs` currently does `mod grid_index; pub use grid_index::GridIndex;` where `grid_index.rs` is itself only a re-export. Fold the re-export directly into `mod.rs` and delete `grid_index.rs`, or keep `grid_index.rs` solely if a doc/file boundary is wanted — pick one and make it intentional rather than two layers of pass-through.

**Step 2 — Unify the import path across `compute-core/src` (consumer edits).**
- Migrate the ~26 `use compute_document::identity::GridIndex;` (and any `compute_document::identity::…` paths) inside `compute/core/src` to `use crate::identity::GridIndex;` so all in-crate references go through the facade. This makes the `lib.rs` "identity boundary" real and decouples `compute-core` from `compute-document`'s internal module layout.
- Mechanical, type-identical change; no logic edits. Group by sub-area (`storage/infra/cell_iter/*`, `storage/cells/*`, `storage/engine/*`) for reviewable commits.
- Decision point: if the team prefers the *opposite* canonical (everyone imports `compute_document::identity` directly and the facade is deleted), that is the alternative end-state. This plan recommends the facade because `lib.rs` already advertises identity as a compute-core concern and a curated facade keeps the cross-crate dependency explicit and swappable. Either way, the non-negotiable outcome is *one* path, not two.

**Step 3 — Close the in-bounds⇒identity gap (correctness; spans folder + dependencies).**
- Add a facade-level helper that resolves a row/col identity with an explicit, typed failure, e.g. `GridIndex::require_row_id(row) -> Result<RowId, MissingAxisIdentity>` (and column twin), centralizing the `Option -> error` decision currently scattered in `dimensions/rows.rs`/`cols.rs`.
- Introduce a dedicated error variant (e.g. `ComputeError::MissingAxisIdentity { sheet, axis, index }`) and switch the resize/format/visibility paths in `storage/sheet/dimensions/{rows,cols}.rs` from `ok_or(SheetNotFound)` to the new variant, so a real missing-identity condition is diagnosable and never masquerades as a missing sheet.
- Root-cause fix at the axis layer (in `compute-document`/`cell-types`, see Dependencies): guarantee that hydration of a `Runs`/compact axis (and `from_axis_stores`/`from_yrs_arrays`) yields full identity coverage for `0..len()`, or that `delete_range`/structural ops cannot leave an in-bounds index without an identity. Add a debug-assertion invariant check (extend `compute-document/src/identity/tests/invariants.rs`) asserting `(0..len()).all(|i| identity_at(i).is_some())` after every mutation and after hydration.

**Step 4 — Verify no remaining bypass.**
- After Step 2, a repo search for `compute_document::identity` under `compute/core/src` should return only the facade file itself (and legitimately the `compute-document` crate internals). Lint/CI guard optional but recommended (a denylist test or a clippy `disallowed-methods`-style check is out of scope for this folder but worth a follow-up note).

**Step 5 — De-duplicate the test suite (in-folder).**
- Audit `tests.rs` against `compute-document/src/identity/tests/*`. The cases that only re-verify `GridIndex` unit behavior (construction uniqueness, insert/delete shifts, sort permutations, register/remove, bijection panics, edge cases) are already covered there at finer granularity — delete those from this folder rather than maintaining two copies.
- Replace `tests.rs` with a focused boundary suite that tests what is unique to the facade:
  - The new resize invariant: a sheet hydrated from a compact `Runs` axis can be resized/formatted at every in-bounds row/col without `SheetNotFound`/`MissingAxisIdentity` (regression test for the production defect).
  - `crate::identity::GridIndex` path resolution and curated re-export surface compile and behave identically to the implementation (a thin smoke test is sufficient).
- Ensure the implementation's own `tests/` gains any coverage that was *only* in `tests.rs` and is genuinely missing there (cross-check before deleting), so total coverage strictly increases.

## Tests and verification gates

(Authoring the tests below is part of the plan; this worker does not run any build/test commands.)

- **Unit (in `compute-document/src/identity/tests/`)** — extend, do not duplicate:
  - `Runs`/compact axis: `from_axis_stores`/`from_runs` then `identity_at(i)` is `Some` for all `i < len()`; reverse `position_of` round-trips; `delete_range` preserves full coverage and shifts positions.
  - `ensure_capacity_returning` returns exactly the appended RowIds/ColIds and grows `len()` correctly; idempotent when already large enough.
  - `reorder_row_ids` permutes RowIds and keeps reverse lookups consistent; `sort_rows` leaves them fixed (contrast test).
  - Hex bridges: `row_id_hex`/`row_index_from_hex` (and column twins) round-trip; `row_ids_dense` returns `&[]` for `Runs` while `row_ids_ordered` returns the full ordered vec for both variants.
  - `invariants.rs`: post-mutation/post-hydration full-coverage assertion (Step 3).
- **Boundary (in this folder's `tests.rs`)**: facade path resolution + the compact-axis resize regression test (Step 5).
- **Integration / scenario**: an app-eval or api-eval-level regression that imports a workbook whose persisted axes hydrate as compact `Runs`, then resizes/formats a row and a column and asserts success (guards the user-visible symptom). Reuse existing imported-fixture harnesses rather than adding new production fixtures.
- **Gates**: workspace `cargo build`/`cargo test` for `compute-document`, `cell-types`, and `compute-core`; `cargo clippy` clean (the facade's `#[inline]`/`#[must_use]` style is preserved); a grep gate confirming zero `compute_document::identity` imports remain under `compute/core/src` outside the facade.

## Risks, edge cases, and non-goals

Risks / edge cases:
- **Wide but mechanical blast radius.** Step 2 touches ~26 files; risk is import churn, not logic. Type identity makes it safe; do it in grouped commits.
- **Glob → named surface.** If any consumer relied on a symbol the glob happened to re-export beyond `GridIndex`, the build will fail fast at compile time — audit `crate::identity::…` usages before narrowing (Step 1).
- **New error variant ergonomics.** Adding `ComputeError::MissingAxisIdentity` requires touching error mapping at the WASM/serde boundary; ensure it serializes and is handled by callers expecting the old `SheetNotFound` (search for explicit `SheetNotFound` matching).
- **Virtual CellIds.** Keep the `is_virtual()` skip-`ensure_past` behavior intact in any cell-lifecycle test refactor; it is intentional.
- **Compact-axis root cause may live deeper.** If full identity coverage cannot be guaranteed at hydration (e.g. legitimately sparse persisted axes), Step 3's typed error + on-demand identity materialization becomes the primary fix rather than an assertion; re-scope at that point.

Non-goals:
- No change to the `GridIndex` data model, the CRDT/Yrs `rowOrder`/`colOrder` contract, or the sparse cell-map representation.
- No new compatibility shim and no temporary fallbacks — the dual path is removed, not papered over.
- Not introducing a parallel TypeScript identity model; the "Rust port" framing is being corrected, not re-implemented.
- No performance rework of `cells_in_range` et al. beyond what the correctness fix requires.

## Parallelization notes and dependencies on other folders

- **Hard dependency — `cell-types` (`crates/types/cell-types/src/identity/axis_store.rs`).** The in-bounds⇒identity guarantee (Step 3 root cause) and any `identities_in`/`delete_range`/compact-segment invariant changes live here. This folder's plan depends on that being correct; coordinate with the plan covering the `cell-types` identity folder.
- **Hard dependency — `compute-document/src/identity/`.** Owns the implementation and the authoritative unit tests; Steps 3 and 5 add coverage and invariant assertions there. Treat that crate's plan as the upstream sibling to this one.
- **Consumer coordination — `compute-core/src/storage/sheet/dimensions/{rows,cols}.rs`, `storage/cells/*`, `storage/engine/*`, `storage/infra/cell_iter/*`.** Step 2 (path migration) and Step 3 (error-variant switch) edit these; they can proceed in parallel per sub-area once Step 1's facade is in place.
- **Sequencing.** Step 1 (facade) must land before Step 2 (migration). Step 3's axis-layer root cause should land before or with the facade helper so the regression test is green. Step 5 (test de-dup) lands last, after Steps 3–4 confirm the new invariant.
- **Parallelizable.** Step 2's per-sub-area import migrations are independent of each other and of the `cell-types` work, and can be fanned out once Step 1 is merged.
