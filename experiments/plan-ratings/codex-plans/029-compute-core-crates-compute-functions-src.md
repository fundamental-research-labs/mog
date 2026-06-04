# 029 - Compute Core Compute Functions Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-functions/src`

Scope for this plan is the public `compute-functions` crate's source tree: the Excel-compatible function registry, pure and signature-aware function traits, argument signature metadata, array lifting, function-category implementations, shared coercion/criteria/date/math helpers, evaluation-cache SPI exported under the `__internal` feature, and the crate-local tests that prove function behavior.

Adjacent production dependencies that must be considered:

- `compute/core/src/eval/*`, which owns formula evaluation primitives and delegates ordinary value functions to the global `FunctionRegistry`.
- `compute/core/src/scheduler/*`, which uses registry metadata to detect dynamic-array functions and uses `compute_functions::helpers::VOLATILE_FUNCTIONS` for volatility and cache invalidation behavior.
- `compute/core/src/eval_bridge/mirror_context.rs`, which has a separate root dynamic-array function list used by mirror-side metadata.
- `compute/core/crates/compute-parser/src/identity_transform/flags.rs`, which intentionally duplicates volatile and dynamic-array names because `compute-parser` cannot depend on `compute-functions`.
- `compute/core/crates/types/value-types`, `cell-types`, and `compute-formats`, which define the values, errors, arrays, sheets, and formatting behavior consumed by function bodies.

This is a public Mog source folder. Implementation work belongs in `mog`; this plan remains internal in `mog-internal`.

## Current role of this folder in Mog

`compute-functions` is the production catalog and implementation home for the spreadsheet functions that can execute from pre-evaluated `CellValue` arguments. `lib.rs` describes the crate as a `512+` Excel-compatible function library, and `compute/core/src/eval/engine/eval_primitives.rs` documents the split between roughly 41 evaluator primitives that need AST/evaluator access and roughly 435 registry-dispatched functions that fall through to `FunctionRegistry`.

The folder has these main responsibilities:

- `registry.rs` builds one `FunctionRegistry` from domain modules, normalizes `_xlfn.` and `_xlfn._xlws.` prefixes, maps names to stable in-process IDs, validates arity, and dispatches by `RegisteredFunction`.
- `trait_def.rs`, `excel_function.rs`, `registered_function.rs`, and `signature.rs` define the function ABI. There are two implementation styles: `PureFunction` for ordinary pre-evaluated calls and `ExcelFunction` for functions with declarative `FunctionSignature` argument roles.
- `array_lift.rs` provides production scalar-array broadcasting for functions that mark arguments as scalar, while array-returning functions opt out through `returns_array()`.
- Domain modules own function categories: math, text, logical, lookup/reference/dynamic arrays, statistical, datetime, financial, engineering, database, information, and web/media.
- `helpers/*` owns shared coercion, criteria parsing, date serial conversion, hashing, power handling, conditional aggregation logic, and cache/index structures used both by function implementations and by compute-core fast paths under the `__internal` SPI.
- The crate has broad local test coverage under category-local `tests` modules plus registry tests for lookup, arity, metadata, array lifting, and role-based error propagation.

Important current observations from inspection:

- The folder is large: `find`/`wc` reported 301 Rust files and about 58,909 lines under `src`, including tests.
- Function metadata is mostly implicit in trait methods on each implementation: name, min/max arity, defaults, volatility, dynamic-array return, and scalar-argument lifting live beside code instead of in a complete catalog.
- Only the conditional aggregation family in `statistical/counting.rs` currently uses `ExcelFunction` and `FunctionSignature` through `register_excel`; the rest of the catalog remains `PureFunction` plus ad hoc `is_scalar_arg`, `returns_array`, `default_for_arg`, and per-body error checks.
- Metadata is duplicated outside this crate. Volatile names are duplicated in `compute-parser`; dynamic-array names appear in parser flags, scheduler inline lists, mirror root detection, and registry `returns_array()` implementations.
- The evaluator fallback path looks up registry functions, substitutes omitted-argument defaults when the AST argument is `Omitted`, re-checks arity, and calls `RegisteredFunction::call`. Direct `FunctionRegistry::call` validates arity but cannot represent AST omitted arguments.
- Unsupported evaluator-owned functions are deliberately not registered as stubs; tests assert `FORMULATEXT` and `FORECAST.ETS*` names are not advertised by the registry.

