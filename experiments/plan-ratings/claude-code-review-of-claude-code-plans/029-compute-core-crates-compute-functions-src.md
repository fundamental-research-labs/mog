Rating: 8/10

# Review of Plan 029 — `mog/compute/core/crates/compute-functions/src`


## Summary judgment

This is a strong, unusually well-grounded plan. Every structural and cross-folder
claim I spot-checked against the live source holds up: the dual-trait model
(`PureFunction` with `is_scalar_arg` vs. the 8 `ExcelFunction` implementors carrying
`FunctionSignature`/`ArgRole`), the `RegisteredFunction::call → try_array_lift →
call_inner` dispatch, the `_xlfn._xlws.`/`_xlfn.` normalization, positional `u16`
function ids re-derived per `FunctionRegistry::new()`, the `__internal` SPI gating in
`lib.rs`, the unconditional `percentile_exc/inc` export, the `GLOBAL_REGISTRY`
`LazyLock`, the inline context dispatch in `eval_primitives.rs` (LET/LAMBDA/SUM/IF/
INDEX/VLOOKUP/OFFSET confirmed as match arms), and the `function-catalog.ts` header
that literally declares the Rust crate and `eval_primitives.rs` as its sources of
truth. The compact `[name, category, description, minArgs, maxArgs]` field model the
plan proposes reusing is exactly the `FnDef` tuple already in the TS file. I found no
fabricated structure.

The plan correctly identifies a real, high-value problem: the catalog/parity surface
is split across three hand-maintained, machine-unlinked representations, and per-arg
error-propagation/lifting for ~434 functions is encoded only as a boolean plus
ad-hoc body checks. The contract-preservation section is the best part — it pins the
exact invariants (byte-for-byte `ExcelFunction` behavior, zipped-not-cross-product
broadcast, `returns_array()` skip for dynamic arrays, arity-gate-before-dispatch)
that a refactor of this surface could silently break.

The principal reasons it is not a 9–10: the scope is really six sub-projects bundled
as one (it reads more as a program roadmap than a single executable plan), the
Phase-4 golden-corpus oracle — the single most important verification element for a
parity surface — is underspecified, and objectives 1 and 2 are coupled when the
higher-value one (catalog generation) could ship independently of the risky
434-function migration.

## Major strengths

- **Evidence-first sequencing.** Phase 0 forces a three-way drift diff
  (Rust-registry / `function-catalog.ts` / `eval_primitives.rs` arms) and a
  function-id-persistence verdict *before* any edit. Treating id-reordering as "the
  single highest-impact unknown" and gating `register_all` changes on it is exactly
  right — ids are positional and re-derived, so the whole migration's safety hinges
  on confirming nothing persists them.
- **Conservative migration design.** Defaulting the new trait method to derive
  today's behavior from `min_args`/`max_args`/`is_scalar_arg`, then migrating
  domain-by-domain smallest-first, each gated by a Phase-0 behavior-identity oracle,
  with "no net behavior change permitted in Phase 1," is the correct way to refactor
  442 live functions without a parity regression.
- **Contract literacy.** The invariants section is specific and correct (Criteria
  passthrough so `COUNTIF(range,#N/A)` counts errors; Range/Scalar short-circuit;
  ArrayNative skip; `#VALUE!` on incompatible non-1 dims; `#N/A` fill). These match
  `signature.rs` and `registered_function.rs` exactly.
- **Realistic risk register and decoupling guard.** Shipping a checked-in generated
  TS file with a drift check *before* any hard build-time codegen dependency avoids
  making a generator outage block builds — a mature call.
- **Honest non-goals.** Explicitly *not* moving context functions into the crate,
  not changing `dd-precision` or KFD-accepted results, not adding new functions
  beyond coverage gaps. This keeps the parity surface stable.

## Major gaps or risks

- **Scope is a program, not a plan.** Six objectives across five phases touching
  ~442 functions, a Rust→TS generator, a context-function reconciliation, a parity
  ledger, a golden corpus, and a fuzz harness. Each of objectives 1, 2, 4 is a
  multi-week effort on its own. The plan's own parallelization notes concede this.
  As written it is hard to call "done" and hard to review as a unit. It should be
  split into independently landable plans with their own gates.
- **Golden-corpus oracle is underspecified (most serious substantive gap).** Phase 4
  says "input args → expected `CellValue`" but never states *where the expected
  values come from*. If they are captured from current Mog output, the corpus is
  tautological — it locks in current behavior and proves nothing about reference
  parity. For a *parity* surface this is the crux. The plan needs to name the oracle
  (reference-spreadsheet captures? `statrs`/independent reference? hand-derived
  closed forms?) and how new entries are authored without just snapshotting Mog.
