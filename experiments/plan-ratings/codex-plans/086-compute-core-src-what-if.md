# 086 - Compute Core What-If Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/what_if`

Scope for this plan is the production What-If Scenario Manager path in `compute-core`: scenario definition storage, CRUD validation, query APIs, session-scoped active scenario state, apply/restore baseline planning, storage-engine mutation integration, and bridge-visible scenario results.

This folder intentionally does not own all what-if analysis behavior anymore. `what_if/mod.rs` states that Goal Seek moved to `crate::solver` and Data Tables moved to `crate::data_table`; this plan should not pull those concerns back into `what_if`.

Adjacent production dependencies that must be considered:

- `compute/core/crates/types/snapshot-types/src/scenario.rs`, which defines `Scenario`, create/update/remove results, active state, apply results, restore results, and validation errors.
- `compute/core/src/storage/engine/delegations.rs`, `storage/engine/delegations/scenarios_bindings.rs`, and `storage/engine/mutation_dispatch.rs`, which expose scenario APIs and route `ApplyScenario`/`RestoreScenario` through production mutations and recalculation.
- `compute/core/src/mirror/*`, especially `CellMirror` target lookup, formula lookup, array-formula coverage, data-table regions, and cell identity resolution.
- `compute/core/src/storage/engine/services/mutation_handlers/*`, because apply/restore ultimately writes cell values/formulas through the same production mutation path as user edits.
- `compute/api/src/workbook/scenarios.rs`, `kernel/src/api/workbook/scenarios.ts`, `kernel/src/api/workbook/operations/scenario-operations.ts`, generated compute bridge types, and the spreadsheet `ScenarioManagerDialog`, which form the public API and UI path.
- `contracts/src/store/scenarios-schema.ts` and `types/api/src/store/scenarios-schema.ts`, whose documented Yjs shape currently does not match the Rust storage shape.

This is a public Mog source folder. Implementation belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`what_if` currently retains only Scenario Manager behavior.

The `scenarios` module has these responsibilities:

- `types.rs`: Excel-compatible limits, session-owned active scenario state, baseline structs, and apply/restore plans.
- `validation.rs`: name, comment, changing-cell count, duplicate changing-cell, value-count, and duplicate-name validation.
- `storage.rs`: Yrs helpers. Scenario definitions are stored under `workbook.scenarios.items` as a `Y.Array` of structured `Y.Map`s. The `changingCells` and `values` fields are JSON-encoded inside the map because nested Yrs `Any` values are not used directly.
- `crud.rs`: create, update, remove, and legacy active-state rejection. Create/update scrub any persisted `activeScenarioId`; `set_active_scenario_id` rejects direct active writes because active scenario state is session-scoped.
- `query.rs`: list, find, count, and legacy active reads. `get_active_scenario_id` always returns `None`.
- `apply_restore.rs`: read-only planning for applying a scenario and restoring a session baseline. It captures original value/formula pairs, rejects targets inside array formula regions or data table regions, emits edits, and leaves the actual write/recalc to `EngineMutation::ApplyScenario` or `EngineMutation::RestoreScenario`.

Production apply/restore is already on the right broad path: `YrsComputeEngine.apply_scenario()` and `.restore_scenario()` call `apply_mutation`, write cells through `mutation_set_cells_raw`, prepare recalculation, flush viewport patches, and return structured scenario result data.

Important current observations:

- Rust storage uses `workbook.scenarios.items`, while TypeScript store schemas still document `workbook.scenarios` as a direct `Y.Array<Scenario>`.
- `Scenario.changing_cells` is `Vec<String>`. CRUD validation checks count and duplicates but does not prove the strings are valid `CellId`s; invalid IDs are discovered only at apply time.
- Module tests exercise validation and Yrs CRUD heavily, but most use placeholder strings such as `cell-1`, so they do not prove the real Cell Identity Model path.
- Active scenario state is Rust session-owned, but `cell_mutation_status` is currently installed as `"clean"` and not recomputed from live cells. `definition_status` distinguishes current/deleted, but not stale definition revisions.
- The UI still keeps a local `originalValuesBeforeScenario` map and `activelyShownScenarioId`; restore now ignores legacy original arrays and relies on Rust baseline state. The UI state is therefore not the source of truth, but it still behaves as if it partly is.
- Scenario CRUD and apply/restore do not appear to enforce sheet/workbook protection or scenario-edit permissions even though sheet protection has an `edit_scenarios` option.
- Updating or deleting an active scenario does not have a fully specified contract for active baselines, stale scenario definitions, or restore behavior.

