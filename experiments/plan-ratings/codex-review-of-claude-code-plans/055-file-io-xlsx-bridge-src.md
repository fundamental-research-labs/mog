Rating: 8/10

Summary judgment

This is a strong plan with unusually concrete evidence. It identifies a real architectural problem in `file-io/xlsx/bridge/src`: the package advertises hand-written parser result types that have drifted from the generated Rust bridge contract, while the worker harness and progress utilities are mostly tooling-facing rather than the app's production import path. The proposed direction, making `@mog/bridge-ts/generated/xlsx-types` canonical and reducing the bridge to an additive layer around generated types, is architecturally sound.

The rating is not higher because several implementation-critical contracts are deferred rather than specified. The largest missing pieces are the exact old-name to generated-name export mapping, a precise progress message contract after removing fabricated percentages, and a stronger explanation of how the typed WASM boundary will actually catch Rust signature drift instead of becoming another manually maintained interface.

Major strengths

- The plan is grounded in the real folder shape and accurately calls out the split between `types.ts`, worker orchestration, progress utilities, ambient WASM declaration, and small helper modules.
- The drift table is high-signal. The `sharedStrings`, `theme`, `metadata`, workbook property, iterative calculation, and timeline-cache differences match the generated `FullParseResult` shape and give implementers concrete acceptance criteria.
- The generated-types-are-canonical invariant is the right architectural target. It removes the possibility of parallel TypeScript and Rust contracts silently diverging again.
- The plan preserves important public worker protocol discriminators, error enum values, `CellRawValue`, `sideEffects: false`, and import-boundary constraints instead of treating the bridge as disposable.
- The verification section is much better than a generic "run tests" list: it asks for bidirectional compile-time type equality, option-forwarding tests, worker/tooling smoke coverage, import-boundary checks, and public-surface diff review.
- It honestly identifies that the app's production XLSX import path does not currently run through this worker, which prevents a misleading production-path claim.

Major gaps or risks

- The plan says to produce a name-by-name mapping in Step 1, but the plan itself does not include that mapping. For a 2,000+ line public type surface, this is the highest-risk part of the work. Many existing public names use semantic aliases or older names (`ParsedStyles`, `CellData`, `Table`, `ParsedTheme`, etc.) while the generated file uses `*Output`, summaries, tuples, or differently shaped structures. Without an explicit mapping table, implementers can accidentally drop names or create misleading aliases.
- The helper-removal guidance conflicts with the earlier "all exports keep resolving" invariant. The plan does say removal must be justified by repo-wide non-use, but it should make the decision path explicit: either preserve deprecated compatibility exports or intentionally make a package-export breaking change with a package-level justification. This matters because `./xlsx-parser/core` and `./xlsx-parser/data-validation` are in the package `exports` map even if current repo consumers are absent.
- The progress contract is underspecified. `ParseProgress.percentage` is currently required and `ParsePhase` does not include a generic `parsing` phase, but the plan suggests indeterminate progress and "no fabricated percentage" without saying whether `percentage` becomes optional, remains `0` until `complete`, gains an `estimated` flag, or adds a new phase. That needs a concrete wire-contract decision before implementation.
- The typed WASM boundary may not be as strong as claimed. A local `WasmXlsxModule` interface and cast improve local code clarity, but they will not automatically catch a Rust/WASM export signature change unless the interface is generated from the same source or checked against emitted WASM declarations. The plan should either require generated boundary types or soften the claim.
- The plan acknowledges `maxStringBytes` but does not identify the real WASM option contract. The adapter requirement is good, but an implementing plan should point to the Rust option struct or generated bridge option type so "forward or document dropped" is not left as ad hoc investigation.
- The production-path relevance is limited. This is acceptable because the plan is scoped to the bridge, but the plan should state which consumers get immediate value: declaration consumers, tooling tests, and worker callers, not the app import flow unless the separate worker-adoption decision is made.

Contract and verification assessment

The contract framing is the best part of the plan. It identifies parser-output shape as the core contract, distinguishes bridge-local DTOs from generated Rust output, and preserves the worker message discriminators and error vocabulary. The compile-time bidirectional assignability test between bridge-exported `FullParseResult` and generated `FullParseResult` is the right regression guard.

Verification is mostly complete, but it needs sharper package gates. The plan should name the actual package filters or scripts for `@mog/xlsx-parser`, `@mog/bridge-ts`, and `file-io/xlsx/tooling` rather than describing them generically. It should also require a declaration-surface diff or API snapshot for `index.ts` plus every exported subpath, because the risk is not only typecheck failure; it is accidentally changing public names while preserving compileability.

Concrete changes that would raise the rating

- Add an explicit export mapping appendix: every current `index.ts` and `types.ts` public name mapped to a generated symbol, a bridge-local symbol, a deprecated compatibility alias, or an intentional removal.
- Specify the exact post-change `ParseProgress` contract, including whether `percentage` is still required, whether new phases are added, and how existing type guards and cancellation tests should change.
- Replace the manual `WasmXlsxModule` claim with a verifiable boundary contract, preferably generated or type-asserted against a shared declaration for `@mog-sdk/wasm`.
- Decide the helper-module path up front: keep as deprecated compatibility exports, or remove the package subpaths with a documented breaking-change rationale and repo-wide non-use evidence.
- Name concrete verification commands and expected test locations for the bridge package, bridge-ts package, tooling cancellation tests, option adapter tests, and worker smoke fixture.
- Include acceptance criteria for option forwarding based on the actual Rust/WASM parse option struct, including the final disposition of `maxStringBytes`.
