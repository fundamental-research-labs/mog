Rating: 8/10

# Review of Plan 051 — `mog/charts/src/grammar`

## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every concrete claim it makes is verifiable against the actual source, and the line numbers it cites are correct. It correctly identifies that the `grammar` folder is in good architectural health (zero `as any`/`@ts-ignore`/`FIXME`, pure functions) and that its real weaknesses are internal-quality: pervasive copy-paste of numeric helpers, oversized functions, and thin test coverage on builders that form a live cross-package contract. The plan's central insight — that the `cartesianGeometry`/trace payload is a load-bearing contract consumed by `mog/kernel`, not test-only output — is accurate and is the right thing to organize the work around.

The main ceiling on the rating is that this is fundamentally a maintainability/hardening plan, not feature or bug work. Its production-path value is indirect (it freezes and tests an existing contract rather than fixing a user-visible defect or adding capability). Within that scope it is close to exemplary: well-sequenced, contract-aware, and honest about non-goals.

## Verification of claims (spot-checked against source)

- File line counts match exactly: `compiler.ts` 514, `types.ts` 834, `axis-generator.ts` 1739, `cartesian-geometry-trace.ts` 983, `encoding-resolver.ts` 1029, `spec.ts` 1478.
- The `clamp`/`clampNumber` duplication is real and the enumerated sites are accurate: `bar-geometry-trace.ts:567`, `stock-glyph-geometry.ts:739`, `stock-glyph-profile.ts:74`, `path-cartesian-reconcile.ts:258`, `layout.ts:311`, `marks/{bar:22, area:30, plot-3d:110, surface-3d:524, depth-3d:528, area-surface-extent:81}.ts`. Domain variants `clamp01` (`approximation-traces.ts:909`), `clampAxisPosition` (`axis-generator.ts:858`), `clampYToPlot` (`cartesian-geometry-trace.ts:882`) confirmed.
- `normalizePlotX/Y` duplicated at `cartesian-geometry-trace.ts:888-892` and `stock-glyph-geometry.ts:726-730` — confirmed.
- `datumString`/`datumNumber` redeclarations across mark files — ~19 matches found, consistent with the "~10 files" claim; `marks/helpers.ts` already exists with `invokeScale`/`centeredScalePosition`.
- Exactly 4 test files (`axis-generator-contracts`, `axis-generator-format`, `layout-snapshot`, `marks/depth-3d`) — confirmed.
- Kernel-contract claim verified: `xy-family-support.ts` reads `input.cartesianGeometry` repeatedly (`scatterPointAuthorityEvidence`, `xyCartesianGeometryEvidence`, `scatterCoordinateTraceDiagnostics` all present); `chart-family-support.ts:296+` enumerates dotted paths (`cartesianGeometry.geometryStatus`, `.valueAxes.*`, `.bubble.*`, `.series.*`); the snapshot test asserts `resolved.plot.cartesianGeometry?.area` via `toMatchObject({ stackMode, baseline })`.
- Clip semantics confirmed exactly: only `rect`/`path`/`symbol` clipped, opt-out via `__mogClipToPlotArea === false` (`compiler.ts:435-462`).

This degree of evidence fidelity is the plan's strongest feature and substantially de-risks execution.

## Major strengths

- **Contract-first framing.** It treats the trace interfaces as a frozen, cross-package surface and explicitly forbids "simplifying"/flattening them — exactly the right call given the kernel coupling.
- **Correct sequencing.** Characterization/contract tests (Phases C/D) are sequenced before the refactors (Phase B) they protect, with the existing `axis-generator-*`/`layout-snapshot` suites named as the regression net.
- **Disciplined helper consolidation.** It distinguishes truly-identical `clamp` copies (merge) from distinct-semantics variants `clampSize`/`clampAxisPosition`/`clampToPlotArea` (keep), and flags the NaN-guard subtlety (bare `clamp` does not guard NaN).
- **Scope hygiene.** `numeric.ts` is deliberately kept inside `grammar` rather than pushed into `primitives`/`algebra` to avoid widening their public surface — a thoughtful boundary decision. Clear, enumerated non-goals.
- **Cross-package gate.** Naming `mog/kernel` chart-bridge tests as the real proof the contract held is the correct verification, not just local typecheck.

## Major gaps or risks

- **Production value is indirect.** Nothing here is user-visible; it hardens and documents an existing contract. Legitimate and valuable, but it is maintenance work, and the plan could be honest that the payoff is future-regression-prevention, not present capability.
- **Arbitrary DoD thresholds.** "No oversized function >~120 lines" risks inducing over-decomposition (many tiny single-call functions can hurt readability as much as one large one). The threshold should be a guideline, not a gate.
- **Characterization net for axis decomposition is asserted, not demonstrated.** The existing axis tests (`axis-generator-contracts`, `axis-generator-format`) may not cover the multi-level-label/collision paths being extracted. The plan should state explicitly that it will confirm coverage of the specific extracted phases (or add characterization there first) before splitting, rather than assuming the two existing files suffice.
- **"Byte-for-byte unchanged" assumes the duplicates are truly identical.** The plan mentions diffing call sites, but should make verifying that all 11 `clamp` bodies are character-identical a hard precondition of Phase A step 2, since a single divergent copy silently changes behavior on merge.
- **Minor citation imprecision.** The snapshot test is at `mog/kernel/src/domain/charts/__tests__/resolved-spec-snapshot.test.ts`, not under `.../charts/bridge/__tests__/` as the abbreviated path implies. Cosmetic, but the implementer should not waste time at the wrong path.
- **No fixture inventory for the trace-contract test.** Phase C/D name representative chart types (scatter, line, bar variants, area, candlestick, 3D, combo) and say to "drive the list from `chart-family-support.ts:296-374`" — good — but no concrete fixture specs are provided, leaving the most contract-critical test under-specified.

## Contract and verification assessment

The verification strategy is the plan's best dimension. It has three independent layers: local unit/contract tests, the unchanged existing regression suites guarding Phase B, and the kernel chart-bridge suites as the cross-package proof. The trace-contract tripwire (presence + field-name assertions driven from the actual kernel consumer list) is the right shape — a tripwire, not a brittle pixel snapshot — and directly targets the highest-stated risk (silent trace-shape drift). Gaps: the kernel-consumed path list should be pinned/snapshotted so it can't silently drift out of sync with `chart-family-support.ts`, and the plan should commit to capturing before/after compiled-output diffs on the fixtures (it says "diffing compiled output" but doesn't specify a stored golden). The transform div-by-zero ⇒ `null` characterization is correctly flagged as "characterize before touching."

## Concrete changes that would raise the rating

1. Add a small, explicit fixture table for `trace-contract.test.ts` (one spec per chart family with the exact trace paths each must expose), and snapshot the kernel-consumed path list so the tripwire stays synchronized with `chart-family-support.ts`.
2. Make "all `clamp` bodies are character-identical" an explicit precondition/checklist item of Phase A before any merge, with the divergent-NaN case called out per site.
3. Before Phase B, verify (and if absent, add) characterization coverage of the specific axis sub-phases being extracted (multi-level labels, collision layout, axis-crossing), rather than relying on the two existing axis test files.
4. Replace the ">~120 line" hard gate with a softer reviewability guideline to avoid over-fragmentation.
5. Commit to a stored before/after golden of compiled output on the fixture set for Phase B, so "outputs identical" is mechanically verified, not eyeballed.
6. Fix the snapshot-test path citation to `mog/kernel/src/domain/charts/__tests__/resolved-spec-snapshot.test.ts`.