## Improvement objectives

1. Make Scenario Manager's production contract explicit: persisted scenario definitions are workbook-scoped CRDT data; active/apply/restore baselines are session-scoped and never persisted.
2. Replace raw string changing-cell storage with a typed scenario reference model that validates stable `CellId`s at create/update boundaries.
3. Reconcile Rust storage, TypeScript store schemas, public API docs, generated bridge types, and UI assumptions around one canonical scenario storage shape and one public/private reference boundary.
4. Strengthen Yrs storage from an array-position CRUD helper into a scenario store with stable IDs, deterministic order, revision tracking, corruption handling, and collaboration-safe update/remove semantics.
5. Make apply/restore state authoritative and inspectable from Rust: active state should report current/stale/deleted definitions and clean/conflicted cell state from live workbook data.
6. Define and enforce active-scenario behavior for apply-next-scenario, update-active-scenario, delete-active-scenario, user edits after apply, missing cells, sheet deletion, and restore after scenario definition deletion.
7. Route scenario target validation through production workbook state: valid CellIds, resolved sheet/position, array formula exclusions, data table exclusions, protected cells/sheets, and any future locked-region policies.
8. Remove remaining TS-owned active/restore authority so the UI and kernel use Rust baseline IDs and `getActiveScenarioState()` as the single source of truth.
9. Expand verification from CRUD unit tests to production-path compute engine, bridge, kernel, UI, and collaboration tests.

## Production-path contracts and invariants to preserve or strengthen

- Goal Seek remains in `solver`; Data Tables remain in `data_table`. `what_if` should not become a second owner for those features.
- Public workbook scenario APIs may accept user-facing A1/sheet-qualified references, but compute storage must persist stable cell identities, not positional A1 strings.
- Scenario definitions are persisted. Active scenario state, baselines, original values, and applied-value tracking are session-scoped and must not be serialized into the workbook Yrs document.
- Applying a scenario must be one production mutation from the caller's perspective: plan baseline, write scenario values, recalculate dependents, install active state, return mutation data and viewport patches. If the mutation fails, no active baseline is installed.
- Restoring a scenario must use the Rust baseline ID. Legacy original-value arrays must not become a second restore authority.
- Applying scenario B while scenario A is active should reuse the original baseline for cells already tracked and extend it for newly involved cells, so switching among scenarios still restores to the pre-scenario workbook state.
- Restore must have a deterministic conflict policy. The preferred contract is fail-closed if an active target cell no longer matches the applied scenario value/formula, unless a future explicit force-restore API is added.
- A deleted scenario definition must not delete a live session baseline. Restore should still be possible from the baseline, while active state reports `definitionStatus: "deleted"`.
- Updating an active scenario should make active state `definitionStatus: "stale"` unless the active baseline can be proven equivalent to the updated definition.
- Scenario target writes must not bypass array formula, data table, protection, lock, or security policies.
- Restoring formulas must update formula text, dependency graph state, formula metadata, and recalculation through the same production mutation machinery as normal user formula edits.
- Scenario results must report skipped cells and validation errors consistently. A "success" apply should require at least one resolved write unless the contract explicitly defines a no-op success.
- Scenario list order must be deterministic and collaboration-safe across concurrent create/update/remove operations.
- Public dependency direction stays intact: `mog` must not depend on `mog-internal`.

## Concrete implementation plan

