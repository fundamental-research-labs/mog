# 086 — What-If Scenario Manager (`mog/compute/core/src/what_if`)

## Source folder and scope

- **Folder:** `mog/compute/core/src/what_if`
- **Contents:**
  - `mod.rs` — module doc; re-exports `scenarios`. Notes that Goal Seek moved to `crate::solver` and Data Tables to `crate::data_table`; this folder now holds **only the Scenario Manager**.
  - `scenarios/mod.rs` — module layout, Yrs storage-layout doc, public/`pub(crate)` re-exports.
  - `scenarios/types.rs` — limit constants and the session-scoped apply/restore types (`ScenarioSessionState`, `ScenarioBaseline`, `ScenarioBaselineCell`, `ScenarioApplyPlan`, `ScenarioRestorePlan`).
  - `scenarios/storage.rs` — Yrs read/write: `scenarios` map → `items` Y.Array of structured Y.Maps; per-scenario field encode/decode with a JSON-string "bridge" for the `changingCells`/`values` arrays.
  - `scenarios/crud.rs` — `create`, `update`, `remove`, `set_active_scenario_id` (legacy-reject).
  - `scenarios/query.rs` — `get_all`, `get_by_id`, `get_active_scenario(_id)`, `get_count`, `is_at_limit`, `find_by_name`.
  - `scenarios/validation.rs` — name/comment/changing-cells/values validators and the composite `validate_scenario_input`.
  - `scenarios/apply_restore.rs` — `active_state`, `prepare_apply`, `prepare_restore`: build (read-only) edit plans + in-memory baselines that the engine commits.
  - `scenarios/tests.rs` — ~50 unit tests (validation + CRUD only).
- **Scope of this plan:** correctness, collaboration-safety, and clarity of the Scenario Manager (definition CRUD storage + apply/restore planning). Goal Seek, the Solver, and Data Tables live in sibling folders (`crate::solver`, `crate::data_table`) and are out of scope except where the apply/restore guards reference them.

## Current role of this folder in Mog

This folder is the compute-core source of truth for **named what-if scenarios**: a workbook-level collection of saved input sets (`changingCells` + `values`) that a user can apply to swap a group of cells to a saved set of values, compare outcomes, and restore.

Two distinct layers live here:

1. **Persisted scenario definitions** — stored in the Yrs workbook CRDT under `workbook.scenarios.items` (a Y.Array of structured Y.Maps). CRUD + queries operate on this. This is the collaboratively-synced, durable layer.
2. **Session-scoped apply/restore** — *not* persisted. `prepare_apply` snapshots the live values of the target cells into an in-memory `ScenarioBaseline`, returns the edits for the engine to commit via `mutation_set_cells_raw`, and stores the baseline in `YrsComputeEngine.scenario_session`. `prepare_restore` consumes that baseline to revert. `active_state` reports which scenario is currently applied.

Callers: the engine delegation layer (`storage/engine/.../delegations/scenarios_bindings.rs`, `what_if_sync.rs`) and `mutation_dispatch.rs` (`EngineMutation::ApplyScenario` / `RestoreScenario`). The TS/NAPI bridge surfaces these as workbook scenario APIs. The folder doc says it is a port of `spreadsheet-model/src/scenarios.ts`.

## Improvement objectives

Evidence gathered from reading the folder and its callers. Objectives are ordered by production impact.

1. **O1 — Fix stale `cell_mutation_status` (correctness bug).**
   `prepare_apply` hardcodes `cell_mutation_status: Some("clean")` when a scenario is applied (`mutation_dispatch.rs`). `apply_restore::active_state` recomputes only `definition_status`; it never recomputes `cell_mutation_status`. The snapshot field is documented as "Whether the applied cells still match the baseline model," but after the user edits an applied changing cell the status still reports `"clean"`. UI/consumers relying on this to warn "scenario diverged / you have unsaved edits" get a false-negative. `active_state` should compute `cell_mutation_status` by comparing current mirror cell values against the applied scenario's `values` (via the active baseline's cell set), reporting `"dirty"` when any differ.

2. **O2 — Remove the dead/misleading active-scenario query API.**
   `query::get_active_scenario_id` unconditionally returns `None` (`let _ = storage; None`), so `get_active_scenario` also always returns `None`. Both are `pub` re-exports in `scenarios/mod.rs` but have **no Rust callers** in the compute crate (active state flows through `active_state(...)` instead). They are a trap: any future caller reading "the active scenario" via these gets silent wrong answers. Either delete them, or make them delegate to the session-scoped `active_state`/`get_by_id` path so the name matches behavior. (Deletion is the production-correct choice unless an external binding consumes them — see verification gate.)

