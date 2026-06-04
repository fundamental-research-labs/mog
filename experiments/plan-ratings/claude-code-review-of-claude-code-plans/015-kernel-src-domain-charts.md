Rating: 8/10

# Review of 015 — `mog/kernel/src/domain/charts`

## Summary judgment

This is a strong, evidence-grounded plan that demonstrates real familiarity with the folder rather than generic refactoring boilerplate. Nearly every factual claim I spot-checked against the tree is accurate: the `seriesConfigToWire` unconditional `projectionDiagnostics` emission (`chart-type-converters.ts:243`) and its mirror copy-back (`:174`), the `updates as ChartFloatingObject` cast in `chart-store.ts:48`, the substring/token-normalizing import-status classifier in `bridge/import-render-status.ts`, the silent `CellError → null` coercion in `bridge/chart-cell-accessor.ts`, the diagnostic code set in `chart-range-references.ts`, the file sizes (`resolved-spec-plot-snapshot.ts` 3,756 lines, `chart-family-support.ts` 3,385, `combo-layer-authority.ts` 918), the 25 `__tests__/` specs, and the clean baseline (no `TODO`/`FIXME`/`as any`). The plan correctly identifies this folder as a correctness-and-fidelity seam and orders its work surgical-fix-first, type-safety-second, decomposition-last. It respects the stated out-of-scope boundaries (the `IChartBridge` contract, the Rust core, `@mog/charts`) and flags every cross-folder touch.

The headline objective — the serde-breaking optional field — is a genuinely high-value, real product bug (it is independently corroborated by prior project knowledge that `charts.update({ series })` drops the whole series array because a non-`Option` field serializes as `undefined` and breaks wasm serde deser, while the Rust core round-trips fine). Putting that fix first, surgical, and isolated is exactly right.

The main reasons this isn't a 9–10: the root-cause mechanism for the live bug is asserted rather than fully proven, the decomposition steps under-specify how 155+ functions partition across new submodules, and the plan bundles a surgical hotfix with two large structural refactors and a new liveness abstraction into a single plan when the serde fix arguably warrants shipping on its own.

## Major strengths

- **Evidence is real and line-accurate.** This is the strongest dimension. The plan cites specific files and line numbers that check out, distinguishing it from plans that describe what code "probably" does. The Evidence section is auditable, and I audited it.
- **Correct prioritization.** Step 1 (live serde bug) lands first and is explicitly the *only* step that changes observable persistence behavior, gated by converter tests. This is the right risk posture.
- **Sharp invariant capture.** The "production-path contracts to preserve" section is the best part architecturally: synchronous side-effect-light paint, the wire↔config boundary as the *only* sanctioned crossing (no `*Data`+`*Config` co-imports elsewhere), Rust owning persistence/identity, render-time-only range resolution with preserved diagnostic codes, and the load-bearing `exact/approximate/missing/verifiedDefault` authority algebra. These are the things a refactor most easily breaks, and they're named explicitly.
- **Decomposition is framed as behavior-preserving with an oracle.** Keeping the original files as re-export shims, separating logic-free moves from behavior edits, and using `hashJson` snapshot tests as an equivalence oracle is a credible, low-risk decomposition strategy.
- **Honest about constraints.** It states up front that no build/test commands are run and instead specifies the gates an implementer must satisfy, including the cross-folder eval scenario for the `series` persistence regression.

## Major gaps or risks

