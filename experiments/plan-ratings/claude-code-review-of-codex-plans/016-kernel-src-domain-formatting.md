Rating: 8/10

# Review: 016 - Kernel Domain Formatting


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about
the source folder and the surrounding contract surface checks out against the actual
code. The two files in scope — `format-registry.ts` (a 310-line hand-maintained,
unconsumed advisory table) and `merges.ts` (a thin compute-bridge wrapper carrying
several stubs and JS-side loops) — are characterized precisely. The diagnosis is
correct, the invariants section is genuinely useful, and the implementation steps are
sequenced sensibly with real verification gates and an honest risk register.

The main reasons it is not a 9-10: the plan bundles two only loosely related workstreams
into a single large effort, the "executable coverage matrix" objective risks scope
explosion whose payoff is under-interrogated, and at least one bridge-reuse claim is
slightly off (a viewport merge query already exists). These are refinements, not
fundamental flaws.

## Major strengths

- **Claims are verifiable and verified.** Spot-checks confirm: `merges.ts` does locally
  `rangesOverlap`-filter in `getInRange`/`getInViewport`, loops `mergeAcross` and
  `clearAll` over single merges, and ships no-op `checkMergeDataLoss`/`validateAndClean`/
  `subscribe` exactly as described (lines 101-118, 136-146, 247-319, 381-414, 433-440).
  The generated bridge genuinely already exposes `mergeAcross`, `mergeAndCenter`,
  `checkMergeDataLoss`, `isMergeOrigin`, `clearAllMerges`, and `validateAndCleanMerges`
  (`compute-bridge.gen.ts:343-348`). `RUST_CELL_FORMAT_FIELDS` and
  `cell-format-drift.test.ts` exist as cited. This is a plan written from the code, not
  from a guess.
- **The packaging concern is real, not speculative.** `contracts/src/formatting/format-registry.ts`
  is `export type * from ...` (type-only), yet `contracts/package.json` advertises an
  `"import": "./dist/formatting/format-registry.js"` runtime entry. The kernel's runtime
  `FORMAT_PROPERTY_REGISTRY` has no clear published runtime path. Objective 7 / step 5
  correctly targets this latent footgun.
- **Invariants section is the best part.** It pins down the things an implementer must
  not break: `CellFormat` sparseness, compute-owned cascade, zero-based inclusive merge
  coordinates, Rust as merge-validity authority, identity-backed merge storage, "no TS
  shadow state / manual events," and the `mog` → `mog-internal` dependency direction.
  These are the kinds of invariants that prevent a refactor from silently regressing.
- **Honest about the registry's status.** It states plainly that the registry "is not
  consumed outside itself" and "does not drive tests, docs, import/export, render, or
  API behavior," and resists papering over gaps with broad "implemented" booleans.
- **Verification gates are concrete and matched to surfaces** (kernel package tests,
  `pnpm typecheck`, `cargo test/clippy -p compute-core`, file-IO Rust tests, browser
  exercise), and the parallelization decomposition (Agents A-E) maps cleanly onto the
  step list.

## Major gaps or risks

- **Two plans in one.** The registry-as-executable-contract work and the merge
  consolidation work share a folder but little else — different surfaces, different
  authorities, different verification. They could ship independently. Bundling them
  raises blast radius and makes "done" harder to define. The plan acknowledges
  parallelization but never proposes splitting, which would be the cleaner move.
- **Under-interrogated "build vs. delete" decision for the registry.** The plan documents
  that the registry is unconsumed dead weight, then commits to a *substantial* investment
  (new status dimensions: `computeStorage`, `viewportRead`, `canvasRender`, `pdfRender`,
  `clipboardHtml`, plus per-field `evidence`, plus drift tests, plus a cross-repo XLSX/
  canvas/PDF/clipboard audit). The harder question — is an executable registry worth more
  than deleting it and relying on the existing `cell-format-drift` exhaustiveness test? —
  is never directly answered. The risk register flags scope explosion but not this
  framing. A 9/10 plan would justify the keep decision or scope a minimal first slice.