3. **O3 — Validate name/comment length by character count, not bytes.**
   `validation::validate_scenario_name` and `validate_scenario_comment` test `name.len() > MAX_SCENARIO_NAME_LENGTH` / `comment.len() > …`, i.e. UTF-8 **byte** length, while the constants are documented as character limits (255) matching the TS contracts. A 200-character name in a multibyte script (CJK, emoji, accented Latin) can exceed 255 bytes and be wrongly rejected. Use `chars().count()` for the comparison so the limit is grapheme-stable across locales and matches the cross-language contract.

4. **O4 — Make scenario `update` collaboration-safe (CRDT hazard).**
   `crud::update` does `items_arr.remove(index)` followed by `items_arr.insert(index, prelim)` inside one transaction, where `index` was computed from a **separate read transaction** (`get_all`). Under concurrent collaboration two hazards exist: (a) the index can be stale if another client inserted/removed a scenario between the read and the write, causing the wrong scenario to be replaced; (b) remove+reinsert replaces the whole structured map, so a concurrent edit to the same scenario from another client is silently clobbered (last-writer-wins on the entire scenario rather than field-level merge). Re-resolve the target by **id inside the write transaction**, and mutate the existing scenario's Y.Map fields in place (update changed scalar keys / bridge strings) rather than remove+reinsert, so unrelated concurrent field edits survive and array order is preserved without index arithmetic.

5. **O5 — Reduce JSON-bridge merge granularity for `changingCells`/`values`.**
   `changingCells` and `values` are stored as JSON-serialized strings (`json_any`) inside the scenario Y.Map because Yrs `Any` can't hold deeply-nested structures. This is reasonable for a definition that is edited atomically, but it means any concurrent edit to a scenario's cell set is a whole-string LWW overwrite, and a corrupt/non-deserializable string silently degrades to `unwrap_or_default()` (empty) on read — turning a malformed scenario into a "valid empty" one with zero diagnostics. Objective: keep the bridge encoding (changing it to native Yrs arrays is a larger storage-format migration and is a **non-goal** here), but (a) add a read-time diagnostic/telemetry path so a failed `read_json` is observable rather than silently empty, and (b) document the LWW granularity as an explicit invariant so callers don't assume field-level merge.

6. **O6 — Define behavior for a session reload while a scenario is applied (data-loss gap).**
   Active state and baselines live only in `ScenarioSessionState` and are explicitly *not* serialized. If the document is reloaded (or the engine session is recreated) while a scenario is applied, the baseline is lost: the applied scenario values remain written into the cells, the user has no way to restore the originals, and `active_state` reports no active scenario. The applied values silently become the "real" data. This is a genuine product correctness gap. Objective: make the apply path durable enough to recover — persist the active baseline (or at least the active scenario id + a recoverable original-value snapshot) in session-scoped storage that survives reload within the same document, OR make apply explicitly transactional/undoable so reload-without-restore is at least surfaced. The exact mechanism needs a short design step (see Risks); the plan commits to closing the silent-permanent-write hole, not to a specific storage location.

7. **O7 — Comment hygiene per house rule.**
   `types.rs` comments reference "Excel limit" (lines 12, 15). Per the project convention not to reference that product by name in source comments, reword to describe the limit by intent (e.g. "Maximum number of scenarios per workbook (matches the cross-language contract / `MAX_SCENARIOS`)"). Keep the constant values unchanged.

## Production-path contracts and invariants to preserve or strengthen

