Rating: 8/10

Summary judgment

This is a strong, evidence-heavy plan for `compute-charts`. It identifies the right production boundary (`chart_apply_transforms` before the TS grammar compiler), ties the most important defects to user-visible WASM-vs-TS divergence, and proposes systematic fixes rather than isolated patches. The sequencing is mostly coherent: unify expression parsing, fix grouping/keying, add diagnostics, then do ownership/perf and parity tests. The plan is not yet a fully executable contract because several parity rules are asserted rather than specified, and it misplaces the TS grammar implementation path.

Major strengths

- The plan correctly treats behavioral parity with the TS grammar path as the dominant invariant. That is the right architectural frame for this crate because the kernel silently selects either WASM-transformed data or TS-transformed data depending on availability/failure.
- The evidence section is concrete and largely validated by the source: duplicated hand-rolled expression evaluators, raw `expr.find(op)` comparison splitting, calculate splitting that can hit scientific notation signs, `BTreeMap` aggregate ordering, dead `ChartError`, and avoidable deep clones through an owned-data bridge are real issues.
- The objectives are production-path relevant. They target `compute-charts` transform execution and the bridge/compiler path, not a test-only harness.
- The plan names important invariants: serde wire compatibility, additive FFI shape, total/no-panic transform execution, deterministic output order, and preserving the TS fallback path.
- Verification is much better than average: focused Rust unit tests, diagnostics tests, a cross-language parity corpus, no-panic malformed input coverage, bridge compile gates, TS compiler tests, and a chart-render smoke are all appropriate.

Major gaps or risks

- The plan says the TS chart grammar transforms live under `mog/kernel/src/domain/charts`, but the implementation is in `mog/charts/src/grammar/transforms`; the kernel compiler imports `@mog/charts` and only wraps the WASM/fallback decision. That pathing matters because the parity oracle, fixture ownership, and TS verification gates should be rooted in the `charts` package, with kernel tests covering only integration/fallback behavior.
- The key-coercion proposal is under-specified and may be wrong if implemented literally. Current TS `groupBy` uses `JSON.stringify(fields.map(...))`, which distinguishes numeric `1` from string `"1"` while normalizing JS numeric `1`/`1.0`. A JS-`String()`-aligned key would collapse `1` and `"1"`, which could create a new parity bug. The plan needs a typed canonical key contract, not just "JS String aligned."
- The expression grammar objective is directionally right but too open. "Vega-expression subset the TS grammar exposes" is not a precise spec, especially because the current `@mog/charts` TS evaluator is a small regex-based subset, not a full Vega expression implementation. The plan should first define the accepted grammar, unsupported syntax behavior, parse-error diagnostics, and calculate/filter result semantics from fixtures.
- Diagnostics are still a design choice in the plan, not a settled contract. `TransformOutcome`, a threaded diagnostics buffer, a new bridge export, and old-export forwarding are all mentioned. The plan should choose the externally visible shape, how callers opt in, and when diagnostics affect fallback.
- The plan crosses several ownership boundaries (`compute-charts`, `compute/core/src/bridge_pure.rs`, `charts`, possibly `compute-stats`) while the review source folder is only `compute-charts/src`. That is probably necessary for correctness, but the plan should separate "must land with this work" from "dependent follow-up owned elsewhere."
- The CI discussion for `ci0`/`ci1` assumes Vega-Lite bootstrap may be the oracle, but the current TS `@mog/charts` aggregate implementation also uses a normal approximation. The plan correctly says to confirm, but the evidence currently overstates this as an observed TS divergence.

Contract and verification assessment

The production contract is mostly identified but not fully pinned. The strongest contract is: same input rows and same `Transform[]` must produce identical rows and order whether WASM transforms are available or the `@mog/charts` TS grammar handles transforms. The plan should make that the formal acceptance criterion and explicitly define JSON comparison normalization for floats, null/undefined absence, field insertion/order expectations, and unsupported expression behavior.

The verification gates are appropriately broad for the blast radius, but they need path correction. In addition to `cargo test -p compute-charts`, `cargo clippy -p compute-charts`, bridge build/codegen checks, and kernel chart compiler tests, the plan should explicitly run the `@mog/charts` transform/grammar tests and `@mog/charts` typecheck when TS grammar fixtures or semantics are touched. The golden parity corpus is the right idea, but it needs a concrete shared fixture location and a generator/source-of-truth process so the Rust side is not just snapshotting stale TS behavior.

Concrete changes that would raise the rating

- Correct the TS oracle path to `mog/charts/src/grammar/transforms` and add `@mog/charts` package tests/typecheck to the required gates.
- Replace the keying objective with an explicit typed canonical-key spec: normalize Rust numeric representations to JS number identity, preserve number-vs-string distinctions if the TS oracle does, and apply that same contract to aggregate group keys, distinct, grouping utilities, and stacking categories only where parity requires it.
- Define the exact expression grammar before implementation: tokens, precedence, supported literals, field addressing, unary operators, logical/comparison availability in filter vs calculate, unsupported syntax result, and diagnostics.
- Choose one diagnostics API shape up front, preferably an additive export that returns `{ rows, diagnostics }` while preserving `chart_apply_transforms` unchanged.
- Split the work into landing phases with gates per phase: expression parity, aggregate/key parity, diagnostics bridge, ownership threading, stats/bin follow-up.
- Add a concrete shared fixture plan for cross-language parity, including fixture path, how expected outputs are produced, and how Rust and TS tests consume the same cases.
