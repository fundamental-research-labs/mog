Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies that `what_if` is now the Scenario Manager owner, not a catch-all for Goal Seek or Data Tables, and it grounds the work in the real production path: scenario definitions in Yrs, session-owned active baselines, `YrsComputeEngine.apply_mutation`, mirror-backed cell resolution, bridge/kernel/UI APIs, and TypeScript contract schemas. The plan is especially good at separating persisted workbook state from session state and at refusing to keep TypeScript as a second source of restore authority.

The rating is not higher because several of the hardest contracts are still stated as intentions rather than executable specifications. The plan says to canonicalize storage, introduce typed cell references, compute stale/conflict state, enforce protection, and handle collaboration-safe ordering, but it does not fully define the exact wire/storage schemas, migration/versioning behavior, CRDT merge rules, permission source of truth, or acceptance criteria for each milestone.

Major strengths

- The current-state audit matches the source well: `workbook.scenarios.items` is the Rust storage shape, `changing_cells` is still `Vec<String>`, validation mostly checks shape/count/name rather than valid `CellId`s, tests use placeholder `cell-1` values, and active state currently reports only current/deleted rather than revision staleness or live cell conflicts.
- The plan keeps the architectural boundary clean. It explicitly leaves Goal Seek in `solver`, Data Tables in `data_table`, and implementation in public `mog` rather than internal plans.
- It targets the production path instead of helper-only behavior: apply/restore planning remains read-only, writes flow through engine mutations, recalculation and viewport patches are part of the contract, and UI/app tests are expected to use real input paths.
- It identifies the most important invariant: persisted scenario definitions are collaborative workbook data, while active scenario baselines are session-scoped and must not be serialized into the Yrs document.
- The verification section is broad and mostly appropriate, covering compute-core, storage engine, snapshot/API changes, kernel conversion behavior, UI behavior, collaboration, array formulas, data tables, and protection policy.
- The parallelization notes are realistic and split by ownership boundary: Rust contracts, Yrs store, apply/restore state, kernel/API, UI, and protection/security integration.

Major gaps or risks

- The canonical storage proposal is not yet a concrete schema contract. `workbook.scenarios: Y.Map` with order plus `byId` is plausible, but the plan does not define key names, value shapes, revision field type, order reconciliation algorithm, duplicate handling precedence, or whether old `items` is removed in the same transaction after normalization.
- Migration is underspecified. The plan calls normalization a production path, but does not define idempotence, version markers, when canonicalization runs, how concurrent clients with old/new code behave, or what failures are returned when old malformed documents cannot be normalized.
- Collaboration-safe ordering is named but not specified. An ID-keyed map plus order array still needs a deterministic policy for concurrent creates, duplicate order entries, deleted IDs in order, same-name races, and concurrent update/remove. Without that, agents could each implement locally sensible but non-convergent behavior.
- The typed reference boundary needs a sharper contract. The plan says "preferably `CellId` or a narrow `ScenarioCellRef`" and says public APIs may accept A1, but it should choose the exact internal type, wire encoding, display conversion behavior, and error model for unresolved A1, renamed sheets, moved cells, deleted sheets, and workbook imports.
- Protection/security enforcement is too vague for implementation. The plan says to enforce sheet/workbook protection, `editScenarios`, locked cells, and future policies, but does not name the production service or API that owns those decisions or define the exact permission matrix for create/update/remove/apply/restore.
- Active-state conflict detection is directionally correct but incomplete. It should define equality for every relevant cell state: values, formulas, formula text normalization, errors, blank/null, rich values if present, and whether recalculated dependent values matter.
- Restore formula safety is flagged but not resolved. The plan asks to audit `skip_cycle_check`, but a stronger plan would define whether restore must run the normal formula mutation path, what happens if the restored formula is now cyclic or invalid, and how partial restore is reported.
- The work is very large and cross-cutting. The sequence says contract first, then storage, then active state, then UI, but it needs explicit phase gates so parallel agents cannot land incompatible schema/type/API assumptions.

Contract and verification assessment

The contract quality is high at the invariant level and medium at the executable level. The plan clearly states the desired lifecycle for persisted definitions, session baselines, apply, restore, stale/deleted definitions, conflict handling, scenario switching, and TS/UI deauthority. That is enough to orient implementation correctly.

However, several contracts need to be made machine-checkable before implementation starts: the exact Yrs schema, revision semantics, public versus storage reference types, baseline ID lifecycle, conflict equality, skipped-cell versus hard-error policy, no-op apply behavior, restore after sheet deletion, permission checks, and bridge result payloads. The plan currently mixes fixed decisions with open questions, which creates risk when multiple agents implement different interpretations.

The verification gates are strong and production-relevant. They include Rust crate tests and clippy, TypeScript package tests/typecheck when changed, and UI app coverage through real input paths. The biggest missing gates are schema migration/canonicalization tests against old `items` documents, generated bridge/type snapshot checks after wire changes, cross-client Yrs convergence tests that specifically exercise concurrent old/new storage operations, and explicit tests that UI restore cannot use legacy original-value arrays as authority.

Concrete changes that would raise the rating

- Add a small "final contract" section with exact Rust, bridge, TypeScript public, and Yrs storage shapes, including field names, revision type, and example serialized documents before and after canonicalization.
- Define a deterministic CRDT reconciliation algorithm for `order` plus `byId`: tie-breakers, duplicate IDs, missing IDs, concurrent create/update/remove, duplicate names, and malformed entries.
- Specify the migration lifecycle: trigger point, transaction boundaries, idempotence, version marker, failure behavior, telemetry, and compatibility expectations for documents created by current code.
- Choose `CellId` versus `ScenarioCellRef` explicitly and define all conversions between public A1/sheet-qualified A1 and stable cell identity, including moved cells, renamed sheets, deleted sheets, imports, and unresolved references.
- Add a permission matrix for create, update, remove, apply, and restore, naming the production policy service or storage-engine path that must be used.
- Define active-state and restore conflict equality for values and formulas in enough detail that tests can be written before implementation.
- Break the implementation into phase-level acceptance gates with owner-facing deliverables: contract/type fixtures, storage normalization tests, engine apply/restore tests, bridge/kernel tests, and UI app-eval scenarios.
- Add explicit bridge generation and schema snapshot verification gates for any scenario wire type changes.
