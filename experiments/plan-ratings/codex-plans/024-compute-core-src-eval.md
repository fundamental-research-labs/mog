# 024 - Compute Core Eval Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/src/eval`

Scope for this plan is the production formula evaluation engine in `compute-core`: evaluator state, AST evaluation, internal evaluation values, reference and range semantics, LET/LAMBDA and higher-order functions, special evaluator primitives, lookup dispatch and indexes, aggregate/statistical fast paths, multi-tier eval caches, external reference contracts, iterative/vectorized coordination helpers, and the eval-focused test modules.

Adjacent production dependencies that must be considered:

- `compute/core/src/scheduler/*`, which owns production recalc orchestration and calls `Evaluator::evaluate()` from full, incremental, cycle, selective-fixup, data-table, and schema-validation paths.
- `compute/core/src/eval_bridge/*`, especially `MirrorContext` and `MirrorAccess`, which implement `EvalDataAccess`, `EvalMetadata`, and dense/cache access against `CellMirror`.
- `compute/core/src/mirror/*`, which supplies column slices, column versions, projection source arrays, sheet/name lookup, and raw cell data used by cache validation.
- `compute/core/crates/compute-parser`, `compute-functions`, `value-types`, `formula-types`, and `cell-types`, which define the AST, pure function registry, cell values/errors, references, sheets, cells, dense columns, and arrays.
- `compute/core/crates/compute-graph` and scheduler range dependency extraction, because reference semantics and dynamic ranges determine production recalc ordering.
- WASM/N-API/Tauri bridge callers that expose formula evaluation and workbook recalc to the app and SDK.

This is a public Mog source folder. Implementation belongs in `mog`; this plan remains internal.

## Current role of this folder in Mog

`eval` is the single formula execution core. `scheduler/mod.rs` documents that every production recalc path converges on `Evaluator::evaluate()` with a `MirrorContext` adapter. The folder currently re-exports `Evaluator`, `EvalDataAccess`, `EvalMetadata`, cache stats, range keys, and external workbook provider contracts.

The folder has these main subsystems:

- `engine/*`: recursive AST evaluation, operation/depth/scope state, special function dispatch, operators, references, implicit intersection, sheet/3-D refs, aggregate helpers, formula text helpers, statistical primitives, LET/LAMBDA, and higher-order dynamic-array functions.
- `eval_value.rs`: internal evaluator-only values for `Cell`, `Lambda`, and omitted optional lambda arguments. These collapse back to `CellValue` at evaluator boundaries.
- `context/traits.rs`: split data access contracts. `EvalDataAccess` is async for cell/range reads; `EvalMetadata` is sync for structural queries, dense columns, lookup indexes, workbook cache hooks, formula metadata, row visibility, tables, pivots, and timestamp injection. `sync_block_on()` bridges the currently synchronous production contexts.
- `cache/*`: `RangeStore`, `WorkbookCache`, lookup-index cache, subexpression cache, lambda-expression cache, range versioning, staged `EpochCache`, and a placeholder database cache.
- `lookup/*`: VLOOKUP/HLOOKUP/MATCH/XMATCH/XLOOKUP/INDEX/OFFSET/INDIRECT logic plus lookup geometry, wildcard handling, and vertical/horizontal indexes.
- `functions/*`: eval-layer function adapters for borrowed conditional aggregates, dense aggregates, SUMPRODUCT, SUBTOTAL/AGGREGATE, and GETPIVOTDATA.
- `coordination/*`: iterative convergence solver and a vectorized shared-formula subsystem. The vectorized subsystem has local tests, but inspection did not find production scheduler integration for `detect_groups()` or `execute_group()`.
- `eval_tests/*`: focused evaluator unit tests for arrays, coercion, dynamic refs, error propagation, lookups, LET/LAMBDA, ranges, SUBTOTAL, SUMPRODUCT, and boundary behavior.

Important current observations:

