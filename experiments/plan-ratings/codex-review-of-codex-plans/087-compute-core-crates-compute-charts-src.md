Rating: 8/10

Summary judgment

This is a strong, evidence-based plan for `compute-charts`. It correctly treats the crate as a production bridge contract rather than a collection of local Rust helpers, and it identifies the major sources of semantic drift across `compute-charts`, `compute-core::bridge_pure::ChartBridge`, generated bridge types, `kernel/src/domain/charts/bridge/chart-compiler.ts`, and the standalone `@mog/charts` grammar transforms. The plan is especially good at naming concrete failure modes: unchecked `Vec<DataRow>` results, inverted regression field semantics, stringified group keys, expression evaluator drift, aggregate operation mismatch, histogram config loss, stacking duplication, and tests that do not exercise the real compiler/bridge path.

The main reason this is not a 9 or 10 is that it still reads more like a comprehensive remediation program than an executable implementation spec. It says "create one canonical contract" and lists many decisions that must be made, but it often does not make those decisions. The plan would be much more directly actionable if it included exact contract tables for value semantics, transform schemas, error/result DTOs, and fallback policy, plus a staged dependency graph showing which changes can land independently and which require coordinated bridge regeneration.

Major strengths

- Production-path focus is excellent. The plan starts from the real chart flow: `configToSpec` emits inline `ChartSpec` data and transforms, the kernel compiler invokes `chart_apply_transforms`, and the TypeScript grammar compiles the already-transformed rows. That is the right surface to fix.
- The source diagnosis is accurate. Current `chart_apply_transforms` returns `Vec<DataRow>`, while `ChartError` exists but is not used in the production transform path. The kernel fallback only triggers when WASM throws, so silent native semantic errors can be accepted as success.
- The plan correctly catches the regression contract mismatch. `charts/src/grammar/transforms/regression.ts` treats `regression` as the y/dependent field and `on` as the x/independent field, while Rust comments and dispatcher naming currently treat `regression` as `x_field` and `on` as `y_field`.
- It recognizes that this is a cross-language contract problem, not just a Rust cleanup. The plan includes Rust serde types, generated TypeScript bridge artifacts, chart grammar types, config-to-spec emitters, kernel compiler handling, and public wrapper APIs.
- The verification matrix is broad and relevant. It includes Rust bridge tests, generated DTO round trips, TypeScript grammar parity, kernel compiler fixtures, and production-path performance checks after correctness.
- It respects crate boundaries. The plan keeps workbook range resolution, renderer behavior, style/theme handling, and internal/private dependencies out of `compute-charts`.

Major gaps or risks

- The canonical contract is deferred instead of specified. For example, the plan says to decide the canonical aggregate operation set, but an implementer still has to choose whether `q1`, `q3`, `ci0`, `ci1`, `distinct`, `values`, and `average` belong in the public grammar, the generated bridge, or only Rust. That is the highest-leverage missing specification.
- The bridge error/result shape is too vague. "Typed `ChartTransformResult`/`Result` bridge shape or an error" is not enough for a bridge/codegen change. The plan should specify the exact serialized DTO, whether the generated TS method returns a union or throws, how `ChartError` maps through WASM/N-API/PyO3/API, and how diagnostics are represented in kernel chart compilation.
- Sequencing is broad. There are 20 steps spanning schema reconciliation, expression parsing, grouping, aggregates, binning, density, stacking, generated bridge changes, kernel compiler tests, parity fixtures, docs, and performance. The plan needs a dependency-ordered slice map so parallel agents can work without stepping on shared schema or bridge files.
- Expression parsing is underspecified. A "small checked expression AST" is the right direction, but the plan should define grammar, operator precedence, equality semantics, string escaping, bracket field syntax, bare identifier rules, unsupported syntax behavior, and whether TS `in [...]` filter syntax remains supported.
- Row value semantics are listed as invariants, but not resolved as a table. Sorting, grouping, `distinct`, truthiness, numeric extraction, missing vs `null`, object/array identity, and display string conversion need exact expected outputs, not just warnings that they must be explicit.
- The fallback policy needs sharper acceptance criteria. The plan says fallback should be reserved for deliberate native-unavailable cases, but it should enumerate cases: WASM module absent, transform variant unsupported by native, deserialization failure, invalid chart spec, runtime numeric-domain error, and bridge serialization failure.
- Performance guidance is directionally correct but lacks budgets. "Realistic chart-sized inline data" should become concrete row counts, transform chain shapes, and thresholds or at least regression-detection expectations.

Contract and verification assessment

The contract assessment is the plan's strongest part. It accurately frames `compute-charts` as a public native transform contract whose DTOs cross Rust, WASM, N-API, PyO3, compute API, generated TS bridge types, and kernel compiler code. It also correctly identifies that local Rust tests and mocked WASM tests do not prove production chart behavior.

The verification gates are mostly appropriate: `cargo test -p compute-charts`, `cargo clippy -p compute-charts`, adjacent `compute-core` and `compute-stats` gates when those crates change, bridge regeneration review, focused `@mog/charts` tests, focused kernel compiler tests, and `pnpm typecheck` for TypeScript changes. The plan also correctly says this planning worker must not run those gates.

What is missing is command-level specificity for the generated bridge workflow and TypeScript test packages. The plan should name the bridge generation command, the package-level test commands for `@mog/charts` and kernel chart compiler tests, and the expected shared fixture location/format. For the result/error contract change, it should also require tests that prove invalid native transforms surface as chart diagnostics instead of falling through as successful transformed data.

Concrete changes that would raise the rating

- Add a canonical transform schema table with exact Rust serde shape, TS grammar shape, generated bridge type, default values, optional fields, and unsupported/deprecated metadata for every transform.
- Add exact row value semantics tables for grouping identity, sorting order, aggregate numeric filtering, distinct identity, expression truthiness, string conversion, and missing/null behavior.
- Specify the bridge result/error DTO precisely, including serialized examples and how kernel diagnostics and fallback decisions consume it.
- Split the 20-step plan into phases with dependencies and parallel workstreams: contract/schema, checked execution/error bridge, expression AST, value helpers/grouping/aggregate, statistical transforms, stacking/binning, parity fixtures, production compiler tests, docs/performance.
- Choose the aggregate operation contract up front instead of leaving Rust/generated/TS grammar divergence to the implementer.
- Define the expression grammar formally enough that Rust and TypeScript fixtures can share expected behavior.
- Name exact verification commands for bridge regeneration, `@mog/charts` tests, kernel chart compiler tests, and TypeScript typechecking after schema changes.
- Add pass/fail acceptance criteria for the production compiler path: compiler path ID, transform removal only after success, diagnostic shape on invalid native input, no TS fallback for native semantic errors, and successful final mark generation.
