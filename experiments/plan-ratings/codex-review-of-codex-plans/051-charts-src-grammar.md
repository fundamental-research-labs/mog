Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `charts/src/grammar`. It correctly treats the grammar compiler as a production lowering pipeline, not a local cleanup target, and it identifies real contract gaps: `trail` is public but not generated, unknown transforms currently pass through unchanged data, unit and layered compilation duplicate trace/guide/frame/clipping behavior, and legend reservation/tracing can diverge from rendered legend marks. The plan is unusually complete on invariants, downstream consumers, production verification, and parallel work decomposition.

The main reason it is not a 9 or 10 is that it is still more of a comprehensive architectural roadmap than an executable specification. Several of the most important decisions are deferred with phrases like "define", "should define", or "diagnostic or error". For this folder, those unresolved choices are not small details: they determine public compile behavior, snapshot stability, kernel error propagation, legend layout semantics, trace schema compatibility, and renderer contracts.

Major strengths

- The plan accurately maps the folder's role between `config-to-spec`, primitive rendering, OOXML fallback, kernel chart snapshots, and layout extraction.
- The motivating risks are concrete and verifiable against the source, especially silent mark fallback, unknown transform pass-through, duplicated unit/layer orchestration, and color-only legend rendering.
- The production-path invariants are well chosen: pure synchronous compile, no workbook access, stable `CompileResult`, pixel-internal layout with point conversion only in `layout-snapshot.ts`, mark-aware zero domains, shared layered scale domains, and TS/WASM transform equivalence.
- The proposed sequencing starts with exhaustive registries and diagnostics before geometry-changing refactors, which is the right risk order.
- Verification gates are mostly production-relevant: chart package tests/typecheck, full pipeline coverage, golden snapshots, kernel bridge tests, OOXML tests, and DOM/canvas smoke coverage when measurement or rendering behavior changes.
- Parallelization notes are credible because the slices have understandable ownership boundaries: pipeline, marks, scales, layout/guides, traces, transforms, and snapshots.

Major gaps or risks

- The scope is very large for one plan. It covers pipeline architecture, mark registry, diagnostics, scale metadata, layout solver, guide contracts, mark helper consolidation, trace schemas, layout snapshots, transform registry, public exports, primitive renderer implications, and kernel/export tests. That is coherent as a roadmap, but the implementation slices need explicit merge boundaries and success criteria that can land independently without destabilizing all charts at once.
- The diagnostic contract is under-specified. The plan says invalid specs should produce diagnostics or errors, but does not classify fatal versus non-fatal cases, define diagnostic codes, define whether diagnostics are stable public API, or specify how kernel stage errors and resolved snapshots should treat them.
- The `trail` requirement is correct, but the plan does not specify the actual primitive mark contract, renderer behavior, hit/layout extraction behavior, trace contribution, or fallback if variable-width path strokes are not yet supported.
- Multi-channel legend behavior is not decided. The plan says the guide contract should define ordering, combined entries, or multiple legends, but a plan at this level should pick a deterministic model and specify layout reservation, mark identity, trace identity, and snapshot expectations.
- The layout solver section names phases but does not define the solver's convergence criteria, reservation equations, tiny-chart behavior, overlay handling, or exact measured-versus-estimated metadata shape. This is a risk because layout changes will alter golden geometry.
- Trace schema migration needs more detail. Some trace families already have schema versions and Cartesian geometry currently does not; the plan should say exactly which trace additions are backward-compatible, which require schema bumps, and which kernel snapshot fixtures must intentionally change.
- The scale metadata contract is directionally right but broad. It should enumerate existing scale implementations and specify the exact adapter shape for each so mark generators, axes, traces, and layout cannot interpret the same scale differently.
- The plan lists many edge cases, but it does not convert them into a minimum fixture matrix by chart family/channel. Without that, implementers may still cherry-pick coverage.

Contract and verification assessment

The plan is strong on identifying contracts but weaker on pinning their final forms. It clearly preserves public exports, production purity, compile result consumers, layout pixel units, and chart/kernel boundaries. It also correctly calls out that changed layout from better text measurement is a contract change, not a harmless visual diff.

Verification is well aligned with the production path. The required `cd mog/charts && pnpm test` and `pnpm typecheck` gates are valid for this package, and the cross-folder gates are appropriate when `CompileResult`, traces, snapshots, OOXML fallback, or kernel compilation behavior changes. The plan should add explicit browser or canvas-rendered verification for `trail`, multi-channel legends, and any layout measurement change, because typecheck plus mark snapshots will not prove renderer-equivalent output.

The biggest contract weakness is compatibility management. Adding `diagnostics?: CompileDiagnostic[]` is optional at the TypeScript object level, but it is still a public output expansion and may affect snapshot hashes if copied downstream. The plan should specify whether diagnostics are excluded from current resolved snapshot hashing, included behind a schema bump, or persisted only in a later coordinated kernel/contracts slice.

Concrete changes that would raise the rating

- Split the plan into named implementation phases with explicit "may land alone" contracts, changed files, public API impact, and required verification for each phase.
- Define `CompileDiagnostic` fully: code namespace, severity, stable fields, fatal/non-fatal taxonomy, ordering, deduping, and snapshot persistence policy.
- Choose the multi-channel legend model now: combined legend versus separate legends, deterministic channel ordering, entry identity, layout reservation rules, and trace schema.
- Specify the `trail` primitive/rendering contract before requiring implementation, including path geometry, variable width semantics, clipping, layout extraction, and DOM/canvas renderer tests.
- Add a trace migration table listing every trace family, current `schemaVersion` status, proposed version behavior, downstream consumers, and expected snapshot changes.
- Turn the edge-case list into a minimum fixture matrix across unit/layered, cartesian/radial/statistical/surface, transform, legend, axis, blank, and non-finite scenarios.
- Define the layout solver's convergence and tiny-chart contracts numerically enough that two implementers would produce the same plot and guide rectangles.