- **Phase 2 relocates the manual-maintenance burden rather than eliminating it.** The
  win — a machine-checked Rust↔TS link — is real and worth it. But the ~442 Rust
  metadata entries (category, description, per-arg name/hint) are still hand-authored,
  with no oracle for description/arg-name *correctness* (only for name/arity drift).
  The plan should acknowledge this and say how the initial population is validated
  (e.g., seeded from the existing 863-line TS so content isn't re-typed from scratch).
- **Objectives 1 and 2 are coupled but separable.** Catalog metadata + a `catalog()`
  API + TS generation (objective 2) delivers the largest user-facing value
  (autocomplete/dialog correctness) and does *not* strictly require unifying the
  signature model for 434 functions (objective 1). Bundling them puts the riskiest,
  largest work on the critical path to the highest-value work. The plan would be
  stronger if objective 2 could land on the existing trait surface first.
- **Phase 3 defers a public-API-shaping decision.** "ContextFunction metadata arm vs.
  shared catalog crate, chosen from Phase-0 evidence" leaves the mechanism open. That
  is defensible, but since it determines whether the registry's public surface grows a
  new arm, the plan should at least state the decision *criteria* (e.g., choose the
  arm if no new crate-level dependency is introduced).
- **End-to-end TS drift gate lives outside the folder.** Correctly scoped, but the
  gate that gives objective 2 its teeth depends on external wiring (generator script,
  CI step, the `@mog-sdk/contracts` declaration rollup the plan notes). The plan
  flags this but the cross-folder CI deliverable is only loosely specified.

## Contract and verification assessment

The contract enumeration is accurate and is the plan's spine. Verified against
source: `propagates_error` returns true only for Range|Scalar; `is_liftable_arg` keys
on `ArgRole::Scalar` (Excel) vs `is_scalar_arg` (Pure) — exactly the divergence the
plan targets; `call` checks arity before dispatch and returns `#VALUE!`/`#NAME?`
totally; normalization strips the two prefixes with a case-insensitive fast path.

Verification gates are mostly well-chosen: the Phase-1 behavior-identity snapshot,
the catalog-completeness/no-drift gate, keeping `registry/tests/{arity, array_lift,
error_propagation, helpers, lookup, metadata}.rs` green (these files exist), and the
panic-freedom fuzz over `FunctionRegistry::call` plus a lint/grep gate denying new
production `unwrap()/expect()`. The unwrap concentration the plan names
(`datetime/calendar.rs`, `week.rs`, `workdays.rs`, `helpers/`, `logical.rs`) matches
the actual file hits.

Weaknesses in the gates: (1) the golden-corpus gate is only as good as its
unspecified oracle, as above; (2) "panic-freedom" via fuzzing demonstrates absence on
sampled inputs, not a proof — the plan says "prove, by audit plus fuzzing," which is
the right framing, but the audit half (classifying every reachable unwrap) is the
load-bearing part and should be the primary gate, with fuzzing as backstop; (3) the
plan defers all execution to reviewers, which is consistent with task constraints but
means no gate is self-demonstrated here.

## Concrete changes that would raise the rating

1. **Split into independently landable plans** with their own gates: (A) signature
   unification + per-domain migration; (B) catalog metadata + `catalog()` + TS
   generation/drift-check; (C) context-function reconciliation; (D) parity ledger +
   golden corpus; (E) panic-freedom + coercion convergence. Sequence A and B so B can
   ship on the current trait surface without waiting on A.
2. **Specify the golden-corpus oracle.** Name the source of expected values, state
   explicitly that values must not be snapshots of current Mog output, and define how
   a new entry is authored and reviewed (reference capture, closed form, or
   independent library), with tolerance + KFD-link rules for approximation-based
   functions.
3. **Address Phase-2 content correctness.** State that Rust metadata is seeded from
   the existing `function-catalog.ts` (not re-typed) and add a one-time reconciliation
   step so the generation flip is provably content-preserving, not just name/arity-
   checked.
4. **Give Phase-3 a decision rule.** State the criteria for ContextFunction-arm vs.
   shared-catalog-crate (e.g., no new public dependency, additive-only public surface)
   so the deferral is bounded.
5. **Make the unwrap audit the primary panic gate**, with the fuzz harness as a
   secondary backstop, and quantify the Phase-0 classification output (count of
   input-reachable sites) so the objective has a measurable done-state.
6. **Pin the cross-folder CI deliverable** for the TS drift check (which CI job, where
   the generator lives, ordering relative to the contracts declaration rollup) so
   objective 2's gate is concrete rather than "lives outside this folder."
