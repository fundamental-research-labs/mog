Rating: 8/10

# Review — 087 `mog/compute/core/crates/compute-charts/src`


## Summary judgment

This is a strong, evidence-grounded plan. It correctly identifies that the dominant
invariant of this crate is not performance but **behavioral parity with the TypeScript
chart grammar**, because the JS consumer silently falls back to the TS path on any WASM
throw or absence — so any WASM/TS divergence is invisible in single-path tests yet
user-visible in production. Nearly every evidence claim is backed by a precise file:line
citation, and I verified the load-bearing ones against the current tree: they hold.

I confirmed:
- `filter.rs:147-154` splits comparisons with raw `expr.find(op)` and no string/paren
  awareness, while `split_logical` (`:164-210`) *is* string-aware — so a literal containing
  `==`/`>`/`<` corrupts the predicate exactly as described.
- `calculate.rs:109-154` `split_binary_op` scans for `+`/`-` chars with no numeric-literal
  awareness, so `1e-5` and signed/unary minus mis-split.
- `aggregate.rs:34-45` groups into a `BTreeMap` (sorted-by-serialized-key output) and
  returns `Vec::new()` on empty input; `make_group_key` (`:74-84`) uses `v.to_string()`,
  whereas `grouping.rs:42-58` keeps first-seen order via a `Vec` + `HashMap` index and keys
  via `serde_json::to_string` — the keying inconsistency is real.
- `error.rs` `ChartError` is defined but never constructed (grep finds only the definition).
- `transforms/mod.rs:22-27` does `data.to_vec()` then re-borrows per step, and
  `bridge_pure.rs:568-572` takes `data: Vec<DataRow>` by value only to pass `&data` —
  confirming the avoidable clone path.
- `chart-compiler.ts:368-406` is exactly the dual-path fallback the plan centers on.

The plan reads like it was written from the code, not from a summary. The improvement
objectives follow directly from the evidence, scope is honest (leaf crate, additive FFI),
and the non-goals are disciplined (no new transform types, no `compute-stats` redesign, no
test-only shims).

## Major strengths

- **Correct invariant identification.** Framing parity as the dominant constraint, ahead of
  performance, is the right call and drives every objective. The "divergence cuts both
  ways" risk (fixing WASM to be "more correct" can *increase* divergence from a TS path
  that shares the bug) is the single most important subtlety here, and the plan names it.
- **Concrete, verifiable evidence.** File:line citations throughout; defects are explained
  with worked failure cases (`datum.tag != "a==b"` passing unconditionally; `datum.x * 1e-5`
  collapsing to `Null`). This is the difference between a plan and a wishlist.
- **Sound architecture for the fix.** Collapsing two divergent hand-rolled evaluators into
  one tokenizing/Pratt-parsed `transforms/expr/` module shared by filter and calculate is
  the right structural move and removes a whole class of split-by-byte bugs at once.
- **Strong contract discipline.** Calls out serde wire compat (`#[serde(default)]` additive
  fields, the `ChartSortOrder` codegen-collision note), FFI signature stability, never-panic
  /never-throw across the boundary, and determinism (no `HashMap` iteration order leakage).
- **Verification is layered**: ported unit tests, new edge-case tests, a diagnostics suite,
  a no-panic fuzz-lite, a golden parity harness, explicit CI gates, and an optional criterion
  bench to guard the clone-elimination win.
- **Honest sequencing.** Objective 4 (ownership threading) is correctly placed after 1 and 2,
  with file-disjointness reasoning for what can parallelize.

## Major gaps or risks

- **The `ci0`/`ci1` objective punts the design decision.** "Confirm the TS oracle's
  definition; if bootstrap, implement seeded bootstrap; if normal-approx, document it" is a
  branch, not a decision. The plan does not establish whether the TS grammar even emits
  `ci0`/`ci1`, nor by what method — which is exactly the fact needed to size the work. This
  is the weakest objective and could hide a substantial `compute-stats` change behind a
  one-line "coordinate with the owner."
