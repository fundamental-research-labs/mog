Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for turning `compute-table` into an auditable pure-engine contract. The plan correctly identifies real production-path problems in the current crate: mixed `Result`/`Option`/unchanged-value failure behavior, dynamic date filters that can panic without `now`, color/icon filters that can become pass-all without context, minimum-length bitmap composition, and structured-reference failures collapsed into empty vectors or `None`.

The rating is not higher because the plan is much closer to a multi-workstream architecture program than an executable implementation spec. It has the right direction and very good coverage, but it needs sharper API shapes, phase boundaries, compatibility sequencing, and acceptance criteria before multiple implementation agents could safely work in parallel without inventing contracts independently.

Major strengths

- It preserves the correct architecture: `compute-table` remains pure and stateless, while durable state, Yrs storage, UI, undo, import/export, and context gathering stay in production callers.
- It is clearly production-path oriented. The plan names `compute/core/src/bridge_pure.rs`, WASM/N-API bindings, `table-engine/src`, filter storage evaluation, structured-reference dependency extraction, slicers, XLSX, and UI workflows instead of optimizing tests or mock paths.
- The contract inventory objective is exactly the right first step for this folder. The crate has a broad public surface and many bridge-facing functions, so a public surface matrix would reduce drift and make the rest of the work decomposable.
- The identified invariants are concrete and important: table ID/name separation, inclusive `TableRange`, exact bitmap row counts, injected calendar date, resolved color/icon context, Excel advanced-filter DNF shape, structured-reference current-row semantics, stable sort permutations, and deterministic style precedence.
- The verification section is broad enough to catch cross-boundary regressions: Rust crate gates, compute-core integration tests, bridge/binding checks, TypeScript wrapper parity, serde roundtrips, contract matrices, and real UI exercises.
- The parallelization notes are useful and mostly align with natural subsystem boundaries: table operations, filters, structured refs, timeline/slicers, styles, compute-core integration, and TypeScript/UI parity.

Major gaps or risks

- The concrete implementation plan is too large and insufficiently phased. Twenty broad steps cover error contracts, filters, styles, dates, structured refs, range identity, bridge descriptors, compute-core services, TypeScript wrappers, XLSX, and UI. The plan should define explicit phases with exit criteria, otherwise agents can easily collide across public API, bridge, and caller changes.
- The new typed contracts are named but not specified. Types such as `FilterEvaluationContext`, `FilterEvaluationError`, `StructuredRefResolution`, `BitmapValidationError`, and `RangeIdentityResolution` need exact variants, serde wire shapes, bridge behavior, and TypeScript declarations before implementation begins.
- Bridge compatibility is under-specified. Moving from string errors or success-shaped sentinels to typed results will affect generated WASM/N-API descriptors and `table-engine` callers. The plan should say whether bridge methods return tagged result enums, throw bridge errors, or expose parallel strict APIs during migration.
- The plan says to create a unified value semantics module or fixture, but the crate already has `compare.rs` and `EDGE_VALUE_SEMANTICS.md`. The right work is to reconcile and make those authoritative, not risk creating a second source of truth. The existing edge document also appears stale in places relative to current `FiniteF64` semantics, so freshness should be part of the contract.
- Color and icon filter ownership is directionally correct but still incomplete. The plan says compute-core gathers resolved display color/icon context and compute-table owns predicates, but it does not define the exact resolved input model, theme/conditional-format provenance, or the user-visible behavior while production callers are being upgraded away from pass-all fallbacks.
- Advanced Filter formula criteria remain a fork in the road. The plan allows either a formula-evaluation hook or a typed unsupported result, but does not choose a contract or specify how copy-to/in-place consumers surface unsupported criteria.
- Structured-reference failure outcomes are well named, but the downstream formula/dependency behavior is still vague. The plan should define when unresolved refs become formula errors, conservative dependency invalidation, empty dependency sets, or user-visible diagnostics.
- Verification gates are comprehensive but not sequenced. Running every Rust, bridge, TypeScript, UI, and XLSX gate for every slice is unrealistic; each phase needs the exact required gates and the broader regression gate that closes the whole program.

Contract and verification assessment

The contract assessment is the plan's best part. It identifies real ambiguity in invalid-input handling, filter context, bitmap length, structured-reference failure states, date serials, table identity, and TypeScript/Rust parity. It also correctly treats the Rust crate as canonical while requiring production callers to gather the context that a pure engine cannot own.

The verification plan is strong as a final target, but it needs a smaller set of mandatory gates per implementation phase. At minimum, the plan should define a freshness test for the public surface matrix, serde roundtrip tests for new public result/context types, descriptor parity tests with explicit skip reasons, focused `cargo test -p compute-table` filters for each subsystem, and compute-core integration tests whenever production callers change. UI gates should be tied to the slices that actually modify user-facing workflows.

Concrete changes that would raise the rating

- Add a phase plan with deliverables: inventory only, no-behavior contract tests, typed API introduction, production caller migration, bridge/TypeScript parity, then XLSX/UI closure.
- Define the exact schema of the contract inventory artifact, including one sample row, the generation/check command, and the CI freshness gate.
- Specify representative new API contracts in detail, for example strict bitmap composition, dynamic filter evaluation, structured-ref resolution, and table column removal, including Rust type, serde shape, bridge shape, and TypeScript wrapper behavior.
- Replace the value-semantics objective with an explicit reconciliation of `compare.rs`, `EDGE_VALUE_SEMANTICS.md`, filter dropdowns, slicer cache, sort, and advanced filter equality.
- Choose the migration strategy for bridge-facing breaking changes: tagged result enums, versioned strict methods, or coordinated descriptor regeneration with immediate caller updates.
- Define the resolved color/icon context structs and state exactly which production layer resolves table styles, cell formats, themes, and conditional-format icon outputs.
- Choose the Advanced Filter formula-criteria contract instead of leaving two options open.
- Add per-phase verification gates and final acceptance criteria so parallel agents can implement independently and still compose into one verified production path.
