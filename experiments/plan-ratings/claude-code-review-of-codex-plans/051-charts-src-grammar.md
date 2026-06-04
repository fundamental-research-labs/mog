Rating: 8/10

# Review of 051-charts-src-grammar.md


## Summary judgment

This is a strong, unusually well-grounded improvement plan for the `@mog/charts`
grammar compiler. Nearly every factual claim it makes about the current code was
verifiable in the source, and the diagnosed gaps are real production-contract
holes rather than cosmetic cleanups. The plan correctly identifies its scope
boundaries (it consumes `ChartSpec` from `charts/src/core`; it must not touch
workbook/range/kernel-lifecycle concerns), states purity/ownership invariants
precisely, and ties every objective to acceptance criteria and verification
gates. Its principal weakness is sheer size: eleven sections amounting to a
near-total restructuring of the grammar layer, where a couple of the highest-risk
items (notably `trail`) are under-investigated relative to their stated risk.

## Major strengths

- **Evidence-based diagnosis.** Spot-checks confirm the plan's specific claims:
  - `MarkType` includes `'trail'` (spec.ts) but `generateMarks` has no `trail`
    case and falls through to `default: return []` (marks/index.ts) — a genuine
    silent public-contract gap.
  - `applyTransform` ends in `// Unknown transform - return data unchanged; return data`
    (transforms/index.ts:177-178), exactly the silent-fallback the plan flags.
  - `generateLegends` renders only the color legend (legend-generator.ts:41-42)
    while a `requiredLegendChannels` helper already enumerates color/fill/shape/size
    (lines 232-237) — confirming the reservation-vs-render mismatch.
  - `compiler.ts` and `layer-compiler.ts` independently re-derive
    background/title/legend/clipping (`clipMarksToPlotArea`, `generateTitle`,
    `generateLegends`, `generateAxes`) — the duplicated orchestration is real.
  - Trace `schemaVersion` is present in data-label/approximation/bar-geometry
    and several `types.ts` interfaces, but absent from cartesian-geometry and
    stock-glyph traces — confirming "inconsistent across trace families."
  - `MAX_RECONCILE_PASSES = 2` exists in path-cartesian-reconcile.ts.
- **Accurate downstream contract awareness.** The kernel claims hold:
  `compileChartMarks`, the `ChartCompileStage = 'configToSpec' | 'compile' |
  'collectMarks' | 'layout'` union, and `compilerPathId` values
  `'ts-grammar'` / `'wasm-transforms+ts-grammar'` all exist in the kernel
  bridge. `layout-snapshot.ts` is indeed the single `px * 0.75` (72/96)
  pixel-to-point conversion. This grounding makes the "preserve/strengthen
  contracts" section credible rather than aspirational.
- **Disciplined non-goals and purity guarantees.** Explicitly forbids
  `mog -> mog-internal` deps, test-only compiler branches, range resolution
  leaking into the compiler, and silent-empty preservation. These are the right
  guardrails for this folder.
- **Verification gates are concrete and real.** `pnpm test` (jest) and
  `pnpm typecheck` (tsc --noEmit) both exist; referenced test files
  (`__tests__/grammar/{compiler,encoding-resolver,layout,transforms}.test.ts`,
  `__tests__/integration/full-pipeline.test.ts`,
  `__tests__/golden-master/snapshot.test.ts`) actually exist, so the targeted-test
  list is anchored, not invented.
- **Good treatment of geometry as a contract.** Calling out that more precise
  text measurement shifts layout and must be treated as a contract change (with
  coordinated snapshot updates) rather than a "harmless visual diff" is exactly
  the right framing for a snapshot-backed pipeline.
- **Strong edge-case enumeration** (log scales with non-positive data, date/serial
  axes, percent-stacked, secondary/independent y, pie zero/near-zero labels,
  stock OHLC/volume policies) shows real domain familiarity.

## Major gaps or risks

- **`trail` is the weakest-investigated high-risk item.** The plan both mandates
  implementing `trail` as a "variable-width path family" and flags that it "may
  require primitive renderer support." A search of `src/primitives` found no
  existing variable-width / per-vertex-width path support, so this is almost
  certainly a primitive + renderer change of unknown size that gates a
  "production generator" acceptance criterion. The plan should either confirm the
  primitive capability or scope `trail` as a separate dependency-bearing slice
  with its own gate, rather than bundling it into "consolidate mark runtime."