- **Limit constants stay binding and cross-language-consistent:** `MAX_SCENARIOS = 251`, `MAX_CHANGING_CELLS_PER_SCENARIO = 32`, name/comment `255`. O3 changes only the *unit of measure* (chars not bytes) for the length checks; numeric values are unchanged and must still match the TS contracts.
- **Active scenario state is session-scoped and never written into the durable workbook CRDT** (today's invariant; `set_active_scenario_id` rejects with `SCENARIO_ACTIVE_STATE_READ_ONLY`, writes scrub the legacy `activeScenarioId` key). O6 must preserve "definitions are durable, applied-cell mutations are normal cell edits" — any reload-recovery store added must not resurrect a *persisted-active-scenario* concept that the engine deliberately removed; it should persist the **restore baseline**, not a CRDT "active" flag.
- **`prepare_apply` / `prepare_restore` remain read-only planners:** they must not mutate engine state; the caller commits edits via `mutation_set_cells_raw` and installs the baseline only after the write succeeds. Preserve this two-phase contract.
- **Apply/restore guard rails stay:** changing cells inside an array-formula (CSE) region or a data-table region are rejected (`validate_scenario_target`). Cells that no longer resolve to a sheet/position are skipped (not errored) and reported in `skipped_cells`. Preserve both behaviors and their result-shape semantics (`skipped_cells` vs `errors`).
- **Baseline accumulation across scenario switches:** applying scenario B while A is active reuses A's baseline and appends B's not-yet-captured originals, so `restore` reverts *all* touched cells to their true pre-apply originals. Preserve this; O1's status recomputation must compare against the *currently applied scenario's* values, not the merged baseline's originals.
- **Result-shape contracts** (`ScenarioCreateResult`, `ScenarioUpdateResult`, `ScenarioRemoveResult`, `ScenarioApplyResult`, `ScenarioRestoreResult`, `ScenarioActiveState`): field names and success/`errors` semantics are wire-visible through the bridge. O1 only fills an existing optional field with a more accurate value; O2 deletes Rust-internal helpers; neither may rename or drop wire fields.
- **Insertion order of `items` Y.Array is the display order** (tests assert this for update/remove). O4 must preserve order while removing the remove+reinsert pattern.
- **Timestamp safety:** reads tolerate non-finite stored timestamps (fall back to `0`); writes use finite `now_millis()`. Preserve the no-panic-on-deserialize property.

## Concrete implementation plan

Work is grouped so independent objectives can land separately. All changes are within `mog/compute/core/src/what_if` plus minimal touch to `mutation_dispatch.rs` for O1 (the only place that sets the initial status).

1. **O7 (comment hygiene) — smallest, do first.**
   - In `scenarios/types.rs`, reword the two limit doc comments to describe intent without the product name; leave values and the `(matching … contracts)` framing intact.

2. **O3 (char-count validation).**
   - In `scenarios/validation.rs`, replace `name.len()` and `comment.len()` length comparisons with `name.chars().count()` / `comment.chars().count()`.
   - Confirm the trim semantics are unchanged (empty/whitespace check stays as-is; the length check applies to the untrimmed input as today, or align to trimmed — choose to match the TS contract; default: keep untrimmed to avoid behavior drift, document the choice).

3. **O1 (live `cell_mutation_status`).**
   - In `apply_restore::active_state`, after resolving `definition_status`, look up the active baseline (`session.baselines.get(&active.baseline_id)`) and the active scenario definition (`get_by_id`). For each `(changing_cell, value)` pair of the active scenario that maps to a live cell, compare the current `mirror.get_cell_value` against the scenario's saved value; set `cell_mutation_status` to `"clean"` if all match, `"dirty"` if any diverge (or the cell now holds a formula where the scenario set a value, etc.). Reuse the same `CellId` resolution + skip rules as `prepare_apply` so a deleted/moved cell doesn't spuriously read "dirty."
   - Change `active_state`'s signature to take the data it needs to read the mirror. Today it takes `(&YrsStorage, &ScenarioSessionState)`; it will additionally need `&CellMirror` (and the scenario definition via `get_by_id`, which it already has storage for). Update the single caller `get_active_scenario_state` in both delegation copies (see O-cleanup note) and the `mutation.rs` accessor accordingly.
   - In `mutation_dispatch.rs` `ApplyScenario`, the initial `cell_mutation_status: "clean"` set right after the write is correct (cells just written == scenario values), so leave it; the fix is that subsequent reads go through the recomputing `active_state`.

4. **O4 (collaboration-safe update).**
   - In `crud::update`, move target resolution into the write transaction: open `transact_mut`, read the `items` array, find the index whose map's `id` key equals `scenario_id` *within that txn*, and update that map's fields in place (set changed scalar keys; rewrite the `changingCells`/`values` bridge strings only when those inputs changed; always bump `modifiedAt`). Drop the read-then-remove-then-reinsert sequence. Keep `remove_legacy_active_scenario_id` scrubbing.
   - If the id is not found inside the write txn (raced delete), return the existing "Scenario not found" `ScenarioUpdateResult` rather than inserting a duplicate.
   - Validation still runs against a pre-read `get_all` snapshot for duplicate-name detection; that's acceptable (duplicate-name is advisory and re-checked on next edit), but resolve the *target* by id in the write txn.

5. **O5 (bridge read diagnostics + documented invariant).**
   - In `storage.rs::scenario_yrs::from_yrs_map`, distinguish "key absent" (legitimately default/empty) from "present but failed to deserialize" for `changingCells`/`values`. On a present-but-unparseable bridge string, emit a diagnostic via the crate's existing logging/telemetry path (do not panic; still degrade to empty so reads don't crash) so corruption is observable.
   - Add a doc comment on the bridge helpers stating the LWW-whole-string merge granularity invariant, so callers don't assume per-cell field merge.

