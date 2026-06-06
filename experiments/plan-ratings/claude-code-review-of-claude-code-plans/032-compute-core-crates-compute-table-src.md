Rating: 8/10

# Review of Plan 032 — `compute-core/crates/compute-table/src`


## Summary judgment

This is a strong, evidence-grounded plan. It targets the pure table-compute kernel
(`compute-table`) and proposes seven ranked, production-path objectives, every one of
which I could verify against the actual source. The author clearly read the code: line
references, comments, signatures, and the authoritative `EDGE_VALUE_SEMANTICS.md` are
quoted accurately, and the named gaps are real correctness/robustness defects, not
make-work. The contract section is unusually disciplined — it enumerates the invariants
(purity, no-panic, edge-value spec, table-vs-pivot sort divergence, bitmap byte layout,
wire-format additivity, determinism) that any change must preserve. Sequencing is
sensible (smallest/safest first, conformance gate guarding the riskiest refactor), and
the cross-folder ripple to the bridge and FFI shells is identified precisely.

The reasons it is an 8 and not a 9–10: O6 (de-allocation) is the weakest objective —
its payoff is asserted but speculative, and one of its tactics (Cow lowercasing that only
avoids allocation for already-lowercase ASCII) buys little on real mixed-case data while
the value-key-set rewrite carries genuine edge-semantics risk. O4 (formula criteria)
introduces a re-entrant evaluator callback into a crate whose defining property is
purity/statelessness, and the re-entrancy/cycle risk is only lightly mitigated. And there
is a minor internal sequencing contradiction around when O5 should land.

## Verification performed

I confirmed the plan's factual claims directly:

- `filter.rs` — `evaluate_column_filter` already carries `now`/`week_start_day` params;
  `Icon(_) => vec![1u8; len]` all-visible no-op (~:125) and the `Icon(_) => true`
  fallthrough (~:216) both exist; `Color` with `column_formats: None => vec![1u8; len]`
  silent all-pass (~:119) exists; single-condition-only string precompute (~:148) exists.
- `filter_resolve.rs:73` — `now.expect("Date-based dynamic filter requires a `now` date
  parameter")` confirmed, with the match-nothing fallback at ~:77 the plan proposes to reuse.
- `advanced_filter.rs` — `UnsupportedFormulaCriteria` early-return on `is_formula` (~:321)
  confirmed; the `unreachable!()` arm (~:492) the plan says to leave alone is present.
- `storage/sheet/filters/bridge.rs:182` forwards the icon payload back into `Icon(...)`
  without re-matching; `evaluation.rs:114` passes `None /* week_start_day */`;
  `evaluation.rs:97` materializes `column_formats` only for the relevant criterion.
- `compare.rs` — `build_value_key_set` returns `HashSet<String>` (~:219), `cell_value_key`
  returns owned `String` (~:189), `Circ => 3 // Same rank as Ref` (~:43) all confirmed.
- `EDGE_VALUE_SEMANTICS.md` names exactly the seven modules the plan cites and matches the
  ordering/edge-rule claims.

Line numbers drift by a few in places (the plan was evidently written against a slightly
earlier snapshot), but every substantive claim holds. That level of accuracy is a credit
to the plan.

## Major strengths

- **Real, prioritized defects.** O1 (icon filter silently shows all rows), O3 (production
  panic reachable from caller data, aborting across WASM/NAPI), and O7 (silent all-pass
  color filter) are concrete correctness/robustness bugs on the live path, not polish.
- **Contract-first framing.** The invariants section is the best part: it turns the
  edge-value doc into an acceptance bar, calls out the table-vs-pivot sort boundary as a
  thing centralization must *not* erode, and demands additive `#[serde(default)]` wire
  changes so stored documents keep deserializing.
- **FFI/bridge ripple is mapped.** The plan names `bridge_pure.rs`, the storage delegators,
  the WASM/NAPI/PyO3 shells, and the TS contract generator, and proposes a single
  `FilterEvalContext`/settings struct so future params don't re-break every call site —
  a real architectural improvement, not just a fix.
- **A meta-gate (O5).** Encoding the Quick Reference table as a data-driven fixture that
  drives all seven modules, plus a deliberate-mutation meta-test, is exactly the right
  mechanism to stop doc/code drift, and it is positioned as the safety net for O6.
- **Phase-0 decision gate.** O1/O2/O4 each hinge on an upstream "where does this data come
  from" question, and the plan refuses to start implementation before recording those
  decisions — good discipline that prevents the most likely stall.

## Major gaps or risks