## Improvement objectives

1. Make the function catalog a complete, auditable production contract rather than metadata scattered across hundreds of function impls.
2. Preserve the clean split between evaluator primitives and pre-evaluated registry functions while making both visible in one parity surface.
3. Systematically migrate argument semantics from ad hoc function bodies into declarative descriptors: arity, optional/default behavior, error policy, scalar/range/criteria/reference roles, array lifting, return kind, volatility, and dialect support.
4. Eliminate metadata drift across `compute-functions`, `compute-core`, `compute-parser`, scheduler dynamic-array detection, mirror root detection, and helper volatility lists without creating dependency cycles.
5. Turn Excel/Sheets parity into checked data: implemented, evaluator-owned, unsupported, intentionally omitted, aliased, legacy, and dialect-specific names should be visible and tested.
6. Strengthen array and error semantics so scalar lifting, native array functions, criteria errors, information predicates, range consumers, and dynamic-array spill detection are all descriptor-driven.
7. Keep performance helpers production-path safe: cache/index SPI exposed to `compute-core` must remain versioned, semantically equivalent to fallback paths, and separated from public function APIs.
8. Reduce boilerplate and category-local drift with descriptor-first helpers and tests, not by hiding behavior behind compatibility shims.

## Production-path contracts and invariants to preserve or strengthen

- `FunctionRegistry` remains the single production registry for pre-evaluated function dispatch. `compute-core` should not fork a private registry or bypass registry metadata for registry-owned functions.
- Functions that require AST access, laziness, current-cell metadata, reference identity, formula text, row/column geometry, external providers, or evaluator caches remain evaluator primitives in `compute-core`; they must not be registered as misleading pure stubs.
- Public dependency direction stays clean. `compute-functions` may expose low-level metadata and helper SPI; it must not depend on `compute-core`, `compute-parser`, or `mog-internal`.
- If a shared catalog crate is introduced, it must be lower-level than `compute-functions`, value-free where possible, and usable by `compute-parser` without pulling in function implementations.
- Registry lookup remains case-insensitive and continues to normalize `_xlfn.` and `_xlfn._xlws.` prefixes for functions whose descriptors allow those prefixes.
- Registry IDs may remain process-local implementation IDs unless a stable serialized function ID contract is explicitly introduced and tested. Do not accidentally make registration order a storage or wire invariant.
- Wrong arity returns `#VALUE!`; unknown functions return `#NAME!`; unsupported functions are either evaluator-owned or absent from the registry with an explicit catalog status.
- Error propagation must match argument semantics. Scalar and range arguments generally propagate errors; criteria and information-predicate arguments can treat errors as data; native-array and reference-aware functions own their own policy.
- Array behavior must be explicit per function and per argument: scalar lifting, zipped broadcasting, native array handling, possible array return, guaranteed array return, and dynamic-array spill eligibility are separate concepts.
- Omitted-argument defaults must be consistent between evaluator fallback, direct registry calls, and function bodies. Defaults should not be silently duplicated in a descriptor and in an implementation without a test tying them together.
- Volatile metadata must be one contract used by dependency extraction, scheduler invalidation, lambda/subexpression cacheability, and function registry metadata.
- Helpers exported under `__internal` remain SPI for production compute-core code, not a public catch-all. Any cache helper used by scheduler/evaluator must define epoch, invalidation, and equivalence contracts.
- Numeric, text, date, financial, statistical, and engineering functions must preserve Excel-compatible error types and edge behavior, including `#NUM!`, `#VALUE!`, `#DIV/0!`, `#N/A`, IEEE finite checks, 1900-date-system semantics, and legacy aliases.

