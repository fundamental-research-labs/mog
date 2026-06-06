Rating: 8/10

# Review of Plan 072 — `mog/contracts/src/bridges`

## Summary judgment

This is a tight, well-researched, and largely accurate plan for a small, well-bounded problem: a single 162-line file (`ink-recognition-bridge.ts`) that is a byte-for-byte duplicate of its upstream source-of-truth in `@mog/types-bridges`, where the other eight files are correct re-export shims. The plan correctly diagnoses the root cause (`export type *` cannot carry the one runtime value, `DEFAULT_RECOGNITION_THRESHOLDS`), cites a real in-repo precedent for the fix (`grid-renderer.ts`'s `export { RenderPriority }`), and proposes a behavior-preserving consolidation plus a structural guard to prevent recurrence. Almost every factual claim I spot-checked is true. The dominant weakness is one missed analytical observation about the folder's actual import topology (below), which would have changed the framing and arguably widened the scope.

I independently confirmed:
- `mog/contracts/src/bridges` holds 9 files: 8 four-line `export type *` shims + the 162-line ink outlier (`ls`, file reads).
- The ink file is **byte-identical** to `mog/types/bridges/src/ink-recognition-bridge.ts` (`diff` → IDENTICAL), and `DEFAULT_RECOGNITION_THRESHOLDS` is the sole runtime value export.
- The precedent is real: `grid-renderer.ts:46` does `export { RenderPriority };` separately from its `export type` lines.
- Consumers exist exactly as described: `mog/kernel/src/domain/drawing/ink-recognition-bridge.ts:53` spreads `...DEFAULT_RECOGNITION_THRESHOLDS`, and `mog/kernel/src/bridges/__tests__/ink-recognition-bridge.test.ts` asserts value identity.
- The cited infrastructure all exists: the negative fixture (`fixtures/external/negative/types-star-import/smoke.ts`), `tools/eslint-plugin-mog/import-boundaries.cjs`, the `./bridges` subpath in `contracts/package.json`, and the `./ink-recognition-bridge` subpath in `types/bridges/package.json` under all conditions.

## Major strengths

- **Accurate root-cause analysis.** The "`export type *` carries types only" explanation is correct and is the actual reason the migration left a copy. The plan doesn't just describe the symptom; it explains why the duplicate exists and why a guard is the durable fix.
- **Evidence-grounded.** Nearly every assertion is backed by a file path I could verify. The byte-identical claim, the sole-value-export claim, the precedent file, and the consumer spread/test are all real and correctly cited.
- **Correct invariant framing.** Treating the folder as a published façade with "zero original contract definitions" is the right architectural lens, and "no behavior change for any consumer" is the correct success bar for a public surface.
- **Concrete, ordered verification gates.** Typecheck contracts → typecheck/build kernel → existing kernel value-identity test → api-extractor public-surface diff (zero net change) → new guard passes/fails on synthetic input → boundary lint green. The api-extractor surface diff in particular is exactly the right gate for "did the value silently become a type?"
- **Sequencing handled.** The interaction with plan 007 (disjoint files, either order, shared `DEFAULT_RECOGNITION_THRESHOLDS` as the one coordination point) is reasoned through correctly.

## Major gaps or risks

- **Missed import-topology finding (the biggest gap).** The plan frames the eight sibling files as the active "correct shims" that constitute the façade. But the barrel `index.ts` pulls *all* types from the upstream aggregate `export type * from '@mog/types-bridges/bridges'` — **not** from the local per-file shims — and `contracts/package.json` exposes only `./bridges`, no per-file subpaths. I found no import anywhere (relative or via `@mog-sdk/contracts/bridges/<file>`) that reaches `chart-bridge.ts`, `diagram-bridge.ts`, `pivot-bridge.ts`, etc. They appear to be **orphaned/unreachable code**. A folder-scoped plan should have surfaced this and decided whether those eight files should exist at all (delete them, or re-route the barrel through them for the symmetry the plan claims to want). As written, "make the shim pattern uniform across all nine files" polishes files that are not in the resolution path. The plan *does* correctly note the types flow through the aggregate ("only the value statement is in question") — it just doesn't extend that observation to its logical conclusion about the siblings.
- **Step 1 adds a redundant line.** Because types already flow through the aggregate, the proposed `export type * from '@mog/types-bridges/ink-recognition-bridge'` in the new shim is dead weight (harmless, consistent, but not load-bearing). The plan half-acknowledges this without resolving it.
- **Guard placement is muddled.** Step 4 is labeled "production-path, in `mog-internal` test surface," yet both proposed homes (the eslint plugin and the contracts test suite) live in the *public* `mog/` tree, not `mog-internal`. The phrasing should be cleaned up; the substance is fine.
- **Indecision in Step 2.** "Leave as-is *or* repoint" is offered with a stated preference, which is acceptable, but a plan should just pick one. The preference (route through the local shim) also leans on the symmetry argument that the topology finding above undercuts.
- **Proportionality.** The artifact is long for a ~162-line dedup plus a lint rule. Thoroughness is justified by the drift-prevention rationale, but the verbosity slightly outruns the impact.

## Contract and verification assessment

The contract reasoning is sound. The plan correctly identifies the two things that must not change on the public boundary: the exported symbol set and the runtime-vs-type nature of `DEFAULT_RECOGNITION_THRESHOLDS`. Value-identity preservation (a plain re-export, not a re-declaration, so spread/identity semantics survive) is the correct concern and is directly tested by the existing kernel test. The api-extractor rollup diff is the right gate to catch a value being demoted to a type or the rollup treating a re-exported value differently from an in-file declaration. The boundary-direction invariant (`contracts` → `@mog/types-bridges` allowed, reverse forbidden) and the "no new subpath exports" constraint are both real and correctly preserved.

The one verification weakness mirrors the analytical gap: there is no gate that would detect the orphaned siblings, because the plan doesn't model the barrel-vs-aggregate distinction. The proposed structural guard checks "every non-`index.ts` file contains only re-exports," which would *pass* on dead shims — so it locks in the orphans rather than questioning them.

## Concrete changes that would raise the rating

1. **Resolve the orphaned-shim question.** Document that the barrel resolves types via `@mog/types-bridges/bridges` and that the eight per-file shims have no subpath export and no importers. Then decide explicitly: delete them, or make the barrel re-export through them. This is the difference between "tidy the one bad file" and "actually understand the folder."
2. **Make the guard account for reachability**, not just shape — e.g., assert the barrel is the only public entry and flag any file not reachable from it, so the guard can't bless dead code.
3. **Pick one option in Step 2** instead of offering two, and drop the symmetry justification if the topology finding shows the siblings are dead.
4. **Drop or justify the redundant `export type *`** in the new ink shim, given types already arrive via the aggregate.
5. **Fix the Step 4 location wording** ("`mog-internal` test surface" → the public eslint plugin / contracts test suite) so the guard's home is unambiguous.
6. **Tighten length** — the analysis is correct but could land in roughly half the words.