1. Write the scenario contract and type boundary.

   - Add a core scenario contract module or documentation block that defines persisted definitions versus session baselines, public A1 references versus compute `CellId`s, and active-state lifecycle.
   - Introduce typed Rust internals for changing cells, preferably `CellId` or a narrow `ScenarioCellRef`, with serde/bridge conversion at the wire boundary.
   - Split TypeScript types into public `ScenarioConfig` with user-facing references and compute/store wire types with `CellId` references. Update comments in `contracts` and `types/api` so they no longer contradict each other.
   - Replace tests that use arbitrary `cell-1` strings with valid generated `CellId`s except in explicit malformed-input tests.

2. Canonicalize scenario Yrs storage.

   - Replace ad hoc helpers with a `ScenarioStore` abstraction that owns all reads/writes for the scenarios Yrs subtree.
   - Choose and document one storage shape. A robust target shape is `workbook.scenarios: Y.Map` containing an ordered scenario-id array plus a `byId` map of structured scenario maps. This avoids array-position updates as the identity mechanism while preserving insertion order.
   - Add a scenario revision or modified generation field that changes on definition edits and can be recorded in active session state.
   - Add deterministic handling for duplicate IDs, duplicate order entries, missing `byId` entries, malformed maps, and corrupt JSON fields.
   - If current `items` documents need to be read, implement a production schema canonicalizer that rewrites to the new shape at the storage boundary. Treat this as schema normalization, not a compatibility shim that preserves two active formats indefinitely.
   - Update `contracts/src/store/scenarios-schema.ts` and `types/api/src/store/scenarios-schema.ts` to match the chosen Rust shape.

3. Strengthen CRUD validation and mutation semantics.

   - Split validation into definition validation and workbook-target validation. Definition validation owns name/comment limits, duplicate names, count limits, duplicate CellIds, value-count matching, and finite/serializable value checks.
   - Make create/update reject invalid `CellId` strings before persistence.
   - Route engine-level create/update through a validation path that can optionally resolve target cells against `CellMirror` when the API should require existing cells.
   - Define whether scenarios may reference deleted/missing cells. If they may, store them as tombstoned CellIds with explicit skipped-cell behavior; if they may not, reject at create/update.
   - Count Excel name/comment limits by the intended character contract, not accidentally by UTF-8 byte length, if public APIs permit non-ASCII names.
   - Enforce workbook/sheet protection and `editScenarios` permissions for create/update/remove, and enforce cell edit protection for apply/restore targets.
   - Replace remove-and-insert array updates with ID-keyed updates so a scenario's identity and order survive concurrent operations.

4. Make apply planning complete and auditable.

   - Extend `ScenarioBaseline` to include scenario definition revision, applied target values/formulas, target sheet IDs, target positions at apply time, and a created-at sequence.
   - Keep the existing good pattern where `prepare_apply` is read-only and the engine installs the baseline only after the mutation succeeds.
   - On apply with an existing active baseline, preserve first-original values for already tracked cells and add originals for new cells. Record which scenario definition was applied last.
   - Define partial-apply behavior: report skipped cells for deleted/unresolved targets, fail if all targets are skipped, and fail on policy violations such as protected targets, array formula targets, or data table targets.
   - Audit `mutation_set_cells_raw(..., skip_cycle_check: true)` use. Applying constant values may not need formula cycle checks, but restoring formulas should either run production cycle validation or prove that restoring the captured identity formula is safe under changed workbook structure.
   - Ensure apply clears formulas on target cells only as an explicit scenario-value contract, and that restore can round-trip original formulas, values, formula text, and dependencies.

