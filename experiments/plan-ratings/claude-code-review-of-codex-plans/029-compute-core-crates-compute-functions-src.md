Rating: 8/10

# Review of Plan 029 — `compute/core/crates/compute-functions/src`

## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every factual claim it
makes about the source tree was verifiable against the actual code, and the
plan demonstrates real understanding of the crate's architecture rather than
generic refactoring boilerplate. It correctly identifies the central problem —
function metadata is scattered implicitly across hundreds of trait impls and
duplicated across crate boundaries that cannot share a dependency — and proposes
a coherent descriptor-first contract to consolidate it. The contracts and
invariants section is the best part: it reads like it was written by someone who
has paid for the existing semantics in production.

The main thing holding it back from a 9–10 is scope. This is not a plan so much
as a multi-month program of seven sub-projects, each of which is itself sizable
and risky. The plan acknowledges this with its parallelization breakdown, but it
provides little in the way of incremental landing strategy, per-phase acceptance
criteria, or a minimal first slice that delivers value while de-risking the rest.
A reviewer cannot tell from this document what "phase 1 is done and safe to
merge" looks like concretely.

## Verification of claims against source

I spot-checked the plan's factual assertions; they hold up:

- "512+ Excel-compatible function library" — confirmed verbatim in `lib.rs:1`.
- "~41 evaluator primitives / ~435 registry-dispatched" — confirmed in
  `eval/engine/eval_primitives.rs:3,16`.
- "301 Rust files, ~58,909 lines" — confirmed (`find`/`wc` give exactly these).
- Only conditional aggregation uses `ExcelFunction`/`register_excel` — confirmed;
  `register_excel` is only exercised from `statistical/counting.rs`.
- `signature.rs` `FunctionSignature`/`ArgRole` with `Range`/`Criteria`/`Scalar`/
  `ArrayNative` and `propagates_error` framework logic — confirmed.
- Volatile-name duplication in `compute-parser/.../flags.rs` with an explicit
  `// Canonical source: compute_functions::helpers::VOLATILE_FUNCTIONS` comment —
  confirmed, validating the "intentional duplication for dependency reasons"
  framing.
- Mirror `root_ast_produces_dynamic_array` exists in `eval_bridge/mirror_context.rs`
  — confirmed.
- `__internal`-gated helper SPI and the helper file split
  (`bitmask_cache`, `column_index`, `frequency_cache`, `sorted_cache`,
  `sumifs_result_cache` vs `coercion`/`criteria`/`date_serial`/`power`) — confirmed.
- "Tests assert FORMULATEXT and FORECAST.ETS* are not advertised" — confirmed in
  `registry/tests/lookup.rs:69` (`test_unsupported_stubs_are_not_registered`).

This level of accuracy is the plan's strongest credential: its recommendations
are anchored in code that demonstrably exists, not assumed.

## Major strengths

- **Correct problem diagnosis.** The "metadata is implicit and duplicated across
  crates that can't depend on each other" framing is exactly right, and the plan
  understands *why* the duplication exists (the `compute-parser` cannot depend on
  `compute-functions`) rather than treating it as accidental sloppiness.
- **Dependency-direction discipline.** It repeatedly insists a shared catalog
  crate must be lower-level and value-free, and explicitly forbids
  `compute-parser → compute-functions`. This is the failure mode most refactors
  of this kind hit, and the plan pre-empts it.
- **Respects the evaluator/registry split.** It refuses to register evaluator
  primitives as misleading pure stubs just to make a parity table complete, and
  keeps AST/reference/laziness functions in the evaluator. This matches the real
  architecture and the existing `test_unsupported_stubs_are_not_registered`
  contract.
- **Distinguishes subtle array concepts.** Separating `AlwaysArray` / `MaybeArray`
  / `Scalar` and noting `XLOOKUP` is spill-capable while sometimes scalar shows
  genuine domain understanding; "spill-capable" ≠ `returns_array()` is a sharp
  observation.
- **Strong invariants section.** Arity → `#VALUE!`, unknown → `#NAME!`,
  process-local registry IDs must not become a wire/storage contract, omitted-arg
  defaults reconciled across three call paths — these are precise, testable, and
  production-relevant.

## Major gaps or risks