6. **O2 (remove dead query API).**
   - Confirm no external binding/codegen consumes `get_active_scenario` / `get_active_scenario_id` (grep the bridge generator + NAPI surface; the api-spec lists workbook scenario methods — verify they route through `get_active_scenario_state`, not these). If unused, delete both functions and their `pub use` in `scenarios/mod.rs`. If something does consume them, instead reimplement them in terms of the session `active_state` so they stop lying. Update `tests::test_get_active_scenario` / `test_get_active_scenario_ignores_legacy_active_id` accordingly (they currently assert the always-`None` behavior).

7. **O6 (reload-recovery for applied scenarios) — design-gated.**
   - Add a short design note (in this plan's follow-up or a sibling) choosing the recovery mechanism. Leading option: persist the active baseline (originals snapshot keyed by baseline id + active scenario id) in a session/document-scoped store that the engine rehydrates on reload, so `prepare_restore` can still find the baseline. Constraint: must not reintroduce a CRDT-persisted "active scenario" that the engine intentionally removed; persist the *restore baseline*, gate it behind the same session ownership model.
   - Until that design lands, the minimum production fix is to ensure apply is **undoable through the normal undo stack** (verify whether `mutation_set_cells_raw` with the apply edits already participates in undo history) so a reload-without-restore is at least recoverable by the user. Document the finding.

8. **Duplicate-delegation cleanup note (adjacent, not in-folder):**
   There are two `scenarios_bindings.rs` files under `storage/engine/delegations/` and `storage/engine/services/delegations/`. The former carries `#![allow(unused_imports, unused_variables)]` and a divergent (`YrsComputeEngine`-based, `(Vec<u8>, MutationResult)`-returning) signature set; the latter is the leaner `EngineStores`-based version. This is outside `what_if` and **out of scope for edits here**, but O1/O2 touch `active_state`'s callers — note both copies when wiring signatures, and flag the duplication to the owners of folder #s covering `storage/engine/delegations` so the dead copy is reconciled rather than dual-maintained.

## Tests and verification gates

> Per task constraints this worker writes no code and runs no build/test commands. The gates below define what the implementing change must satisfy.

- **O1:** New unit/integration test: apply a scenario, assert `active_state.cell_mutation_status == "clean"`; mutate one applied changing cell through the engine; assert it flips to `"dirty"`; restore; assert active cleared. (Requires engine-level harness since `active_state` now reads the mirror — add under the engine/mutation tests, not the storage-only `tests.rs`.)
- **O3:** Unit tests in `validation.rs` tests: a 255-char multibyte name (e.g. CJK) passes; a 256-char multibyte name fails; same for comment. Existing ASCII boundary tests (`test_validate_scenario_name_max_length`, `_too_long`) must still pass.
- **O4:** Test that `update` resolves by id under simulated concurrent insert (insert a second scenario between read and write, or directly exercise id-in-txn resolution); assert the correct scenario is updated and array order preserved (`test_update_preserves_order` must still pass). Add a regression asserting a stale index can't clobber the wrong scenario.
- **O5:** Test that a deliberately corrupt bridge string for `values` decodes to empty *and* triggers the diagnostic path (assert via a captured log/telemetry sink) rather than silently returning a "valid empty" scenario.
- **O2:** After deletion, the crate compiles with no references to the removed functions; the two `get_active_scenario*` tests are updated/removed. Codegen/bridge surface diff shows no change (confirming they were unused).
- **O6:** Test (engine-level): apply scenario → recreate engine/session from the same persisted doc → assert restore is still possible (post-fix) or that the limitation is explicitly surfaced (interim). Document expected behavior in the test name.
- **Apply/restore coverage backfill (cross-cutting):** `scenarios/tests.rs` currently has **zero** apply/restore/baseline/`active_state` coverage (all ~50 tests are validation + CRUD). Add engine-harness tests covering: apply happy path, apply with array-formula/data-table guard rejection, apply with unresolvable cell → `skipped_cells`, scenario-switch baseline accumulation, restore happy path, restore of missing baseline → error. This is the highest-leverage gap.
- **Full gates (run by implementer):** `cargo build` + `cargo test` for `mog/compute/core` (and the snapshot-types crate if `active_state` signature changes ripple), `cargo clippy` clean, and a bridge-codegen run to confirm O2 produces no wire-surface diff. Existing `tests.rs` suite must remain green.

## Risks, edge cases, and non-goals

- **Risk (O1 signature ripple):** giving `active_state` access to the mirror changes its signature and that of `get_active_scenario_state` in *both* delegation copies and the `mutation.rs` accessor. Keep the change mechanical; verify both delegation files compile (one has `#![allow(unused_*)]` masking issues).
- **Risk (O4 in-place field update):** mutating a Y.Map's bridge string in place must still scrub stale keys if an update *clears* a field; ensure removed/empty arrays serialize to an empty bridge rather than leaving the prior string.
- **Risk (O6 scope creep):** durable baseline recovery is the largest item and intentionally design-gated — do not bolt a CRDT-persisted active flag back on (the engine deliberately removed it). If the design step shows undo already recovers applied cells, O6 may reduce to documentation + a surfaced warning.
- **Edge case:** `find_by_name` and the duplicate-name validator lowercase+trim; with O3's char-count change, ensure name-length validation runs on the same string form the duplicate check uses (avoid trim/length-unit mismatch).
- **Edge case (O1 dirty detection):** a changing cell whose scenario value is `Null` vs an empty/blank live cell — define equality so applying-then-not-touching reads "clean," not a false "dirty."
- **Non-goals:** Goal Seek, Solver, and Data Table behavior (separate folders). Migrating the JSON-bridge array storage to native Yrs arrays (a storage-format migration; out of scope — O5 keeps the bridge). Adding new public scenario operations or changing limit values. Any edit to the duplicate `delegations/scenarios_bindings.rs` beyond what O1/O2 wiring strictly requires.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** O7 (comments), O3 (char-count), O5 (bridge diagnostics) are folder-local and touch no callers — safe to land in parallel.
- **Coupled to engine delegation folders:** O1 and O2 change `active_state` / remove query helpers and therefore touch `storage/engine/.../delegations/scenarios_bindings.rs` and `mutation.rs`. Coordinate with the worker(s) covering `storage/engine` (the delegation/dispatch folders) — especially the duplicate-`scenarios_bindings.rs` reconciliation, which should be owned there, not here.
- **Snapshot-types dependency:** `ScenarioActiveState` lives in `crates/types/snapshot-types/src/scenario.rs`. O1 only *populates* an existing field, so no type change is needed; if the implementer chooses to make `cell_mutation_status`/`definition_status` an enum instead of `Option<String>`, that becomes a snapshot-types change requiring `pnpm --filter @mog-sdk/contracts build`-style declaration rollups and is a separate, coordinated change (treat as a stretch, not in this plan's core).
- **O6 design** depends on understanding the engine session/undo model (`mutation_dispatch`, `mutation_set_cells_raw`, session lifecycle) — pair with the engine-folder worker before implementing.

---

### Evidence appendix (read-only findings, 2026-06-03)

- `query.rs`: `get_active_scenario_id` → `{ let _ = storage; None }`; `get_active_scenario` depends on it ⇒ both always `None`. No Rust callers of either in the compute crate.
- `apply_restore.rs::active_state`: recomputes only `definition_status`; `cell_mutation_status` left at whatever apply set.
- `mutation_dispatch.rs::ApplyScenario`: sets `cell_mutation_status: Some("clean")` once at apply time, never refreshed.
- `validation.rs`: `name.len()` / `comment.len()` (byte length) vs documented 255-char limits.
- `crud.rs::update`: `items_arr.remove(index)` + `items_arr.insert(index, …)` with `index` from a prior read txn.
- `storage.rs`: `changingCells`/`values` via `json_any` bridge; reads use `read_json(...).unwrap_or_default()` (silent empty on corrupt).
- `types.rs`: "Excel limit" in two doc comments.
- `tests.rs`: ~50 tests, **no** apply/restore/baseline/`active_state` coverage (`rg -c apply|restore|baseline|active_state|prepare_` → 0).
- Two divergent `scenarios_bindings.rs` delegation copies (`EngineStores`-based vs `YrsComputeEngine`-based with `#![allow(unused_*)]`).