- `Evaluator::evaluate_with_deadline()` exists, but inspected production call sites use `Evaluator::evaluate()`. Scheduler deadlines are checked around phases and levels, not consistently inside one expensive formula's evaluator loop.
- `EpochCache` is staged and documents a future migration to thread epoch cache state through the evaluator. Current epoch-scoped subexpression and sheet-name caches still use thread-local backing stores cleared by scheduler entrypoints.
- `WorkbookCache` has sorted/frequency/bitmask caches and unused incremental-update methods waiting for old-value threading. Its database cache tier is still a placeholder, while D-functions currently re-evaluate database and criteria ranges through the pure registry.
- Several fast paths intentionally bypass materialization: dense aggregates, borrowed multi-criteria aggregates, lookup indexes, sorted caches, and SUMPRODUCT fusion. These must remain provably equivalent to scalar/materialized fallback paths.
- Reference semantics are partly value-oriented. Range operators and intersections have area helpers, but the general evaluator value model does not carry first-class reference values; many consumers materialize arrays earlier than Excel semantics require.
- External workbook contracts exist in `external.rs`, while `ExternalSheetRef`, `ExternalThreeDRef`, and `ExternalNameRef` currently fail closed with `#REF!` when evaluated.

## Improvement objectives

1. Make a typed per-formula evaluation session the production contract: current cell, data access, metadata, deadline, operation/depth limits, active epoch cache, workbook cache handles, trace/journal metadata, and error policy should be explicit.
2. Enforce per-formula deadlines in the actual evaluator path, not only in scheduler outer loops. Long-running formulas, recursive lambdas, huge dynamic arrays, indirect range scans, and fused fast paths must tick the same deadline/operation budget.
3. Replace partial thread-local epoch cache ownership with explicit epoch-cache state that can be safely used across sequential, rayon, and WASM paths.
4. Add first-class internal reference values so range/reference-producing formulas preserve reference identity until the consuming function requires materialization.
5. Make evaluator primitive dispatch declarative enough to encode argument mode, laziness, arity/default behavior, volatility, reference needs, and array-lifting rules without ad hoc drift.
6. Prove all production fast paths are equivalent to fallback evaluation, then extend them only through measured production paths.
7. Wire or retire staged subsystems systematically: integrate vectorized shared-formula execution into production recalc with strict guards, or keep it clearly non-production; implement database caching for D-functions if D-functions remain evaluator primitives.
8. Implement external reference evaluation against the existing provider contracts, with authorization, freshness, calc-epoch isolation, batching, and fail-closed diagnostics.
9. Strengthen eval tests from isolated unit coverage into production-path contract tests that exercise `ComputeCore` and storage-engine entrypoints.

## Production-path contracts and invariants to preserve or strengthen

- `Evaluator::evaluate()` or its replacement remains the only formula evaluation engine. Scheduler, storage, schema validation, named-value queries, and SDK evaluate paths must not fork private evaluators.
- Final evaluator output remains `CellValue`. Evaluator-only values such as lambdas, omitted arguments, and internal references must not escape to storage, wire, formatting, or projection registries except through an intentional boundary conversion.
- `CellValue::Null` is preserved during evaluation. Scheduler-level Excel boundary coercion from final formula `Null` to `Number(0)` must remain outside the evaluator unless that boundary is explicitly moved and tested.
- Operation, depth, scope, and deadline limits must apply uniformly to recursive AST evaluation, range/reference helpers, higher-order lambda loops, dynamic-array construction, lookup scans, aggregate scans, SUMPRODUCT fusion, D-function parsing, and external reads.
- Scope stack push/pop must be exception-safe for LET, LAMBDA calls, captured scopes, nested higher-order functions, optional parameters, and early errors. No user-authored formula should be able to unbalance scope state.
- Function argument behavior must match Excel-compatible contracts: lazy IF/IFERROR/IFNA/IFS, lazy `if_not_found` where applicable, omitted-argument defaults, correct error propagation, array broadcasting/lifting, and reference-vs-inline aggregate provenance.
- Reference identity must be preserved for functions that inspect references (`ROW`, `COLUMN`, `ROWS`, `COLUMNS`, `AREAS`, `FORMULATEXT`, `ISFORMULA`, `SUBTOTAL`, `AGGREGATE`, `INDEX`, range operator, intersections, implicit intersection, `ANCHORARRAY`, structured refs, 3-D refs) until a value is required.
- Range materialization must use one canonical range-key resolution and clamping contract across `RangeStore`, `MirrorContext`, lookup geometry, full-column/row refs, structured refs, dynamic refs, and cache pre-scans.
- Fast paths must be semantically invisible. Dense aggregates, borrowed conditional aggregates, lookup indexes, sorted caches, SUMPRODUCT fusion, vectorized groups, and database caches must return the same values/errors as fallback scalar evaluation for the same workbook state.
- Epoch-scoped caches must not leak across recalculation epochs, data-table override iterations, cycle iterations, projection stabilization passes, or rayon worker threads.
- Workbook-lifetime caches must be version-validated, invalidated on structural edits, and either incrementally patched from old/new values or rebuilt deterministically.
- External workbook reads must fail closed when provider context is missing, unauthorized, stale beyond policy, ambiguous, broken, loading, or circular. Diagnostic messages must be safe for the requesting principal.
- Native and WASM builds must preserve the same formula results even if cache implementations differ internally.
- Public dependency direction stays intact: `mog` must not depend on `mog-internal`.

