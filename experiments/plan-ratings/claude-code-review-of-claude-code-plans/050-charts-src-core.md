Rating: 8/10

# Review of Plan 050 — `mog/charts/src/core`

## Summary judgment

This is a strong, evidence-driven refactor plan for the DOM-free chart computation
layer. Its defining strength is that almost every structural claim is independently
verifiable in the source, and I confirmed the load-bearing ones directly:

- The four god-file line counts are exact: `excel-cartesian-geometry.ts` 1508,
  `pie-doughnut-geometry.ts` 1270, `radar-visual-contract.ts` 1089,
  `layers/combo.ts` 921.
- The facade re-exports are real: `config-to-spec.ts` = `export * from './config-to-spec/index'`;
  `config-to-spec/bar-geometry.ts` = `export * from '../chart-ir/bar-geometry'` (+ rectangle-model);
  `config-to-spec/fields.ts` re-exports `../chart-ir/fields` + grammar `internal-fields` + local `constants`;
  `series-style.ts` = `export * from './style'`; `data-extractor.ts` is a compatibility facade.
- The three-layer color resolution exists: `style-resolver/resolver.ts:238 resolveSeriesColor`,
  `config-to-spec/style.ts:48 resolveSeriesColor`, `config-to-spec/color-authority.ts:47 resolveSeriesColorAuthority`,
  with the authority consumed across `radar-visual-contract`, `stock-visual`, `xy-visual-contract`.
- The cache max-index fallback the plan targets is real (`data-extractor-cache.ts:43` and `:67`
  fall back to `reduce((max, p) => Math.max(max, p.idx + 1), 0)` when `pointCount` is absent/inconsistent).
- The diagnostics channel O4 relies on genuinely exists: `ChartStyleContext.diagnostics?: ChartStyleDiagnostic[]`
  (`mog/charts/src/utils/chart-color-types.ts:21`), already read in `resolver.ts:50` and
  `pie-doughnut-geometry.ts` (`unmodeledStyleDiagnostics`). This de-risks the "no new contract" claim.

The plan correctly frames itself as a quality/structural refactor under a hard
output-stability invariant rather than a rewrite, sequences behavior-locking before
refactoring, and is unusually honest about the single intended behavior change (Phase 3
cache). The contract section (C1–C7) is the best part: it pins the regression oracle
(`configToSpec` deep-equality), the export-surface freeze, and the wire-contract field
strings as explicit, testable invariants.

It loses points for a few quantitative imprecisions, some objectives whose production
value is closer to aesthetics than risk reduction, and Phase 0 fixtures specified only
at the family level despite a large pre-existing test suite.

## Major strengths

- **Verifiable, not aspirational.** The "Evidence/confidence note" is backed up — I
  spot-checked the costly claims and they hold. This is rare and materially raises trust.
- **Right invariant, right oracle.** C1 (structural ChartSpec equality) + Phase 0
  snapshots as the gate for every later phase is the correct design for a behavior-preserving
  refactor. G1 explicitly requires any diff outside Phase 3 to be treated as a defect.
- **Honest about the one behavior delta.** Phase 3 is called out as the single intended
  change, with G6 forcing deliberate re-approval rather than silent acceptance. R3 reinforces it.
- **Sequencing and parallelization are sound.** Phase 0 first; 1/2/3/5/6 independent;
  4.4 (`combo.ts`) gated behind 4.1–4.3; "one file per PR" for the highest-risk phase (R1).
- **Repo-specific awareness.** It handles the "no Excel in code" rule precisely (names vs.
  comments distinction in Non-goals), and flags the `@mog-sdk/contracts` build-before-typecheck
  convention plus the feature-gate/state-leak full-suite eval gotcha (G9) — both match known repo hazards.
- **Cross-package contract framing (C2/C3).** Treating field-name strings as a wire contract
  shared with `grammar/` and `export/ooxml/` is correct and is the actual reason O6 is risky;
  the plan names that risk (R4) and the mitigation (grep importers, move declaration only).

## Major gaps or risks