- **The serde root cause is asserted, not mechanically proven.** The plan says emitting `projectionDiagnostics: undefined` breaks Rust serde, but never explains *why an explicit `undefined` survives the JS→Rust boundary at all.* `JSON.stringify` drops `undefined`-valued own properties, so the bug only manifests if the wire crossing is structural (NAPI/structured-clone/object enumeration that distinguishes "own property = undefined" from "absent"). The fix is almost certainly correct, but the plan should pin down the exact serialization path (it gestures at `compute-types.gen.ts` / `floating-object-mapper.ts` as the wire side) and confirm the mechanism before declaring victory — otherwise "omit the field" could be a coincidental fix that masks a deeper boundary issue. This is the single most important rigor gap given that Step 1 is the marquee deliverable.
- **Decomposition granularity is hand-wavy for the hard part.** "Split by geometry family" and "split per family" are reasonable headings, but `resolved-spec-plot-snapshot.ts` has 155+ functions and the plan does not say how shared helpers, cross-family utilities, or the dispatcher boundary are partitioned. An implementer could reasonably produce a very different split than intended. A short proposed module map (even approximate) with where shared code lands would de-risk Steps 4–5 substantially.
- **Re-export shim assumptions.** "Byte-for-byte identical output" is the right bar, but splitting two ~3.5k-line files can change module-initialization order and introduce/expose circular imports (snapshot ↔ family-support ↔ authority are already tightly coupled per the Evidence). The plan should acknowledge import-cycle risk and name it as a check, not just assume the shim makes splits transparent.
- **Scope concentration.** Seven steps spanning a surgical persistence fix, ~15 cast-site rewrites, a status-classification rewrite, two large file decompositions, a new `LivenessGate` abstraction, and new diagnostics is a lot for one plan. The sequencing notes mitigate this, but the serde fix (Step 1) has a fundamentally different risk/urgency profile than the decomposition and would be cleaner as its own landed change. The plan implies but doesn't commit to that separation.
- **Liveness step is the least concrete.** Step 6 proposes a single `LivenessGate` wrapping `isLive()` + `acceptsCommits` across six files, but doesn't address whether unifying these changes any current early-return semantics (some `isLive()` sites may guard reads, others mutations). "Make the invariant explicit" is a goal, not yet a design.

## Contract and verification assessment

Contract clarity is above average. The wire↔config boundary, the synchronous-paint contract, the diagnostic-code set, and the authority vocabulary are all stated as invariants to preserve, and the strengthening direction (omit absent optionals; route import reads through validated narrowers; typed public entry per submodule) is clearly distinguished from the preserve direction. The out-of-scope list correctly routes any `IChartBridge` or contract-type change to folder 007 / `@mog-sdk/contracts`, which matches the real ownership.

Verification gates are well-specified given the no-run constraint:
- The Step 1 test is precise and correct in the way that matters most — asserting *no own property* `projectionDiagnostics` rather than `=== undefined`, which is exactly the distinction the bug hinges on. Plus a `config → wire → config` round-trip preserving the series array.
- The decomposition oracle (existing snapshot tests + `hashJson` equivalence + one focused test per new entry) is sound.
- The Step 3 parametrized enum-value table including the unknown-value path is the right shape.
- The Step 6 stop()-mid-compile test directly encodes the invariant.

Gaps in verification: (1) the cross-folder `charts.update({ series })` eval scenario is named but deferred to "coordinate, do not edit here" — appropriate for scope, but it means the actual end-to-end proof of the live-bug fix lives outside this plan's deliverables, which should be called out as a dependency risk, not just a note. (2) No gate verifies the serialization *mechanism* assumption from the root-cause gap above. (3) The import-boundary lint gate (no new `*Data`+`*Config` co-imports) is mentioned but the plan doesn't confirm such a lint rule actually exists today versus being aspirational.

## Concrete changes that would raise the rating

1. **Prove the serde mechanism.** Add a short root-cause subsection tracing `projectionDiagnostics` from `seriesConfigToWire` through the exact JS→Rust crossing (NAPI vs JSON), demonstrating why `undefined` survives where serde expects an absent `Option`. Confirm against `compute-types.gen.ts` / `floating-object-mapper.ts` which fields are `Option<T>` on the Rust side. This converts the marquee fix from "plausible" to "proven."
2. **Split Step 1 into its own landable unit.** Explicitly state that Step 1 (+ its tests + the eval scenario) ships independently of Steps 4–7, so the live bug isn't gated behind a multi-thousand-line decomposition.
3. **Provide a module map for Steps 4–5.** Even an approximate target file list with where shared/cross-family helpers land, and the intended dispatcher boundary, so the split is reproducible and reviewable.
4. **Name the import-cycle risk.** Add a check that the re-export shims don't introduce circular initialization between snapshot/family/authority modules, and confirm `hashJson` equivalence covers init-order-sensitive output.
5. **Tighten Step 6 design.** Enumerate the existing `isLive()` sites and classify each as read-guard vs mutation-guard before unifying, so `LivenessGate` provably preserves current semantics rather than flattening them.
6. **Confirm the lint gate exists.** Verify the import-boundary plugin rule (no `*Data`+`*Config` co-imports) is real and enforced today, or downgrade it from "must stay green" to "add this rule."

## Verification note

The only file created by this review is `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-claude-code-plans/015-kernel-src-domain-charts.md`. No production code, tests, fixtures, configs, or the plan under review were modified; all inspection was read-only (`rg`, `sed`, `wc`, `ls`).