## Concrete implementation plan

1. Define the evaluator session contract.

   - Add an `EvalSession` or `EvalOptions` type that carries deadline, operation/depth/scope limits, cache epoch handle, current formula identity, tracing/journal metadata, and optional external provider context.
   - Replace the split `evaluate()` and unused `evaluate_with_deadline()` API with one explicit entrypoint plus a convenience wrapper for no-deadline tests.
   - Update scheduler and storage call sites to pass the production `Deadline` through to each formula evaluation.
   - Make `tick()` cheap but universal. Add calls inside tight loops that currently perform large work without re-entering `eval_node()`: higher-order array loops, SUMPRODUCT fused loops, aggregate/lookup scans, D-function/database parsing, reference area loops, and external batches.
   - Add deterministic `ComputeError::DeadlineExceeded` handling at scheduler result application so timeout behavior is visible and testable.

2. Make cache ownership explicit and epoch-aware.

   - Turn `EpochCache` from staged diagnostics into the actual owner of subexpression cache, sheet-name normalization cache, per-epoch old-value snapshots, and any other epoch-scoped evaluator state.
   - Remove direct production access to `subexpr_cache` thread locals. On native, use a sharded/thread-safe epoch cache or explicit per-worker shards keyed by epoch id; on WASM, use single-threaded interior mutability behind the same API.
   - Route scheduler `clear_thread_local_caches()` through a single epoch/session boundary API. Data-table override evaluation and cycle convergence iterations must create or reset scoped epoch cache state instead of manually clearing individual caches.
   - Thread old-value snapshots into `WorkbookCache` incremental update methods for sorted, count-frequency, sum-frequency, and bitmask caches. If an incremental patch is not safe, invalidate/rebuild through the same versioned path.
   - Add entry counts and memory estimates for `LookupIndexCache`; wire lookup cache counters instead of leaving lookup stats at zero.
   - Implement the `database_cache` tier for repeated D-functions on the same database and criteria ranges, version-validated by range coordinates where possible and collision-checked by data/criteria fingerprints otherwise.

3. Canonicalize range and reference resolution.

   - Introduce one `ResolvedReference` model for cell, rectangular range, union, 3-D range, structured range, and external reference candidates.
   - Extend `EvalValue` with an internal reference variant, or introduce a parallel `EvalResult` that can carry either a value, lambda, omitted marker, or reference. Preserve the existing `CellValue` boundary by materializing or erroring only at final output.
   - Move duplicated range-bound extraction and full-row/full-column sentinel logic into shared helpers used by `RangeStore`, `MirrorContext`, lookup geometry, aggregate provenance, and reference operators.
   - Make `RangeStore::collect_static_ranges_pub`, `MirrorContext::get_range_values`, and dynamic reference functions agree on sheet dimension clamping, empty-sheet behavior, cross-sheet errors, row/column range expansion, and out-of-bounds ranges.
   - Rework `INDEX`, range operator, intersections, `SINGLE`, `ANCHORARRAY`, `ROW(S)`, `COLUMN(S)`, and `AREAS` to operate on references first and materialize only when the consuming function needs cell values.
   - Add structured-ref and 3-D reference tests that compare direct reference consumers with materialized aggregate consumers.