- **O6 payoff is unquantified and partly weak.** The `Cow` lowercasing only avoids an
  allocation when the value is already lowercase ASCII; for typical mixed-case text columns
  it still allocates. The headline "no allocation per row" is therefore not generally
  achievable via that tactic, and the genuinely impactful change (replacing the
  `HashSet<String>` with a borrowed/custom-`Hash` key) is precisely where NaN/blank/error
  identity bugs hide. The plan acknowledges this and gates it behind O5 + a differential
  corpus, which is the right mitigation, but it should state the *expected* win (or mark
  O6 as deferrable) rather than asserting "a net throughput win" with benchmarking pushed
  out of the folder. As written, O6 is the objective most likely to cost more than it returns.
- **O4 vs purity tension.** Threading a formula-evaluation callback into a "no I/O, no
  globals, pure" crate is defensible (the crate only sees a boolean-returning closure), but
  re-entrancy, recalc cycles, and per-candidate-row cost are real. "Bound by the caller's
  existing recalc deadline" is a one-line mitigation for what could be a significant
  semantics/perf surface (Excel evaluates the criteria formula with the active row
  substituted — the substitution contract is under-specified here).
- **O7 internal tension on where color resolution lives.** The plan says both "broaden
  `matches_color_filter` to handle theme/indexed/tinted" and "resolution of theme→RGBA
  happens upstream; ensure the bridge hands fully-resolved colors." Those are two different
  designs. It should pick one: either the engine resolves (needs theme context — breaks
  purity) or the bridge resolves and the engine only compares RGBA (then "broaden
  `matches_color_filter`" reduces to robust hex/alpha normalization). The hedge leaves the
  contract ambiguous.
- **Sequencing contradiction for O5.** The implementation plan lands O5 *last* (Phase 7),
  while the rationale and parallelization notes say O5 should land *early* as O6's safety
  net. Both can't be literally true; the phase numbering should make O5 precede O6.
- **App-eval/api-eval gates lean on the environment, not the folder.** The cross-cutting
  gates (XLSX round-trip, contract generator, app-eval icon import) are appropriate, but
  the plan can't run them (per constraints) and several depend on fixtures/scenarios that
  may not exist yet (e.g. an icon-set AutoFilter XLSX). The plan should flag which gates
  require new fixtures to be authored vs. which already exist.

## Contract and verification assessment

Contract clarity is high. The bitmap layout (`Vec<u8>`, 1=visible, AND over min length),
the positive/negative operator polarity (positive → false on blank/NaN/error/mismatch;
negative → true), the type-rank and fixed error sub-order, `NaN == NaN` for dedup,
`"" is NOT blank`, and `Circ`→`Ref` rank are all stated and match the code/doc. The
no-panic invariant is correctly scoped (existing `unreachable!` arms must stay genuinely
unreachable; O3 removes the one reachable `expect`).

Verification gates are objective-by-objective and mostly falsifiable: O3 asserts a
`Result`/match-nothing bitmap and a WASM-boundary smoke; O5 includes a self-test (mutate a
module, confirm the gate fails); O6 demands byte-identical differential output over a
randomized corpus including NaN/Inf/error/blank/mixed-type. The main weakness is that
"benchmark shows no allocation per row" is asserted for O6 but benchmarking is explicitly
deferred out of the folder, so that gate has no owner inside this plan's scope. The color
gate (O7) is concrete (`#FFFF00 == #ffff00`, theme/indexed/tinted match, missing-format →
typed error). Overall the gates are good enough to merge against, with the O6 perf gate
being the soft spot.

## Concrete changes that would raise the rating

1. **Resolve the O5 sequencing contradiction** — make O5 land before O6 in the phase list
   (or explicitly: O5 fixture first, O6 refactor second), since the plan itself calls O5
   the prerequisite safety net.
2. **Quantify or down-rank O6.** State the expected allocation/throughput delta (or mark it
   "deferrable, perf-only") and drop the over-strong "no allocation per row" claim, since
   the Cow tactic doesn't deliver that for mixed-case text. Assign an owner/home for the
   benchmark instead of pushing it entirely out of folder.
3. **Pick one O7 color-resolution design.** Either the bridge hands fully-resolved RGBA and
   the engine only normalizes/compares (preserves purity — preferred), or the engine takes
   theme context. Remove the contradictory "broaden `matches_color_filter` to handle theme"
   wording if resolution is upstream.
4. **Specify the O4 substitution contract.** Define exactly what the formula-criteria
   callback receives (the candidate row's active-cell binding, the criteria range origin)
   and how cycles/recalc-deadline are enforced, rather than "evaluated by the caller's
   evaluator." This is the riskiest engine↔bridge contract and deserves a signature sketch.
5. **Audit fixture availability for the cross-cutting gates.** Note which app-eval/api-eval
   scenarios and XLSX corpus entries (icon-set AutoFilter, Monday week-start, formula
   criteria) already exist vs. must be authored, so the verification plan isn't blocked on
   missing inputs.
6. **Refresh the line numbers** against the current snapshot (a handful drifted, e.g.
   `advanced_filter.rs` ~199/321, `filter.rs` ~119/125/216) so implementers land on the
   right arms.