- **`marks/helpers.ts` already exists** and already exports
  `renderableDataRows`, `definedStyle`, `invokeScale`, `centeredScalePosition`,
  `splitDataByLineSegment`, etc. Section 7 frames these as helpers to "add,"
  which understates that the real work is *consolidation/migration* of existing
  duplicated helpers, and risks creating parallel helper sets. The plan should
  reference the current helpers.ts inventory and specify which existing exports
  are absorbed vs. extended.
- **Total scope is very large.** Eleven workstreams (typed pipeline core, mark
  registry, diagnostics, scale contract, layout solver, guide contracts, mark
  runtime, trace contracts, snapshot extraction, transform registry, export
  hygiene) is effectively a rewrite of the layer. Sequencing and parallel slices
  are provided, but there is no explicit "minimum first shippable increment" or
  rollback story if a mid-stack refactor (e.g., the pipeline core) destabilizes
  snapshots. A "land registries+diagnostics behind no-geometry-change" first
  slice is named in sequencing but not promoted as the safe MVP boundary.
- **Legend expansion semantics are deferred to "the guide contract."** Whether
  fill/shape/size produce combined entries or separate legends, and their
  ordering, is the part most likely to move layout reservations and break
  snapshots; the plan defers this to a contract it asks to be defined rather than
  proposing the default policy. This is the riskiest geometry change and deserves
  a concrete proposed default.
- **TS/WASM equivalence test feasibility is hedged.** Section 10 says equivalence
  tests run "where the test environment can load the WASM exports," with shared
  fixtures as the floor. That floor (TS reads fixtures, Rust reads the same
  fixtures) is sound, but the plan does not confirm a WASM-loading harness exists
  in the charts jest setup, so the stronger claim may quietly degrade to
  fixture-only. State the actual harness availability.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. It distinguishes pure-compile
ownership from DOM/kernel/core ownership, pins `compile(spec, data?, options?)` as
pure/synchronous, names the single pixel-to-point conversion point, and lists
specific invariants (inline-data precedence, mark-aware zero inclusion, explicit
domains not widened, shared-layer field inclusion, gridline-vs-foreground draw
order). The proposed typed contracts (`MarkCompilerContract`, `scale-contract`
metadata with `kind`/`positionSemantics`/`invalidValuePolicy`, schema-first trace
contracts) are the right mechanisms and are stated with enough field-level detail
to be implementable.

Verification gates are appropriate and real: package test/typecheck plus
cross-folder kernel/OOXML/DOM gates triggered specifically "when compile result,
traces, or layout snapshots change." Acceptance criteria are per-section and
mostly testable. A few are soft ("renderer-equivalent where possible," "clearly
marked as estimated") — acceptable given the honest acknowledgment that exact
text/path geometry is sometimes unavailable, but they would benefit from a stated
tolerance or an explicit authority-tag assertion.

## Concrete changes that would raise the rating

1. **De-risk `trail`.** Add a short investigation result on whether
   `charts/src/primitives` supports variable-width paths; if not, split `trail`
   into its own slice with an explicit primitive/renderer dependency and gate,
   and keep the mark registry's `trail` entry as `diagnostic`/preservation-only
   until that lands. This is the single change that most improves executability.
2. **Acknowledge existing `marks/helpers.ts`.** Inventory current exports and
   specify, per helper, whether section 7 absorbs, extends, or supersedes it, so
   the refactor consolidates rather than forks helper logic.
3. **Name the MVP slice and rollback.** Promote "registries + diagnostics with
   zero geometry change" as the explicit first shippable increment with snapshot
   stability as its gate, and state how to revert the pipeline-core refactor if
   golden-master snapshots drift unexpectedly.
4. **Propose a default legend guide plan.** Give the concrete default for
   multi-channel legends (e.g., one legend per guide-capable channel in a fixed
   channel order, no combined entries in v1) so layout-reservation impact is
   predictable and snapshot churn is bounded.
5. **Confirm the WASM test harness.** State whether charts jest can load WASM
   transform exports; if it cannot, commit to the shared-fixture floor explicitly
   and move the cross-engine assertion to the kernel test suite.
6. **Tighten soft acceptance criteria.** For estimated-vs-measured bounds, assert
   the authority tag is present in trace/layout metadata and add a numeric
   tolerance for "renderer-equivalent" bounds so the criterion is checkable.
