Rating: 8/10

Summary judgment

This is a strong plan for `compute-functions`: it is clearly grounded in the current production architecture, names the real metadata drift points, preserves the evaluator-vs-registry split, and gives the right verification shape for a crate that sits on the formula execution path. The descriptor-first direction is architecturally appropriate for this folder because the current contracts are scattered across `PureFunction`, `ExcelFunction`, `FunctionSignature`, `RegisteredFunction`, registry lookup behavior, helper SPI, parser flags, scheduler checks, and mirror dynamic-array detection.

The plan falls short of a 9 or 10 because it still leaves the core ownership and schema decisions open. It says to prefer a lower-level metadata crate if needed, or otherwise use generated drift tests, but that decision is the architectural crux. It also proposes a very broad catalog migration without a sufficiently crisp milestone contract for the first landing slice.

Major strengths

- The source read is accurate. The plan correctly identifies trait-method metadata, `_xlfn.` normalization, process-local registry IDs, `register_excel` being limited to conditional aggregates, omitted-argument substitution in evaluator fallback, unsupported evaluator-owned functions being intentionally absent, and duplicated volatile/dynamic metadata.
- It fits the production path. It explicitly includes `compute-core` evaluator fallback, scheduler spill/volatility behavior, parser identity flags, mirror root dynamic-array detection, and borrowed conditional aggregate fast paths instead of treating crate-local registry calls as the whole product behavior.
- It states important invariants that should not regress: no misleading pure stubs for AST/reference/current-cell functions, clean dependency direction, `#NAME!` for unknown/unsupported functions, ordinary `#VALUE!` arity errors, error-as-data exceptions for criteria and information predicates, and explicit array/spill semantics.
- The verification plan is unusually complete. It calls for crate-local descriptor/registry tests, cross-crate drift tests, production `ComputeCore` formula tests, clippy gates, parser gates when parser metadata changes, and optional corpus/audit/perf gates where relevant.
- The sequencing recognizes real risk areas: conditional aggregates first because they already use declarative signatures, then lookup/dynamic arrays, information predicates, text/regex, dates, financial defaults, and statistical functions.
- The parallelization section is useful and decomposes the work along plausible ownership boundaries rather than only by file list.

Major gaps or risks

- The plan does not decide the canonical metadata owner. A value-free `compute-function-catalog` crate vs generated drift tests is presented as a choice, but implementation should not start broad migration until this is resolved. Otherwise descriptor work may be built in the wrong crate boundary.
- `FunctionDescriptor` is described as a field list, not a contract. The plan should pin the initial Rust type shape, enum taxonomy, alias/prefix normalization rules, optional/default encoding, and how descriptor data is exposed under normal vs `__internal` features.
- The first implementation slice is too large. "Build a canonical descriptor model" plus registry conversion plus parity surface plus cross-crate metadata can sprawl. The plan needs a smaller acceptance milestone such as "descriptor model covers all currently registered functions with no dispatch behavior change, drift tests only, no function-body migration yet."
- The parity table source is underspecified. "Official Excel/Microsoft 365 function categories plus supported Google Sheets names" needs a precise source/version, curation policy, schema, generator/check command, and handling for names that appear in parser/evaluator but are not registry-callable.
- Dynamic-array semantics need sharper contracts. The plan correctly separates scalar/maybe/always array and spill-capable behavior, but it should explicitly define whether scheduler/mirror metadata keys off root-only spill eligibility, nested spill-producing functions, implicit range/operator spills, or registry return metadata.
- Omitted arguments remain tricky. The plan says descriptor defaults should be the only source, but it needs a migration rule for function bodies that currently rely on short argument vectors, direct registry calls that cannot carry explicit omitted markers, and evaluator primitives that handle `ASTNode::Omitted` themselves.
- Public API compatibility is not addressed enough. `FunctionRegistry`, `RegisteredFunction`, `PureFunction`, `ExcelFunction`, and `signature` are public exports. A descriptor migration can be internal-compatible, but the plan should state whether old trait methods remain, are deprecated, or are replaced in a breaking package change.
- Performance acceptance is implied but not quantified. The zero-allocation hot-path requirement is good, but descriptor lookup and registration changes should include a simple budget or benchmark/perf gate for registry dispatch and scalar array lifting if the implementation claims no runtime cost.

Contract and verification assessment

The contract coverage is high. The plan captures the right behavioral axes: function ownership, arity, aliases, dialect/status, prefix support, volatility, array lifting, spill capability, omitted defaults, error policy, evaluator-only functions, unsupported names, helper SPI, and dependency direction. It also correctly treats helper caches as production SPI with epoch/invalidation/equivalence contracts, not as incidental utilities.

The verification gates are mostly appropriate and production-relevant. `cargo test -p compute-functions` and `cargo clippy -p compute-functions` are necessary for local catalog work; `compute-core` and `compute-parser` gates are correctly tied to evaluator/scheduler/parser changes; production `ComputeCore` tests are required where metadata affects formula behavior. The missing pieces are a named descriptor schema fixture, a no-behavior-change baseline for the first registry migration, feature/API compile checks for public exports and `__internal`, and a precise drift-test source of truth before metadata starts moving.

Concrete changes that would raise the rating

- Decide the metadata ownership model in the plan: introduce `compute-function-catalog` now, or explicitly defer it and require generated drift tests as the temporary canonical guard.
- Add a concrete `FunctionDescriptor` sketch with exact enums for owner, status, dialect, argument role, error policy, array policy, return kind, volatility, prefix policy, and default values.
- Split implementation into gated milestones with acceptance criteria: descriptor schema only, registry binding with no behavior change, parity table coverage, cross-crate volatility/dynamic unification, omitted/default migration, then category-by-category argument policy migration.
- Specify the parity table schema and source/version, including how evaluator primitives, legacy aliases, Google Sheets names, Mog extensions, unsupported functions, and intentionally absent functions are represented.
- Add an explicit migration checklist for every function moved to descriptors: arity, defaults, scalar/native array policy, error policy, `returns_array`/spill metadata, aliases, prefix behavior, direct registry behavior, evaluator formula behavior, and category tests.
- Define public API compatibility expectations for `PureFunction`, `ExcelFunction`, `RegisteredFunction`, `FunctionRegistry`, and `signature` so implementers know whether to preserve, wrap, or break existing exports.
- Add one required production-path golden baseline before migration so descriptor conversion can prove no behavior changed except where the plan intentionally changes a contract.
