Rating: 8/10

# Review of 086 — Compute Core `what_if` Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about the
current code is verifiable in the source, and the proposed direction is architecturally
sound: it respects the existing module split (Goal Seek → `solver`, Data Tables →
`data_table`), preserves the session-scoped-vs-persisted boundary that the code already
attempts, keeps the public dependency direction (`mog` not depending on `mog-internal`),
and routes everything through the real production mutation path rather than inventing a
parallel scenario engine. The contract/invariant section is unusually explicit and would
make a good acceptance reference.

The main weaknesses are scope and a handful of deliberately-deferred contract decisions.
This reads more like a multi-agent epic (it literally proposes Agents A–F) than a single
landable unit of work, and several key behavioral questions (may scenarios reference
deleted cells? must create/update resolve targets against `CellMirror`?) are left as
"decide during implementation" rather than pinned. Those are the gap between an 8 and a
9–10.

## Verification of the plan's factual basis

I confirmed the plan's "current observations" against the source:

- `Scenario.changing_cells` is `Vec<String>` (snapshot-types `scenario.rs:29`), validated
  for count/duplicates/value-count but **not** for `CellId` validity at create/update;
  `CellId::from_uuid_str` is first called at apply time (`apply_restore.rs:173`). Accurate.
- Storage uses `workbook.scenarios.items` as a `Y.Array<Y.Map>` with `changingCells`/`values`
  JSON-bridged inside each map (`storage.rs`, `mod.rs` doc comment). Accurate.
- TS contract `contracts/src/store/scenarios-schema.ts` declares `workbook.scenarios` as a
  direct `Y.Array<Scenario>` ("Stored as Y.Array<Scenario>"), which does **not** match the
  Rust `.items` shape. Mismatch confirmed.
- `set_active_scenario_id` is a hard-failing stub (`crud.rs:219`); `get_active_scenario_id`
  returns `None` (`query.rs:29`). Accurate.
- `active_state` recomputes only `definition_status` current/deleted and does not recompute
  `cell_mutation_status` from live cells (`apply_restore.rs:97`). Accurate.
- Name length validation uses `name.len()` (byte length), so the plan's note about
  character-vs-UTF-8-byte counting for non-ASCII names is a real catch (`validation.rs:23`).
- `update` does `items_arr.remove(index)` then `insert(index)` — position-as-identity, the
  collaboration hazard the plan flags (`crud.rs:168-172`). Accurate.
- Array-formula and data-table target exclusions exist (`validate_scenario_target`,
  `apply_restore.rs:75`), but no protection / `edit_scenarios` enforcement is present even
  though `edit_scenarios` exists on sheet protection (`domain-types/src/domain/sheet.rs`).
  Accurate.

This level of fidelity is the plan's biggest strength: it is not hallucinating the codebase.

## Major strengths

- **Accurate problem statement.** The diagnosis is real, specific, and tied to named files
  and functions, not vague aspirations.
- **Clear contract/invariant section.** The "preserve or strengthen" list (session-scoped
  baselines never serialized; apply is one mutation with no baseline install on failure;
  restore uses the Rust baseline ID; fail-closed conflict policy; baseline survives scenario
  deletion) is the kind of thing implementers and reviewers can hold the work against.
- **Production-path discipline.** It explicitly states direct-helper tests are insufficient
  and demands bridge/`apply_mutation`/mirror/UI coverage. It also correctly insists scenario
  writes go through the same mutation machinery as user edits, which is already how the code
  works — so the plan strengthens rather than fights the architecture.
- **Good risk register and edge-case list.** Storage normalization, formula-restore cycle
  exposure, Yrs order convergence, and identity-under-insert/delete are the right hazards.
- **Sensible sequencing.** The dependency ordering (reference contract → storage shape →
  active-state revision tracking; UI waits on authoritative kernel APIs) is correct.

## Major gaps or risks

- **Scope is an epic, not a plan.** Eight objectives spanning Rust core, snapshot-types,
  bridge regen, kernel, TS contracts, and UI app-eval, with six parallel agents. There is no
  minimal/MVP slice identified. A reviewer cannot tell what "done" means for a single PR, and
  the risk of a long-lived half-migrated state (two storage shapes, mixed reference types) is
  high precisely because the plan is so broad.
- **Deferred contract decisions.** Whether scenarios may reference deleted/missing cells, and
  whether create/update must resolve targets against `CellMirror`, are left open ("define
  whether…", "optionally resolve…"). These are central to the typed-reference objective; the
  plan should pick a default rather than enumerate options.
- **Storage canonicalizer is under-specified for a high-risk change.** The plan correctly
  forbids indefinite dual-schema shims and demands a normalizer that rewrites `.items` to the
  new `Y.Map { order[], byId{} }` shape, but says little about how old documents are detected,
  what happens to in-flight collaboration during rewrite, or how convergence is guaranteed when
  two peers normalize concurrently. For a CRDT this is the single most dangerous step and
  deserves its own mini-spec.
- **`changingCells` type story is muddier than stated.** TS contract already uses `CellId[]`
  while Rust uses `Vec<String>`; the plan frames this as a clean public-A1-vs-compute-CellId
  split, but the existing kernel/store already assumes CellId end-to-end. The plan should
  reconcile against what the kernel actually sends today, or it risks introducing an A1
  conversion layer where none currently exists.
- **No explicit acceptance criteria beyond the test list.** The invariants are good, but there
  is no "definition of done" mapping invariants → gating tests, so it's hard to know which
  tests are load-bearing versus nice-to-have.

## Contract and verification assessment

Verification is a strong point. The plan names concrete final gates
(`cargo test -p compute-core what_if::scenarios`, `storage::engine`, full crate, clippy) plus
conditional gates for `snapshot-types`, `compute-api`, kernel `pnpm test`, `pnpm typecheck`,
and app-eval, and it insists on real-cell and collaboration/convergence tests rather than the
existing placeholder `cell-1` strings. That directly targets the weakest part of the current
suite (tests.rs leans on synthetic strings). The contract section is the best part of the
document.

Two verification weaknesses: (1) the test list is large and unprioritized — it would benefit
from marking which tests gate each invariant; (2) there is no explicit gate for the
storage-normalization/migration path beyond "test it," despite it being the highest-risk
change. A round-trip/convergence test for old-`items` → new-shape should be called out as a
required gate, not folded into a bullet.

## Concrete changes that would raise the rating

1. **Carve out a Phase 0 / MVP slice** that lands independently and is reviewable on its own
   — most plausibly: typed `CellId` validation at create/update + the TS/Rust storage-shape
   reconciliation + the canonicalizer, with its own gates. Defer protection enforcement,
   stale-revision tracking, and conflict-restore to follow-up plans.
2. **Pick defaults for the open contract questions** rather than listing options: state whether
   scenarios may reference missing cells (recommend tombstone-and-skip) and whether create/update
   must resolve against `CellMirror` (recommend validate CellId syntax always, resolve existence
   only when the public API requires it).
3. **Add a dedicated storage-normalization sub-spec**: detection of legacy `.items`, idempotent
   rewrite, concurrent-normalization convergence proof, and a required round-trip test gate.
4. **Reconcile the `changingCells` type claim with today's kernel/store**, which already uses
   `CellId`, so the plan doesn't accidentally introduce an unnecessary A1 conversion seam.
5. **Map invariants to gating tests** ("definition of done"), so reviewers can check each
   contract clause against a specific named test.
6. **Make the protection/`edit_scenarios` integration concrete** — name the storage-engine
   service entry point that apply/restore should call, since the plan correctly warns against
   deep-importing UI/kernel policy.