## Concrete implementation plan

1. Build a canonical function descriptor model.

   - Define a `FunctionDescriptor` contract with canonical name, aliases, category, dialect (`Excel`, `Excel365`, `LegacyExcel`, `GoogleSheets`, `MogExtension`), implementation owner (`Registry`, `EvaluatorPrimitive`, `Unsupported`, `Deferred`), arity, optional argument defaults, argument roles, error policy, array policy, return kind, volatility, prefix support, and compatibility notes.
   - Extend the current `FunctionSignature` model rather than replacing it narrowly. Add roles/policies needed by the full catalog: `Reference`, `Lazy`, `ValuePreserving`, `PredicateInput`, `OmittedOnly`, `Criteria`, `Range`, `Scalar`, and `ArrayNative` or equivalent smaller types.
   - Make the descriptor represent both pure registry functions and evaluator primitives. Evaluator-owned entries should be visible to parity checks but not callable through `FunctionRegistry::call`.
   - Keep descriptors `&'static`/zero-allocation on the hot path. Runtime function calls should not allocate catalog metadata.

2. Resolve the cross-crate metadata ownership problem.

   - Prefer a small lower-level metadata crate, for example `compute-function-catalog`, if `compute-parser` must consume dynamic/volatile lists without depending on function implementations.
   - Move volatile and dynamic-array names into that value-free metadata layer, then update `compute-functions`, `compute-parser`, scheduler detection, and mirror root detection to consume the same source or generated checked snapshots.
   - If a new crate is deferred, add a generated parity test that compares the duplicated parser/scheduler/mirror lists against `compute-functions` descriptors and fails loudly on drift.
   - Document which names are duplicated for dependency reasons and which source is canonical.

3. Make registry construction descriptor-first.

   - Change `RegisteredFunction` to carry `&'static FunctionDescriptor` alongside the implementation. Arity, volatility, defaults, return kind, scalar-lift policy, and prefix support should come from the descriptor.
   - Replace manual `register(Box::new(...))` calls with descriptor-aware registration helpers or macros that bind a descriptor to an implementation type.
   - Add registry startup assertions in tests: no duplicate canonical names or aliases, every registry-owned descriptor has an implementation, every implementation has exactly one descriptor, every evaluator-owned descriptor is absent from the pure registry, and unsupported descriptors return `#NAME!` through registry calls.
   - Preserve current lookup behavior for `_xlfn.` and `_xlfn._xlws.` prefixes, but make prefix acceptance data-driven so unsupported or dialect-incompatible aliases are not accidentally normalized.

4. Systematically migrate argument semantics.

   - Convert the conditional aggregation `ExcelFunction` signatures into the new descriptor model first, because they already encode range/criteria roles and prove the concept.
   - Migrate high-risk categories next: lookup/dynamic arrays, text extraction/search/regex, statistical distributions, financial defaults, date/week/yearfrac defaults, and information predicates.
   - Replace per-function `is_scalar_arg` overrides with descriptor argument policies. Keep native-array functions explicit so `LARGE`, `MEDIAN`, `STDEV`, `FILTER`, `SORT`, `UNIQUE`, `SEQUENCE`, `TEXTSPLIT`, `SPLIT`, `REGEXEXTRACT`, `LINEST`, `LOGEST`, `TREND`, `GROWTH`, matrix functions, and stack/manipulation functions do not get scalar-lifted accidentally.
   - Add a dispatcher-level error-policy pass for descriptor-covered functions. Function bodies can retain defense-in-depth checks, but the framework should own ordinary propagation so one missed `check_error` cannot create category drift.
   - Separate error-as-data behavior for criteria and information predicates from ordinary scalar propagation.

