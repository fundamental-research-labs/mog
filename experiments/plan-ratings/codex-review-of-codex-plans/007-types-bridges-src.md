Rating: 8/10

Summary judgment

This is a strong, production-aware contract-hardening plan. It correctly treats `types/bridges/src` as a cross-layer contract owner rather than a grab bag of adapter types, and its evidence matches the current code: pivot placement payloads are redeclared outside the bridge package, schema options are duplicated in the kernel bridge, ink recognition is duplicated between `@mog/types-bridges` and the contracts facade, chart native raster request types are local to the Node exporter/Rust backend, and chart cache invalidation has implementation scope that is not represented in `IChartBridge`.

The main reason it is not higher is that it still leaves too many contract decisions as implementation-time choices. For a bridge contract plan, the target public API diff should be crisper: exact exported names, exact runtime export policy, exact async method return policy, exact chart raster schema ownership mechanics, and exact conformance fixture shape. The plan is directionally right and well sequenced, but some of the riskiest changes are specified as "decide whether", "if needed", or "or equivalent".

Major strengths

- The plan is grounded in production paths, not test-only cleanup. It links bridge declarations to real consumers in kernel, runtime SDK chart export, charts primitives, contracts declaration rollup, native chart rasterization, and public worksheet pivot APIs.
- It identifies systematic duplication categories rather than isolated instances: pivot placement, schema validation options, ink public facade drift, chart export schemas, cache scope, lifecycle, and conformance checks.
- The invariants are unusually good for this kind of plan. The synchronous `renderCached()` canvas paint boundary, Rust-backed pivot state, Rust recalc validation annotations, runtime-only drawing caches, and public contracts facade ownership are all called out explicitly.
- The proposed verification gates are broad enough for the blast radius: scoped package typechecks, kernel behavior tests by domain, Node SDK chart export tests, Rust chart-render tests/clippy, runtime inventory, declaration rollups, API snapshots, external fixtures, and final repo-wide typecheck.
- The parallelization notes use sensible ownership boundaries: core bridge type/export changes, pivot/schema consumers, chart export/native schema, contracts facade/runtime inventory, and conformance/API artifacts.

Major gaps or risks

- The plan is too large for one contract change unless it defines more explicit phase boundaries and acceptance criteria. Pivot placement, chart native serialization, ink runtime ownership, lifecycle normalization, and branded ID tightening are all public or cross-package changes with independent failure modes.
- The exact public export shape is underspecified. It says to audit root versus subpath exports and to rename or alias pivot placement types "if needed", but a contract plan should name the final exports and state whether old names remain, are aliases, or are intentionally removed.
- The branded `SheetId` tightening is directionally correct, but the plan does not enumerate affected public API boundaries or how unbranded `string` inputs get branded. Without that, implementers may either weaken the contract again or create noisy public churn.
- The chart raster schema objective is good, but "TypeScript owns types, Rust remains runtime validator" can still leave two manually mirrored schemas. The plan should require shared golden JSON fixtures and Rust/TypeScript tests against the same request examples, including currently mismatched details such as Rust accepting `"line"`/`"area"` path marks while `ChartMark['type']` does not.
- The ink runtime export policy needs sharper migration rules. Making `@mog/types-bridges` "effectively type-only" while it still has JS exports and currently exports `DEFAULT_RECOGNITION_THRESHOLDS` requires an explicit compatibility and inventory update path.
- The conformance fixture direction is valuable but vague. "Instantiate or reference" is not enough; the plan should specify type-only patterns that avoid fake runtime construction while still proving implementation assignability without casts or widened public payloads.
- Lifecycle normalization is rightly treated as a risk, but the plan could still invite abstraction creep. It should identify the exact bridge interfaces whose lifecycle signatures change and the exact ones that deliberately stay unchanged.

Contract and verification assessment

The contract assessment is mostly excellent: it distinguishes type identity ownership in `@mog/types-bridges` from public projection/runtime value ownership in `@mog-sdk/contracts`, and it understands that declaration rollups and runtime inventory are part of the public contract. It also correctly requires production implementations to compile against the bridge interfaces rather than letting duplicate local types drift.

The verification gates are appropriate for a high-blast-radius TypeScript contract plan, with one caveat: generated API snapshot update commands should be treated as artifact regeneration, not as the verifying gate itself. The plan should require the post-update check and a reviewed diff as separate exit criteria. For chart rasterization, verification should include shared TS/Rust fixture parity, not only independent Node and Rust tests.

Concrete changes that would raise the rating

- Add an explicit target API table listing every new, renamed, aliased, removed, and root-exported bridge symbol, including pivot placement names, chart serializable request names, lifecycle helpers, and the ink threshold constant.
- Split the implementation into phase gates with mergeable acceptance criteria: bridge export/type ownership first, contracts facade/runtime inventory second, pivot/schema consumer dedupe third, chart TS/Rust raster schema fourth, conformance fixtures and snapshots last.
- Specify the branded ID migration boundary: which bridge methods become `SheetId`, which public worksheet/API methods remain `string`, and where branding is performed.
- Define the chart raster V1 schema precisely, including supported mark variants, optional fields, rejected fields, paint projection rules, finite-number requirements, and whether Rust's `"line"`/`"area"` aliases are retained or removed.
- Require shared golden raster request fixtures consumed by both the Node exporter tests and `compute-chart-render` Rust tests.
- Define the conformance fixture pattern and file ownership explicitly, for example type-only assignability checks against concrete kernel bridge classes/factories plus public root/subpath import fixtures that ban casts.
- Replace remaining "decide whether" language with decisions, or mark those decisions as explicit pre-implementation blockers rather than leaving them to parallel workers.