- **Missed existing reuse in step 8.** The plan says to *add* `getMergesInRange` and
  `getMergesInViewport` bridge methods, but `compute-bridge.gen.ts:311` already exposes
  `getMergesInViewportSpatial(...)`. The plan should reconcile against this existing
  method (extend/rename/reuse) rather than implying greenfield additions; otherwise an
  implementer may duplicate a query.
- **`checkMergeDataLoss` return-shape mismatch glossed.** The bridge returns a tuple
  `[boolean, number]` (`compute-bridge.gen.ts:345`), while step 7 describes returning
  `{ hasDataLoss, cellsWithData }`. The adaptation is trivial but the plan states it as
  if the bridge already returns the object shape; naming the tuple→object mapping
  explicitly would remove ambiguity.
- **No per-step acceptance criteria / definition-of-done.** "Update statuses only when
  the production path and focused tests support the claim" is the right principle, but
  there is no threshold for what fraction of fields must be evidence-backed before the
  registry is considered shipped, nor what to do with the large tail of "unknown" fields.
  Without that, the work has no natural stopping point.
- **Cross-repo audit cost is real and largely unbounded.** Step 4 walks XLSX read/write,
  compute storage/cascade, canvas, PDF, and clipboard for ~20+ fields. This is the
  single biggest effort sink and is described at one altitude ("trace fields through ...")
  without an estimate or a prioritized subset to do first.

## Contract and verification assessment

Contract clarity is high. The plan correctly separates the two owned surfaces (coverage
metadata, merge orchestration) from the authorities that must remain in compute/Rust
(persisted state, validity, cascade, data-loss). The invariants are testable and the
"single-cell merge defined once at the API boundary; no successful receipt for a no-op"
rule is a precise, valuable contract that the current `mergeRange` (which blindly awaits
the bridge and returns `void`) does not satisfy.

Verification gates are appropriate and cover all touched layers. The test list is
comprehensive — registry exhaustiveness vs. TS/Rust/nested-border fields, evidence tests
per status dimension, XLSX roundtrip fixtures for tints/themes/quote-prefix/borders, merge
behavior matrix, off-viewport data-loss UI test, and immediate-post-merge selection
regression. The one weakness is the absence of a measurable completion bar for the
evidence-backing effort (see gaps).

## Concrete changes that would raise the rating

1. **Split into two plans** (or two explicitly independent phases with separate
   acceptance gates): (A) merge consolidation + viewport-refresh centralization +
   receipt/error tightening; (B) registry-as-contract. Phase A is self-contained, lower
   risk, and high value; it should not wait on the registry audit.
2. **Justify keep-vs-delete for the registry**, or scope a minimal first slice (e.g.
   only TS+Rust field exhaustiveness wired into the existing drift test, deferring the
   PDF/clipboard/canvas evidence matrix) so the work has a defensible stopping point.
3. **Reconcile step 8 with `getMergesInViewportSpatial`** — state whether to reuse,
   extend, or rename it, and only add a range variant if one genuinely does not exist.
4. **Name the `checkMergeDataLoss` tuple→object adaptation** explicitly and confirm UI
   callers handle the new async/loading path.
5. **Add per-step definition-of-done**: a target for evidence-backed field coverage, an
   explicit "unknown" disposition, and a prioritized first batch for the cross-repo audit.
6. **Estimate the cross-surface audit** (step 4) or carve it into a ranked sub-list so
   the largest effort sink is bounded.

---
Verification note: I inspected `format-registry.ts`, `merges.ts`,
`compute-bridge.gen.ts`, `contracts/src/formatting/format-registry.ts`, and
`contracts/package.json` read-only. No production, test, config, or plan files were
modified. The only file written by this worker is this review.
