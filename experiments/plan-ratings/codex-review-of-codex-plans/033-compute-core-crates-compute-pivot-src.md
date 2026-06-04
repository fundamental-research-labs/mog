Rating: 8/10

Summary judgment

This is a strong, source-aware plan for the pivot engine. It correctly treats `compute-pivot` as a pure Rust production engine, not a UI helper, and it identifies real contract gaps in the current source: `CountUnique` is mapped to relational `Count`, aggregate/date/top-bottom mapping has non-exhaustive fallbacks, `PivotTableResult.measure_descriptors` and `value_records` are emitted empty, `ResolvedValuePlacement` lacks stable placement/source identity, collapsed column remapping can pad visible parents with `Null`, and Show Values As still infers measure width from grand-total shape.

The rating is not higher because the plan is closer to a complete pivot contract rewrite than an executable first slice. It names the right abstractions and consumers, but it does not freeze enough concrete schemas, acceptance examples, migration rules, or merge gates before sending parallel agents across `compute-pivot`, `compute-relational`, DTO crates, compute-core materialization, bridges, and UI consumers.

Major strengths

- The diagnosis is grounded in the actual production path: `compute_resolved()` maps to `compute_relational`, presenter projection builds the public result, and Show Values As mutates the projected result.
- The plan is architecturally aligned. It keeps `compute-pivot` dependency-clean, rejects a TypeScript/UI pivot fork, and correctly routes adjacent work through `compute-relational`, `compute-stats`, `pivot-types`, `domain-types`, and compute-core only where contracts require it.
- It thinks in complete categories rather than one-off fixes: aggregate semantics, measure identity, calculated fields, metadata, layout projection, expansion keys, Show Values As, empty items, materialization, GETPIVOTDATA, and bridge transport.
- The invariants section is unusually useful. Stable `PlacementId`, explicit value ordering, non-algebraic aggregate rules, `None` versus `Some(Vec::new())` grand-total framing, and `rendered_bounds` authority are all high-value contracts.
- Verification is mostly production-path focused. The plan includes `compute-pivot` gates plus adjacent crate gates, stored-pivot paths, materialization, item extraction, pivot registration, bridge transport, and generated TypeScript impact.
- The parallelization notes split work along mostly sensible ownership boundaries once a shared contract is written.

Major gaps or risks

- The "first implementation slice" is not actually sliced. The concrete plan spans a multi-crate pivot engine redesign, public DTO metadata, bridge regeneration, materialization, GETPIVOTDATA registration, and app consumers without explicit milestones.
- The measure-slot contract is described but not specified. Before implementation, the plan should provide the exact `ResolvedMeasureSlot` shape, ordering rules, alias precedence, legacy field-id fallback behavior, calculated-field source handling, and example configs/results.
- `value_records` is still underdefined. The plan should state whether records are emitted by default, whether provenance is optional, how subtotal and grand-total records are represented, whether records contain raw or transformed values, and what size policy prevents runaway payloads.
- Empty item semantics remain a major blocker. The plan correctly asks for an item universe, but it should define the required input source or explicitly block implementation until pivot-cache item metadata is available.
- The public DTO migration path is too light. If descriptor types need extension, the plan should name generated bridge/schema changes, backward compatibility expectations, serde defaults, and fixture update strategy.
- The parallel agent plan depends on unresolved core choices. Agents B-G can produce incompatible implementations unless measure slots, tuple keys, raw/transformed value policy, expansion-key normalization, and layout geometry examples are frozen first.
- The plan should separate bug-fix compatibility from intentional breaking behavior more explicitly, especially for legacy configs that reference duplicate value fields by `field_id`.

Contract and verification assessment

The contract instincts are excellent: the plan ties result value order, measure descriptors, value records, grand totals, materialized coordinates, and GETPIVOTDATA bounds into one production contract. It also correctly calls out that non-exhaustive enum variants must fail explicitly instead of silently degrading to `Sum`, `Day`, `Count`, or no-op behavior.

Verification coverage is broad, but it needs sharper acceptance gates. The Rust crate gates are appropriate, and the adjacent-crate gates are correctly conditional. However, bridge and UI verification should specify exact generated-artifact commands or scripts, and UI-impacting changes should require browser exercise through real UI input paths. The plan should also define contract fixtures with expected `PivotTableResult` JSON for the measure-slot, metadata, collapsed-column, Show Values As, and empty-framing cases before implementation begins.

Concrete changes that would raise the rating

- Add a Phase 0 contract artifact with concrete schemas and examples for `ResolvedMeasureSlot`, tuple keys, `measure_descriptors`, `value_records`, raw versus transformed values, and grand-total/subtotal representation.
- Split the implementation into explicit milestones with acceptance criteria, for example: aggregate/validation correctness, measure identity and descriptors, value records, presenter layout, Show Values As, compute-core consumers, then bridge/UI follow-through.
- Define `value_records` policy precisely: default emission, provenance option, payload limits, subtotal/grand-total records, and interaction with Show Values As.
- Make empty-item implementation conditional on a named item-universe source, and state the upstream DTO/parser/cache contract required if current source data is insufficient.
- Add a public DTO migration section covering serde compatibility, generated bridge updates, SDK/kernel type changes, and fixture regeneration.
- Turn the parallelization notes into dependency-gated work packages so no downstream agent starts until the representation and layout examples it consumes are approved.