4. Refactor evaluator primitive dispatch around explicit contracts.

   - Create an eval-layer primitive table for functions that cannot be pure registry functions. Each entry should declare arity, argument evaluation mode, whether it accepts/returns references, laziness, omitted defaults, volatility, and array-lifting behavior.
   - Keep pure functions in `compute-functions`, but make fallback dispatch share the same arity/default validation contract instead of hand-checking only after argument evaluation.
   - Replace `expect("Lambda body must be ASTNode")` downcasts with a typed lambda body representation. If future lambda bodies can be non-AST, handle them explicitly rather than panicking.
   - Add scope guard helpers so LET/LAMBDA/higher-order functions cannot leak captured or parameter scopes on early return.
   - Audit every `unwrap()`/`expect()` in non-test eval code and either prove it is structurally unreachable with a narrow helper type or convert it to spreadsheet error/`ComputeError`.
   - Build a primitive matrix test that covers every evaluator primitive category: short-circuit logicals, aggregate provenance, references, lookup, higher-order lambdas, dynamic arrays, statistics, D-functions, pivots, table/structured refs, volatile functions, and external refs.

5. Prove and harden fast-path equivalence.

   - Add a test-only fast-path switch at the evaluator/session level, not by mutating production state. The same workbook fixture should be evaluated with all fast paths on and with individual fast paths disabled.
   - Cover dense aggregate vs materialized aggregate for numbers, booleans, blanks, errors, inline arrays, full-column refs, hidden rows, nested SUBTOTAL/AGGREGATE, and dynamic-array sources.
   - Cover borrowed conditional aggregates vs registry fallback for COUNTIF/SUMIF/AVERAGEIF/COUNTIFS/SUMIFS/AVERAGEIFS/MAXIFS/MINIFS, including exact criteria, wildcard criteria, operator criteria, array criteria, whole-column ranges, cross-sheet ranges, different slice lengths, and formula cells inside criteria/value ranges.
   - Cover lookup indexes vs materialized lookup for VLOOKUP/HLOOKUP/MATCH/XMATCH/XLOOKUP across exact, wildcard, approximate ascending/descending, duplicates, mixed types, nulls, whole-column refs, return ranges, and array lookup values.
   - Cover SUMPRODUCT fused paths vs standard multi-arg evaluation for text coercion, error laziness in IF branches, broadcasting, scalar/row/column arrays, boolean multiplication, and large ranges.
   - Cover sorted-cache statistical functions vs fallback for PERCENTILE/QUARTILE/PERCENTRANK/MEDIAN/SMALL/LARGE/RANK, including stale cache invalidation after cell edits.

6. Integrate vectorized shared-formula execution on the production path.

   - Decide the production owner: scheduler should detect eligible vectorized groups inside topological levels and pass them to `eval/coordination/vectorized`, because group execution must respect recalc ordering and cache invalidation.
   - Keep strict eligibility guards: same sheet, contiguous rows, no volatile functions, no external reads, no dynamic arrays, no implicit intersection, no references requiring current-cell-specific semantics outside the modeled row/column offsets, and no formulas needing side effects or formula metadata.
   - Execute groups through `DenseColumn`/`EvalMetadata` reads and produce the same `FormulaEvalOutcome` shape as scalar evaluation, then apply through the scheduler's normal result path.
   - Add a debug/eval gate that can sample or fully compare vectorized output against scalar evaluator output for the same group before enabling broad use.
   - Emit metrics for candidate groups, accepted groups, rejected reasons, cells vectorized, fallback cells, and scalar-equivalence failures.

7. Implement external reference evaluation.

   - Extend the evaluation context with an optional `ExternalEvaluationContext` and `ExternalValueProvider`.
   - Batch external cell/range/name reads per formula or per recalc epoch where possible, keyed by workbook/session/actor/principal/calc_epoch.
   - Map `ExternalValueResult` and `ExternalRangeResult` statuses to spreadsheet errors with safe diagnostics. Preserve freshness metadata for cache decisions but do not expose unauthorized source details.
   - Detect cross-workbook circular reads through provider status or an evaluation stack token. Return a deterministic circular external error instead of recursive evaluation.
   - Add tests for unavailable provider, denied provider, stale authorized value, broken target, ambiguous target, external name, external range, and mixed internal/external formulas.