- **Program-sized scope, plan-sized framing.** Seven parallel agents each owning
  a large workstream is realistically a quarter+ of effort. There is no minimal
  vertical slice ("migrate conditional aggregates end-to-end through the new
  descriptor and ship it") identified as the de-risking first deliverable, even
  though the plan notes that family is the natural starting point.
- **"No behavioral change" is asserted, not engineered.** Step 3 says descriptor
  binding "can land independently... if tests assert no behavioral change," and
  step 4 introduces a dispatcher-level error-propagation pass. Moving error
  propagation into the framework is precisely where behavior *can* silently drift
  (the plan even lists this as a risk). The plan needs a concrete differential-
  testing strategy (e.g., snapshot every registered function's output over a
  fixed argument corpus before/after) rather than relying on existing category
  tests to catch regressions.
- **Parity table provenance is hand-wavy.** "generated or curated from official
  Excel/Microsoft 365 categories" leaves the single most laborious and
  drift-prone artifact underspecified. Who owns it, how it is regenerated, and
  how a new Excel function entering the wild is detected are all open.
- **No effort/sequencing estimates or kill criteria.** Dependencies are listed,
  but there is no statement of which phases are reversible, which are one-way
  doors (e.g., introducing a new crate), or what to do if the descriptor schema
  proves insufficient mid-migration.
- **Helper SPI cache equivalence is the highest-risk technical area and gets the
  least concrete treatment.** "Document epoch ownership, invalidation, thread-
  local behavior, equivalence" is the right checklist, but stale-cache bugs
  across full/incremental recalc, cycles, data-table prepasses, and rayon workers
  are exactly the kind of defect that escapes unit tests. The plan should commit
  to a property/fuzz or randomized-recalc equivalence harness here, not just
  doc + per-function comparison tests.

## Contract and verification assessment

The contract surface is the plan's best dimension. Roles, error policy, array
policy, return kind, volatility, prefix support, and implementation owner are all
named as first-class descriptor fields, and the invariants section ties them to
observable behavior (`#VALUE!`/`#NAME!`, prefix normalization, ID stability).

Verification gates are appropriate and correctly scoped: `cargo test/clippy -p
compute-functions` as the baseline, `-p compute-core` gated on changes that touch
evaluator fallback / scheduler / dynamic arrays / volatility / helper SPI, and
opt-in `corpus-tests` / `audit-tests` / `perf-tests` features. The drift tests
(parser flags vs scheduler inline lists vs mirror detection vs registry metadata)
are the right mechanism and target the real duplication I confirmed in source.

Two gaps: (1) the gates are stated as commands but not tied to per-phase exit
criteria — there is no "phase 3 is complete when X tests are green and the
function-output snapshot diff is empty." (2) No mention of how the WASM/N-API
surface is regression-tested if registry/descriptor APIs change shape; it is
listed only as an optional smoke test.

## Concrete changes that would raise the rating

1. **Define a minimal first slice with explicit exit criteria.** "Land the
   `FunctionDescriptor` type + descriptor-aware registration for the conditional
   aggregation family, with a behavioral-snapshot test proving zero output change,
   and merge it before any broad migration." This converts a program into a plan.
2. **Commit to a differential/behavioral-snapshot harness** before the
   dispatcher-level error-propagation pass, so "no behavioral change" is enforced
   mechanically rather than asserted.
3. **Specify the parity-table source of truth and refresh process** — file format,
   owner, how it is regenerated, and the test that flags Excel functions present
   in the registry but absent from the table (and vice versa).
4. **Upgrade the helper-cache equivalence plan** to a randomized recalc/property
   harness covering full + incremental + cyclic + data-table + rayon paths, not
   just per-function comparison tests.
5. **Add a one-way-door / reversibility note** for the new-crate decision: state
   the decision criterion (does `compute-parser` genuinely need the lists at
   compile time, or does a generated drift test suffice?) and treat crate creation
   as the fallback, since the plan already shows the drift test is viable.
6. **Tie each phase to its verification gate and snapshot artifact** so reviewers
   can judge "done and safe to merge" per phase rather than for the whole program.

These are refinements, not corrections — the plan's foundations are sound and its
reading of the codebase is accurate.
