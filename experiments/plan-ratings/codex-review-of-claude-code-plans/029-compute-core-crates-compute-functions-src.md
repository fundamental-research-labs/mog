Rating: 8/10

Summary judgment

This is a strong, production-path plan for a real architectural problem in `compute-functions`: the split between `PureFunction` scalar flags, `ExcelFunction` signatures, hand-written error/coercion handling, and the separate TypeScript catalog mirror. The plan is unusually evidence-rich: its file count, LOC, register-call count, registry architecture, `ArgRole` semantics, `_xlfn` normalization, default-argument path, and `__internal` boundary all match the current source closely. Its best feature is Phase 0: it requires an authoritative three-way inventory and function-id persistence check before edits, which is exactly the right guardrail for a parity-surface refactor.

I would not rate it higher because the context-function/catalog reconciliation is still under-specified for the actual shape of the evaluator. Several functions are not simply "inline-only and invisible to the registry"; some are registered pure functions but promoted or intercepted by `eval_primitives.rs` for context/performance (`PERCENTILE*`, `QUARTILE*`, `RANK*`, `LARGE`/`SMALL`, `AREAS`, `CELL`, `SHEETS`, D-functions), some are optimized then fall back to registered `ExcelFunction`s (`COUNTIF(S)`, `SUMIF(S)`, etc.), and some are pseudo/internal or intentionally not normal functions (`TABLE`, operator aliases, `FORMULATEXT`, `GETPIVOTDATA`, possibly `ARRAYFORMULA`). The plan notices this class of problem, but the implementation contract needs a sharper taxonomy before "metadata-only entries" can be safe.

Major strengths

- Correctly targets the highest-leverage abstraction issue: all functions need one declarative signature model for arity, defaults, error propagation roles, and array lifting.
- Preserves production behavior explicitly: Phase 1 is behavior-preserving, with existing `COUNTIF`/`SUMIFS` criteria-error semantics and array-lift behavior called out as invariants.
- Treats the TS catalog drift as a contract problem, not a documentation problem. Generating or drift-checking `spreadsheet-utils/src/function-catalog.ts` from Rust is the right direction.
- Includes important non-obvious invariants: function id non-persistence, arity gate ordering, volatile/dynamic-array flags, `_xlfn._xlws.` normalization, and the `__internal` SPI boundary.
- The sequencing is mostly sound: inventory and oracle first, shared signature scaffolding second, then domain-by-domain migration, catalog generation, context reconciliation, corpus, fuzzing, and coercion cleanup.
- The verification philosophy is strong: behavior identity, catalog completeness, golden corpus, fuzz panic-freedom, and drift checks are all relevant to the production path.

Major gaps or risks

- The inline/context function contract needs to distinguish at least four cases: registry-backed functions with evaluator fast paths, registry-backed functions with evaluator context overrides, true context-only user functions, and internal/pseudo/operator functions that should not necessarily appear in autocomplete or the public catalog. Without that taxonomy, adding metadata-only registry entries can duplicate existing names or make `FunctionRegistry::call` claim callable functions that still require AST/evaluator context.
- The serialized catalog schema is not specified. It should say whether `catalog()` exposes `returns_array`, volatility, defaults, `ArgRole`, variadic groups, evaluation kind, aliases/prefix handling, and source location, not only the compact TS fields of name/category/description/min/max.
- Co-locating human descriptions and argument help in the compute crate is architecturally plausible but not risk-free. The plan should address wasm payload impact, localization/string churn, and whether catalog metadata is feature-gated or separated from the hot dispatch path.
- The Phase 1 oracle is described as a sample for the 433 pure implementations, then later as behavior identity for every migrated function. The latter is needed; the plan should define an exhaustive generated oracle over argument positions, errors, arrays, omitted defaults, and representative arities, especially for variadic functions.
- The plan says 434 `PureFunction` implementors; the current source has 433 `impl PureFunction for` matches and 8 `impl ExcelFunction for` matches. This is a minor evidence drift, but this plan is specifically about exact catalog contracts, so exact counts matter.
- Panic-freedom is directionally right, but a grep ban on new production `unwrap()`/`expect()` needs a precise rule. Some current matches are in inline test modules or are provably safe constants/String writes; CI should avoid both false positives and missed production panics.
- The coercion convergence objective is large and parity-sensitive. The plan should classify coercion modes by Excel behavior before changing call sites, because blanket helper routing can break intentional differences between scalar functions, aggregators, criteria functions, database functions, and text/date parsing.

Contract and verification assessment

The contract section is the strongest part of the plan. It names the right runtime invariants and clearly separates pure/context-free evaluation from evaluator-context functions. The array-lift and error-propagation contracts are concrete enough to guide implementation, and preserving `register_all`/id semantics until persistence is disproven is the correct risk posture.

Verification is good but incomplete for the cross-folder work the plan requires. Rust implementation gates should include `cargo test -p compute-functions`, `cargo test -p compute-core`, and clippy for the touched Rust crates. Because the plan changes TypeScript catalog generation and contracts, it should also require the relevant TS tests plus `pnpm typecheck` or a clearly justified narrower type gate. The catalog drift check should be promoted from "generator or check" to a required gate with deterministic output.

Concrete changes that would raise the rating

- Add an explicit `FunctionCatalogEntry` schema with fields for evaluation kind (`Pure`, `EvaluatorInline`, `EvaluatorFastPathThenRegistry`, `Pseudo/Internal`), aliases, arity, defaults, volatility, returns-array, signature roles, category, descriptions, and argument metadata.
- Replace the vague "~50 inline functions" reconciliation with an exact Phase-0 inventory table and policy for each name, including `ARRAYFORMULA`, `FORMULATEXT`, `TABLE`, operator aliases, percentile/rank promoted functions, D-functions, and IF/SUMIF-family fast paths.
- Define the behavior-identity oracle as exhaustive and generated, not representative: for every function and supported argument index, test error propagation, array lifting, omitted arguments/defaults, and arity behavior before and after migration.
- Specify the generator/drift-check contract: stable serialization format, deterministic ordering, committed generated TS file, and CI failure mode.
- Feature-gate or otherwise isolate human-facing catalog strings so dispatch and wasm payload are not coupled to UI metadata more than necessary.
- Add clippy and TypeScript gates to the verification section, plus a focused UI/autocomplete smoke test if generated metadata changes user-facing formula help.