- **Cast count is understated.** O5 claims "~20 `as`/`as unknown as T` casts"; a broad
  `\bas\b` sweep (excluding `as const`/imports) returns ~46 occurrences folder-wide. The
  *specific* cited sites are accurate (`resolver.ts:299-301` double cast; `data-row-style.ts:244-249`
  `color: unknown … as ChartColor`), but `axis-format-normalization.ts:40` has drifted off the
  exact cast line. G8's "cast count strictly decreases" is a good gate, but the baseline number
  in the plan is wrong and should be re-measured before it becomes a CI threshold.
- **Phase 0 fixtures under-specified given existing coverage.** The folder already has a
  substantial `__tests__` suite (`config-to-spec-*` for bar-colors, radar, stock, bubble,
  date-axis, style-resolver, etc.). The plan treats characterization as greenfield and does not
  reconcile new snapshots against what is already locked, risking duplicate/competing oracles.
  It should state which existing tests already satisfy C1 and where the genuine gaps are.
- **Some objectives are polish, not risk.** The plan itself says the folder is "healthy"
  (no `any`, no `@ts-ignore`, pure). O1 (decompose 4 god-files) is largely readability; its
  production payoff is modest relative to its R1 risk surface. That is a fair trade only because
  the snapshot gate is strong — but the plan slightly oversells O1 as "risk concentration" reduction.
- **O4 disposition semantics not specified.** The existing `ChartStyleDiagnostic` carries a
  `disposition` field (e.g. `'rendered'`), and `unmodeledStyleDiagnostics` filters on it. Phase 5
  says "emit structured entries" but does not specify the `disposition`/owner-key schema for the
  new fallback diagnostics, which is exactly the detail that determines whether output stays
  byte-identical (G7) and whether R6 over-emission is controlled.
- **O2 leaves three call patterns, not one.** Even after unification, `resolveSeriesColorAuthority`
  is invoked with bespoke argument shapes across radar/stock/xy contracts. The plan unifies the
  *fallback chain* but does not address the divergent call sites, so "shrink the number of
  implementations" is partially true; the adapter boundary should be named more concretely.

## Contract and verification assessment

Contracts are the plan's strongest dimension. C1–C7 are concrete, falsifiable, and mapped
to gates: C1→G1, C2→G2, C3→G3, C7→G4, C6→G5, O3→G6, O4→G7. C4 (purity/DOM-free) and C5
(graceful degradation, single legitimate throw in `data-extractor-primitives`) are accurate
to the source. The verification gates are appropriately specific — G5 names actual numeric
defaults (`DEFAULT_EXCEL_BAR_GAP_WIDTH`, nice-tick steps), G3 demands literal field-string
assertions plus OOXML round-trip. The one soft spot is G2: "tsc/type-level check that exports
are unchanged" is asserted but no mechanism (e.g. an API-extractor snapshot or a generated
`.d.ts` diff) is named, so the export-surface freeze relies on downstream typecheck catching
removals rather than a positive surface assertion. Adding an explicit public-API snapshot would
close C2 cleanly. Overall the contract/gate coupling is tight enough that an executor could not
silently regress behavior without a gate failing — which is the bar.

## Concrete changes that would raise the rating

1. **Re-measure and pin the cast baseline.** Replace "~20" with the real count and enumerate
   the exact sites O5 will touch, so G8's "strictly decreases" has a correct denominator.
2. **Reconcile Phase 0 against the existing suite.** List which `__tests__/config-to-spec-*`
   files already lock C1 for each family and scope new snapshots to the true gaps (combo,
   waterfall, surface/contour, imported-OOXML) instead of re-snapshotting everything.
3. **Specify the O4 diagnostic schema.** Define `disposition`, owner-key, and dedup rules for
   the new fallback diagnostics and assert (G7) that adding them leaves `ChartSpec` byte-identical
   and respects the existing `unmodeledStyleDiagnostics` filter.
4. **Add a positive public-API snapshot to G2** (api-extractor or `.d.ts` diff) so C2 is asserted,
   not merely inferred from downstream typecheck.
5. **Make O2's adapter boundary concrete.** Name the unified `resolvePaintAuthority` signature and
   show how each of radar/stock/xy/series/point call sites maps onto it, so "one implementation"
   is demonstrable rather than asserted.
6. **Down-rank O1's framing** from risk reduction to maintainability, and consider deferring 4.5
   entirely; this keeps reviewer attention on the genuinely valuable O3/O6 wire-contract work.