5. Make restore and active state authoritative.

   - Compute `ScenarioActiveState` from live session state and current workbook data every time it is read.
   - Add `definitionStatus: "stale"` when the scenario exists but its revision/name/cells/values no longer match the applied baseline.
   - Compute `cellMutationStatus: "conflicted"` when any active target cell no longer equals the value/formula applied by the active scenario.
   - Make restore fail-closed on conflicts by default and return structured validation errors listing the conflicted or missing CellIds. If product behavior later needs force restore, add a separate explicit operation.
   - Allow restore after the backing scenario has been deleted, because the baseline is session-owned and sufficient to restore original cells.
   - Remove the restored baseline after a successful restore and clear active state only if the restored baseline is the active baseline.
   - Define baseline retention for multiple active baselines. If only one active baseline should exist per engine, enforce that and prune superseded inactive baselines.

6. Align bridge, kernel, and UI behavior with the Rust contract.

   - Regenerate bridge types after Rust type or method changes.
   - Update kernel scenario operations so create/update convert public A1 references to CellIds, while list converts CellIds back to A1/sheet-qualified A1 for display.
   - Change restore APIs and docs to prefer baseline IDs. Remove or deprecate legacy original-value array restore in the kernel wrapper once UI call sites are updated.
   - Make `ScenarioManagerDialog` read active state from `wb.scenarios.getActiveScenarioState()` on open, after show, after restore, and after delete/update. Do not use local `activelyShownScenarioId` as authority.
   - Keep original values returned from apply only for display/debug if needed; do not use them to decide whether restore is possible.
   - Surface skipped cells, stale definitions, and conflicts in API errors/UI state instead of swallowing them as generic string errors.

7. Add observability and diagnostics.

   - Add structured scenario operation diagnostics for create/update/remove/apply/restore: scenario id, target count, skipped count, validation error fields, active baseline id, stale/conflict status, and recalc result summary.
   - Keep diagnostics safe for public APIs. Do not expose internal Yrs storage details unless they are already part of a debug surface.
   - Add corruption diagnostics for scenario storage normalization so malformed documents fail deterministically instead of silently dropping definitions.

8. Remove stale scenario behavior.

   - Delete or narrow `set_active_scenario_id` once all callers use apply/restore and active-state reads. If a method remains for bridge compatibility, keep it explicitly failing and covered by tests.
   - Remove legacy persisted `activeScenarioId` scrub logic after the storage schema no longer admits that field, unless the canonicalizer still needs a one-time cleanup path.
   - Remove comments that say Rust-owned apply/restore is pending once UI/kernel code fully uses it.

## Tests and verification gates

Focused tests to add or update during implementation:

- Scenario store unit tests for canonical storage shape, order preservation, duplicate IDs, duplicate names, corrupt entries, malformed JSON fields, schema canonicalization, and concurrent-style create/update/remove ordering.
- Validation tests using real `CellId`s plus explicit malformed-ID cases.
- Production `YrsComputeEngine` tests for create/list/update/remove through bridge-exposed methods, not only direct `scenarios::create`.
- Apply/restore tests with real cells: plain values, formulas restored with dependencies, formulas whose dependents recalculate, multiple scenario switches sharing one baseline, skipped deleted cells, all-targets-skipped failure, and restore after backing scenario deletion.
- Active state tests for current, stale after update, deleted after remove, clean, conflicted after user edit, missing target after sheet/cell deletion, and cleared after restore.
- Policy tests for array formula targets, data table targets, protected sheets/cells, locked cells, and scenario-edit permissions.
- Identity tests proving row/column insertions, moves, and sheet-qualified public references do not break scenario CellId targets.
- Collaboration/storage tests proving two engines that receive Yrs updates converge on the same scenario definitions and order.
- Kernel/API tests for A1-to-CellId conversion on add/update, CellId-to-A1 conversion on list, baseline-id restore, active-state decoding, and structured validation error formatting.
- UI app tests for Scenario Manager using real keyboard/mouse input paths: add from active cell, show, switch scenarios, conflict after edit, restore, delete active scenario, and stale/deleted active state display.

Required final gates for an implementation touching only Rust compute-core scenario behavior:

- `cargo test -p compute-core what_if::scenarios`
- `cargo test -p compute-core storage::engine`
- `cargo test -p compute-core`
- `cargo clippy -p compute-core`

Additional gates when related packages change:

- `cargo test -p snapshot-types` and `cargo clippy -p snapshot-types` if scenario snapshot/wire types change.
- `cargo test -p compute-api` and `cargo clippy -p compute-api` if API wrappers change.
- `pnpm test` for the affected kernel/workbook scenario package tests when TypeScript scenario operations change.
- `pnpm typecheck` for TypeScript contract, kernel, or app changes.
- Spreadsheet app Playwright/app-eval coverage for Scenario Manager UI changes, driven through real UI input paths.

Verification must exercise production paths: bridge methods, `YrsComputeEngine.apply_mutation`, real storage/mirror state, and real UI interaction. Direct helper tests are useful for small contracts but are not sufficient.

## Risks, edge cases, and non-goals

Risks:

- Changing scenario storage shape can break persisted local documents if canonicalization is incomplete. Treat storage normalization as a first-class production path and test it.
- Moving from raw strings to typed CellIds will invalidate tests and callers that accidentally relied on arbitrary strings. That is the correct direction, but all public A1 conversion call sites must be updated together.
- Conflict detection can change restore behavior after users edit applied cells. The fail-closed contract must be explicit in API errors and UI.
- Formula restore through normal mutation paths can expose cycles or broken references that did not exist when the baseline was captured. Define and test the policy instead of silently bypassing graph validation.
- Collaboration-safe scenario order can be subtle with Yrs arrays. Prefer ID-keyed identity plus explicit order reconciliation over position-as-identity updates.
- Protection/security enforcement may require dependencies outside this folder; keep the dependency direction through existing storage-engine services rather than deep-importing UI or kernel policy.

Edge cases to cover:

- Empty scenario names, whitespace names, max-length names/comments, non-ASCII names, duplicate names with case/trim differences, and duplicate CellIds.
- Every `CellValue` variant that scenario values can store, including nulls, booleans, text, numbers, and errors if errors are allowed.
- Scenarios that reference cells moved by row/column insert/delete, cells on renamed sheets, cells on deleted sheets, and cells whose identity no longer resolves.
- Applying scenario B while scenario A is active, applying the same scenario twice, restoring after multiple scenario switches, and deleting/updating the active scenario before restore.
- Target cells that currently contain formulas, target cells inside spills or CSE array formulas, target cells inside data table regions, merged cells, locked cells, and protected sheets.
- Restore of original formulas whose precedent/dependent graph changed after apply.
- Concurrent scenario creates with the same name, concurrent update and remove, and remote updates arriving while a local session baseline is active.

Non-goals:

- Do not move Goal Seek or Data Tables back into `what_if`.
- Do not create a second scenario application path in TypeScript or a test-only scenario engine.
- Do not preserve the old activeScenarioId persistence model.
- Do not add compatibility shims that keep two scenario storage schemas live indefinitely.
- Do not optimize scenario CRUD for large unbounded collections; Excel-compatible limits keep the scenario count small. Correctness, identity, and contracts matter more here.
- Do not add dependencies from public `mog` code to `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the scenario contract is written down.

- Agent A: own Rust scenario contracts and snapshot/wire type changes in `snapshot-types`, plus bridge type regeneration needs.
- Agent B: own `ScenarioStore`, canonical Yrs storage, schema normalization, CRUD validation, and storage convergence tests.
- Agent C: own apply/restore baseline state, conflict/stale detection, mutation-path audits, and production compute-core tests.
- Agent D: own TypeScript contract/kernel/API updates, A1/CellId conversions, active-state decoding, and kernel tests.
- Agent E: own Scenario Manager UI integration and app-eval/Playwright coverage through real UI paths.
- Agent F: own protection/security policy integration if it needs changes outside `what_if`.

Dependencies:

- The public/private reference contract should land before storage or UI rewrites.
- The canonical storage shape should land before active-state revision tracking.
- Apply/restore conflict detection depends on baseline tracking of applied values and scenario revisions.
- UI changes should wait until kernel APIs expose authoritative active state and baseline-id restore.