5. Normalize omitted/default argument handling.

   - Make descriptor defaults the only source for defaultable omitted arguments.
   - Add a registry API that can accept an argument vector with explicit omitted markers, or a small `PreparedArgs` layer used by evaluator fallback before calling the implementation.
   - Audit current `default_for_arg` implementers: `LEFT`, `RIGHT`, `WEEKDAY`, `WEEKNUM`, `LOG`, `XLOOKUP`, `SORT`, `SORTBY`, `SORTN`, `ISBETWEEN`, `PV`, depreciation functions, percentile functions, beta distribution functions, and lookup manipulation defaults.
   - Add tests that compare descriptor defaults, evaluator omitted-argument behavior, direct registry behavior where applicable, and function body behavior for every defaultable function.

6. Make dynamic-array and spill metadata complete.

   - Distinguish `ReturnKind::AlwaysArray`, `ReturnKind::MaybeArray`, and `ReturnKind::Scalar`. `XLOOKUP` can return a scalar or a multi-cell return row/column; dynamic-array detection still needs to treat it as spill-capable.
   - Encode spill-capable registry functions in descriptors and update scheduler/mirror detection to use that metadata.
   - Keep evaluator inline array functions (`ARRAYFORMULA`, `MAP`, `MAKEARRAY`, `BYROW`, `BYCOL`, `SCAN`, `ANCHORARRAY`) in the shared catalog as evaluator-owned dynamic-array functions.
   - Add a dynamic-array contract test that checks parser flags, scheduler `ast_contains_array_function`, mirror `root_ast_produces_dynamic_array`, registry `returns_array` or successor metadata, and actual spill behavior through `ComputeCore` for every spill-capable function.

7. Build the parity matrix and coverage gates.

   - Add a checked-in machine-readable parity table generated or curated from official Excel/Microsoft 365 function categories plus explicitly supported Google Sheets names already present in the source (`SPLIT`, `REGEX*`, `TO_*`, etc.).
   - For every name, record status: implemented in registry, implemented as evaluator primitive, alias/legacy equivalent, intentionally unsupported, not yet implemented, or not applicable to Mog.
   - Tie category module docs to the table. Module header comments should not be the only source of truth for what is implemented.
   - Add tests that fail if a registered function is missing from the parity table, if a parity-table registry function is missing from `FunctionRegistry`, if an evaluator primitive is accidentally registered as a stub, or if an unsupported function starts returning anything other than `#NAME!` through the registry.

8. Strengthen helper SPI boundaries and cache contracts.

   - Split helper documentation into function-body utilities versus compute-core SPI. Keep `coercion`, `criteria`, `conditional_aggregate`, `date_serial`, `hashing`, and `power` clearly separate from `bitmask_cache`, `column_index`, `frequency_cache`, `sorted_cache`, and `sumifs_result_cache`.
   - For each SPI cache, document epoch ownership, clear/invalidation requirements, thread-local behavior, key equality/fingerprinting, and fallback equivalence.
   - Add tests that compare helper results used by compute-core borrowed/fast paths against the standard registry path for COUNTIF/SUMIF/AVERAGEIF/COUNTIFS/SUMIFS/AVERAGEIFS/MAXIFS/MINIFS, sorted statistical functions, and lookup helpers.
   - Keep performance improvements on production helpers used by evaluator/scheduler paths, not on isolated benchmark-only code.

9. Reduce boilerplate without hiding semantics.

   - Introduce descriptor-aware macros or small builder helpers for common families: unary numeric, binary numeric, variadic numeric aggregate, scalar text, predicate, distribution, financial defaulted function, and array-native function.
   - Use the helpers to make metadata and implementation sit together, but do not create macros that obscure category-specific Excel behavior.
   - Continue splitting oversized files by category ownership when line counts obscure contracts. Current large files such as `lookup/helpers.rs`, `financial/time_value.rs`, `financial/depreciation.rs`, `math/rounding.rs`, `text/regex.rs`, and `statistical/counting.rs` should be split only where ownership boundaries become clearer.