- **Scope-vs-parity tension is acknowledged but not resolved.** The plan's deliverable
  boundary is the Rust crate, yet true parity for objectives 1 and 5 requires *lockstep*
  edits to `mog/kernel/src/domain/charts`, which it declares out-of-scope-to-edit. So the
  prescribed fixes may not be landable within this plan's stated scope without a co-owned
  TS change that is neither sized nor sequenced here. This is the biggest practical risk to
  execution.
- **The golden parity harness mechanism is underspecified.** Objective 6 says "place
  fixtures so both the Rust test and a TS-side test can consume them," but cross-language
  fixture sharing is non-trivial — no format, location, or generation/refresh procedure is
  given. As written it is the right idea without an executable spec; the harness is also the
  gate that everything else depends on, so its vagueness propagates.
- **Aggregate-ordering "defect" is asserted against Vega, but the real oracle is the TS
  grammar.** The evidence says BTreeMap order "diverges from `grouping.rs` and from Vega" —
  but parity is defined against the TS path, not Vega. The plan should confirm the TS
  grammar's *actual* aggregate output order before declaring first-seen the target; if the
  TS path also sorts, switching to first-seen would itself be a regression. (The plan flags
  this category of risk generally, but states this specific item as a settled defect.)
- **Diagnostics contract shape is deferred.** `ChartDiagnostic`'s fields and whether JS will
  actually consume the new `chart_apply_transforms_diag` export are left to the bridge owner.
  Reasonable to defer ownership, but the contract isn't pinned, so objective 3 could land as
  dead plumbing if the JS side never reads it.

## Contract and verification assessment

Contract clarity is above average for this corpus. The four preserved invariants
(WASM⇄TS equivalence, never-throw, serde wire compat, FFI signature stability) are each
tied to a concrete code location and a concrete preservation rule (additive-only fields,
separate diagnostics export rather than a breaking return-type change). The determinism and
finite-output disciplines are correctly carried through to the post-change state.

Verification gates are comprehensive and appropriate: unit/ported tests, targeted
edge-case tests that map one-to-one onto the evidence (string-literal operators, `1e-5`,
unary minus, `"9"` vs `"10"` ordering, `1`/`1.0`/`"1"` keying, empty-data global aggregate),
a no-panic property test, and the cross-path golden harness. The named CI commands
(`cargo test -p compute-charts`, clippy `-D warnings`, the NAPI/WASM build to catch FFI
signature breaks, the TS `__tests__`, and an app-eval chart-render smoke) are the right set.
The one soft spot is that the most important gate — the golden harness — is the least
concretely specified, and the `ci0`/`ci1` parity test is contingent on an unmade decision.

## Concrete changes that would raise the rating

1. **Resolve `ci0`/`ci1` before implementation.** Inspect the TS grammar, state definitively
   whether it emits these and by what method, and either commit to seeded-bootstrap (with
   the seeding/determinism contract spelled out) or to documented normal-approx. Replace the
   if/else branch with a decision. (→ closes the biggest open design hole.)
2. **Size and sequence the TS co-change.** For objectives 1 and 5, name the specific
   `mog/kernel/src/domain/charts` files that must change in lockstep, who owns them, and
   whether this plan blocks on that or spawns a paired plan. Make the parity-blast-radius
   explicit rather than a risk note.
3. **Make the golden harness executable.** Specify the fixture file format and location, how
   expected outputs are captured from the TS grammar, and how both the Rust `#[cfg(test)]`
   and the TS test load the same corpus. This is the gate the whole plan leans on.
4. **Verify the TS aggregate ordering** and restate the objective-2 target as "match the TS
   path's observed order" rather than "first-seen / Vega," so the fix can't itself become a
   parity regression.
5. **Pin the diagnostics contract.** Sketch `ChartDiagnostic`'s concrete shape and confirm a
   JS consumer (even a `console.warn`) will read the new export, so objective 3 doesn't ship
   as unused plumbing.
6. **Pin the supported expression grammar surface** in a checked-in doc comment + a test
   list, so "exactly the TS subset, no more no less" is enforceable rather than aspirational.