8. Strengthen eval observability and diagnostics.

   - Add tracing spans around formula evaluation with fields for cell id, sheet, formula class, primitive name, fast path, cache tier, range size, operation count, deadline exceeded, and materialization count.
   - Use journal events for cache access and fast-path decisions only when the journal feature is enabled.
   - Add metrics snapshots for epoch cache, workbook cache, range store, vectorized groups, external reads, and evaluator limits. Keep these internal unless existing public metrics consumers require new fields.
   - Remove placeholder/staged comments only after the implementation is complete; replace them with precise contracts and remaining unsupported cases.

9. Build production-path contract fixtures.

   - Create compact workbook fixtures that run through `ComputeCore::init_from_snapshot`, normal cell mutation paths, full recalc, incremental recalc, cycle recovery, data-table prepass, schema validation, and SDK-style expression evaluation.
   - Assert values, errors, projection state, range cache invalidation, workbook cache hits/misses, external diagnostics, and recalc metrics where metrics are part of the contract.
   - Add large but bounded perf fixtures for repeated SUMIFS, repeated lookup, repeated statistics, large dynamic arrays, shared formulas, D-functions, and external read batching. These must run through production recalc entrypoints, not evaluator-only mocks.

## Tests and verification gates

Focused tests to add or update during implementation:

- Eval unit tests for `EvalSession` limits, deadline enforcement, scope guards, lambda body typing, reference-valued `EvalValue`, external ref mapping, and primitive metadata.
- Differential fast-path tests under `compute/core/src/eval/eval_tests` that compare scalar/materialized fallback with dense aggregate, borrowed aggregate, lookup index, sorted cache, SUMPRODUCT fusion, D-function cache, and vectorized group paths.
- `RangeStore` and `MirrorContext` tests proving identical range-key resolution and clamping for cell ranges, row ranges, column ranges, empty sheets, cross-sheet ranges, structured refs, and dynamic refs.
- Scheduler production tests that call `ComputeCore::init_from_snapshot`, cell mutation APIs, full recalc, incremental recalc, cycle recovery, projection stabilization, data-table prepass, and schema validation rather than direct evaluator mocks.
- External provider tests with a fake provider implementing the real `ExternalValueProvider` trait and exercising authorization/freshness/error statuses.
- Native concurrency tests that evaluate formulas on rayon workers across multiple recalc epochs and prove no stale thread-local or epoch-cache values survive.
- WASM-like tests with `--no-default-features` where feasible so non-native cache implementations preserve behavior.

Required final gates for an implementation touching this folder:

- `cargo test -p compute-core`
- `cargo clippy -p compute-core`
- `cargo test -p compute-core --no-default-features` if any cache/context/eval code is compiled for non-native targets
- `cargo test -p compute-functions` if pure function helpers, criteria logic, sorted/frequency/bitmask caches, or SUMIFS result caches change
- `cargo test -p compute-parser` if AST/reference representation or visitor behavior changes
- `cargo test -p compute-graph` if reference semantics alter dependency extraction or scheduling contracts

Opt-in gates when relevant:

- `cargo test -p compute-core --features perf-tests` for production-path performance fixtures
- `cargo test -p compute-core --features corpus-tests` when formula behavior changes can affect XLSX corpus fidelity
- `cargo test -p compute-core --features audit-tests` for broad aggregate/statistical matrix checks
- Native app or SDK smoke tests for `Worksheet.evaluate`, workbook recalc, and formula edit workflows if bridge-visible behavior changes

Performance verification must target production recalc and expression-evaluation paths. Do not optimize only evaluator unit-test helpers, benchmark-only harnesses, or mocks.

## Risks, edge cases, and non-goals

Risks:

- First-class references are a structural change. Without a complete primitive contract matrix, they can regress functions that currently expect materialized arrays.
- Thread-safe epoch caches can introduce contention. The design should prefer sharding or per-worker epoch partitions where shared cross-cell reuse does not justify a central lock.
- Per-formula deadlines may surface new `#CALC!` results in workbooks that previously completed late. The behavior must be deterministic and documented in tests.
- Fast-path equivalence tests can reveal existing divergence. Fix categories systematically rather than disabling fast paths one by one.
- External references introduce security and freshness concerns. Provider integration must fail closed and keep principal-specific diagnostics safe.
- Vectorized execution can silently break current-cell semantics if eligibility is too broad. It must be guarded by scalar equivalence tests and metrics before broad enablement.
- Data-table and cycle evaluation mutate/restore or iterate workbook state. Cache epoch resets must be exact or stale values will be hard to diagnose.

Edge cases to cover:

- LET/LAMBDA variables that look like cell references, mixed-case names, nested captured scopes, optional arguments, bare lambdas, and lambdas inside dynamic-array functions.
- Large MAP/BYROW/BYCOL/SCAN/REDUCE/MAKEARRAY formulas that hit deadlines or operation limits mid-loop.
- References consumed by `ROW`, `COLUMN`, `AREAS`, `FORMULATEXT`, `ISFORMULA`, `INDEX`, range operator, intersections, implicit intersection, structured refs, 3-D refs, and `ANCHORARRAY`.
- Full-column and full-row ranges with trailing virtual blanks, sparse columns, projection sources, and formulas inside the range.
- Hidden rows and nested SUBTOTAL/AGGREGATE behavior across dense and materialized paths.
- Approximate lookup on mixed types, duplicates, imperfectly sorted data, null lookup values, wildcard escapes, and whole-column ranges.
- SUMIFS/COUNTIFS with exact criteria, operator criteria, wildcard criteria, array criteria, dynamic criteria strings, and mismatched slice lengths.
- D-functions with repeated database ranges, repeated criteria ranges, duplicate headers, blank headers, field names vs indices, and criteria formulas.
- External references with stale values, denied access, broken links, loading links, ambiguous names, and circular cross-workbook dependencies.
- Native rayon workers across repeated recalcs, cycle iterations, and data-table override loops.

Non-goals:

- Do not create a second formula evaluator or a compatibility shim that preserves known evaluator bugs.
- Do not move pure function implementations from `compute-functions` into `eval` unless they require AST/reference/context access.
- Do not optimize test-only paths or direct evaluator mocks as the primary outcome.
- Do not broaden this plan into parser grammar work except where first-class reference semantics require AST/visitor support.
- Do not expose private/internal planning details from `mog-internal` into public `mog`.

## Parallelization notes and dependencies on other folders, if any

This work is highly parallelizable after the evaluator session and reference contracts are written down.

- Agent A: write the primitive contract matrix and fast-path equivalence tests for aggregates, lookups, statistics, SUMPRODUCT, D-functions, and higher-order functions.
- Agent B: implement `EvalSession`, per-formula deadline threading, operation ticking in tight loops, and scheduler call-site integration.
- Agent C: implement explicit `EpochCache` ownership, remove production thread-local subexpression access, wire old-value snapshots into workbook-cache incremental update/invalidation, and add cache stats.
- Agent D: implement first-class reference values and canonical range resolution across `eval`, `eval_bridge`, and `RangeStore`.
- Agent E: refactor evaluator primitive dispatch and LET/LAMBDA scope/body safety.
- Agent F: integrate vectorized shared-formula execution with scheduler level evaluation and scalar-equivalence metrics.
- Agent G: implement external provider evaluation and security/freshness tests.
- Agent H: run production-path verification, corpus/perf gates, and compare metrics before/after.

Dependencies:

- `EvalSession` should land before deadline, cache, external, and vectorized work so every later change has one context to thread through.
- First-class reference values should land before large primitive-dispatch cleanup, because many primitive contracts depend on reference-vs-value argument modes.
- Cache ownership work depends on scheduler session boundaries from `compute/core/src/scheduler`; coordinate with the scheduler improvement plan rather than duplicating recalc-session state.
- Vectorized execution depends on the shared `FormulaEvalOutcome`/result-application contract in the scheduler. Without that, vectorized cells risk bypassing spill, Null coercion, old-value capture, and cache invalidation.
- External reference support may require bridge/runtime/provider work outside `compute/core/src/eval`; keep the eval-side trait and error mapping stable before wiring app-facing providers.