10. Add production-path integration tests.

   - Keep crate-local tests for pure function correctness, but add compute-core production tests for formula edit/evaluation paths where metadata affects scheduling, omitted arguments, volatility, array spills, and evaluator-vs-registry ownership.
   - Use `ComputeCore::init_from_snapshot`, normal cell mutation APIs, formula parsing, and recalc paths for integration tests. Do not set internal state directly to fake a passing dynamic-array or volatility condition.
   - Cover direct registry calls only for the registry contract itself; production formula behavior must be verified through evaluator/scheduler paths.

## Tests and verification gates

Focused tests to add or update during implementation:

- `compute-functions` descriptor tests: uniqueness, aliases, prefix normalization, status coverage, category coverage, descriptor-to-implementation binding, and unsupported/evaluator-owned absence from registry.
- Registry behavior tests for arity, omitted/default handling, error policy, scalar lifting, array-native opt-out, dynamic-array return metadata, volatility metadata, and `_xlfn.`/`_xlws` lookup normalization.
- Category parity tests for math, text, lookup/dynamic arrays, statistical, datetime, financial, engineering, database, information, logical, and web/media functions.
- Golden conformance fixtures for known Excel edge cases: numeric domain errors, text Unicode/byte/CJK behavior, date serial boundaries including the 1900 leap-year compatibility behavior, financial day-count bases, statistical distribution tails, lookup approximate/duplicate cases, criteria wildcard/operator matching, and regex unsupported-feature handling.
- Cross-crate metadata drift tests comparing the canonical catalog against parser volatile/dynamic flags, scheduler inline dynamic-array detection, mirror root dynamic-array detection, and helper volatile lists.
- Production-path tests in `compute-core` for volatile recalc, dynamic-array spill registration, omitted argument defaults, evaluator-owned functions that must not be registry stubs, borrowed conditional aggregate equivalence, and registry fallback behavior.

Required final gates for an implementation centered on this folder:

- `cargo test -p compute-functions`
- `cargo clippy -p compute-functions`
- `cargo test -p compute-core` for any change that affects evaluator fallback, scheduler metadata, dynamic arrays, volatility, helper SPI, or production formula behavior
- `cargo clippy -p compute-core` when compute-core integration changes
- `cargo test -p compute-parser` and `cargo clippy -p compute-parser` if parser flags or a shared metadata crate affect parser behavior

Opt-in gates when relevant:

- `cargo test -p compute-core --features corpus-tests` when function results, function availability, or XLSX compatibility can affect workbook corpus fidelity
- `cargo test -p compute-core --features audit-tests` for broad function parity/audit matrices
- `cargo test -p compute-core --features perf-tests` for helper/cache changes that claim performance improvements on production recalc paths
- WASM/N-API smoke tests if metadata or registry APIs are exposed through runtime bindings

This planning run did not execute those gates because the queue item explicitly forbids cargo/rustc/build/test/verification commands.

## Risks, edge cases, and non-goals

Risks:

- A shared metadata crate can improve correctness but can also create dependency-direction mistakes if it pulls in `value-types`, `compute-functions`, or `compute-core`. Keep it value-free unless a dependency is proven necessary.
- Descriptor migration can accidentally change behavior if framework-level error propagation runs before functions that intentionally treat errors as data.
- Dynamic-array metadata is subtle. Some functions always return arrays, some can return arrays depending on inputs, and evaluator primitives are outside the registry. Scheduler and mirror logic need the spill-capable contract, not merely `returns_array()`.
- Omitted-argument handling can regress formulas if direct registry calls, evaluator `ASTNode::Omitted`, and function body defaults are not reconciled together.
- Financial, statistical, date, and engineering functions have Excel-specific numerical quirks. Converting boilerplate to macros must not erase per-function edge behavior.
- Helper cache SPI changes can produce stale values if epoch/invalidation rules are incomplete across full recalc, incremental recalc, cycles, data-table prepasses, and rayon workers.
- A parity table can become noise if unsupported names are not classified with precise reasons and tests.

Edge cases to cover:

- Criteria functions where `#N/A` or other errors are valid criteria values rather than propagated errors.
- Information predicates such as `ISERROR`, `ISNA`, `ISBLANK`, `ISNUMBER`, `ISTEXT`, `ISREF`, `TYPE`, `N`, and `ERROR.TYPE`, where errors and references can be inspected as data.
- Functions with optional defaults and omitted placeholders: `LEFT`, `RIGHT`, `LOG`, `WEEKDAY`, `WEEKNUM`, `PV`, `XLOOKUP`, sorting functions, depreciation functions, percentile/beta functions, and any future defaulted function.
- Scalar lifting across one-dimensional arrays, two-dimensional arrays, row/column broadcasting, mismatched dimensions, multiple array arguments, and error elements inside arrays.
- Array-native functions that must consume full ranges: `FILTER`, `SORT`, `SORTBY`, `SORTN`, `UNIQUE`, `SEQUENCE`, `TAKE`, `DROP`, `CHOOSECOLS`, `CHOOSEROWS`, `WRAPROWS`, `WRAPCOLS`, `HSTACK`, `VSTACK`, matrix functions, `LINEST`, `LOGEST`, `TREND`, `GROWTH`, `REGEXEXTRACT`, `TEXTSPLIT`, and `SPLIT`.
- Dynamic-array spill-capable lookup behavior, especially `XLOOKUP` returning a multi-cell row/column from a return array.
- Volatile functions across parser flags, scheduler dependency extraction, cacheability checks, and registry metadata: `RAND`, `RANDBETWEEN`, `RANDARRAY`, `NOW`, `TODAY`, `OFFSET`, and `INDIRECT`.
- Legacy aliases and dialect additions: statistical legacy names, `_xlfn.` prefixes, Google Sheets `TO_*` names, regex names, and functions that exist in Excel but are evaluator-owned in Mog.
- Database functions and conditional aggregates with repeated ranges, criteria arrays, wildcard/operator criteria, exact-match caches, mismatched dimensions, and error-containing ranges.

Non-goals:

- Do not create registry stubs for evaluator-owned functions just to make a parity table look complete.
- Do not add compatibility shims that preserve known wrong behavior behind flags.
- Do not make `compute-parser` depend on `compute-functions`.
- Do not move AST/reference/current-cell functions into `compute-functions`; keep them in the evaluator unless they can truly operate on pre-evaluated `CellValue` arguments.
- Do not optimize benchmark-only or test-only paths as the primary outcome.
- Do not expose private planning material or internal corpus details from `mog-internal` into public `mog`.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the descriptor schema and ownership boundary are agreed.

- Agent A: design the descriptor schema, status taxonomy, argument/error/array policy model, and the migration path from `PureFunction`/`ExcelFunction`.
- Agent B: build the parity table and tests that compare descriptors against registry implementations, evaluator primitives, unsupported names, and category modules.
- Agent C: migrate registry construction to descriptor-aware registration and add registry startup/metadata contract tests.
- Agent D: migrate high-risk function families to declarative argument policies: conditional aggregates, dynamic arrays, lookup, information predicates, text/regex, date defaults, financial defaults, and statistical distributions.
- Agent E: solve cross-crate dynamic/volatile metadata drift, either by introducing a lower-level metadata crate or by adding generated drift tests for parser/scheduler/mirror duplicated lists.
- Agent F: harden helper SPI contracts and add production-path equivalence tests for borrowed aggregate, sorted/frequency/bitmask/cache helpers, and registry fallback.
- Agent G: run final verification across `compute-functions`, `compute-core`, and `compute-parser`, then triage any corpus/audit differences as function-category work rather than isolated one-off fixes.

Dependencies:

- Descriptor schema and metadata ownership should land before broad function migration.
- Cross-crate volatile/dynamic metadata should be resolved before changing scheduler or parser detection behavior.
- Registry descriptor binding can land independently of the full parity table if tests assert no behavioral change for existing functions.
- Compute-core integration tests are required before marking dynamic-array, volatility, omitted-default, or evaluator-owned-function metadata work complete.
