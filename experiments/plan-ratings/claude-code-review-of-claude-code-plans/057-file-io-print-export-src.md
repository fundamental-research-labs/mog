Rating: 9/10

# Review — 057 `mog/file-io/print-export/src`


## Summary judgment

This is a strong, evidence-driven plan for the print/PDF/HTML export pipeline. It correctly identifies the package's defining invariant — that the PDF path and the browser-print path must be visually equivalent — and organizes the whole plan around closing the places where they have diverged. Nearly every cited line number and claim checks out against the current tree, the scope boundaries are explicit and honest, the invariants section is unusually good, and the phasing maps cleanly to objectives with concrete verification gates. The plan would let an implementer start Phase 1–2 immediately. It loses a point for one factually-overstated piece of evidence (the F1/F2 "dead contract" claim), a dangling "Phase 0" reference, and a couple of decision points left unresolved that an implementer must settle before proceeding.

I verified the central claims directly against the source:

- **No PDF header/footer/page-number drawing.** Confirmed: `pdf/exporter.ts` has only the margin constants (`header: 18`, `footer: 18` at `:249-250`) and `renderColHeaders` (repeat-column path); no placeholder substitution or header/footer text drawing exists in `pdf/`. The HTML path renders them (`page-layout.ts:244,266`).
- **`showGridlines`/`showHeaders` ignored in PDF.** Confirmed: both are read only under `html/` (`table-generator.ts`, `style-generator.ts`); no read site in `pdf/`.
- **HTML path ignores merges.** Confirmed: `getMergedRegions?` is *declared* at `table-generator.ts:50` and matched nowhere else in `html/` — no `colspan`/`rowspan` emission.
- **Per-cell async hidden probes.** Confirmed: pre-built sets at `exporter.ts:510-521`, yet `await isRowHidden/isColHidden` re-run at `:583,:589,:674,:795,:805`.
- **`NumberFormatRenderer` unwired.** Confirmed: referenced only by its own file, its test, and a doc comment in `render-shared.ts`; not re-exported from the barrel `src/index.ts`.
- **Triple defaults / double pagination / `formatDate`.** All confirmed (`DEFAULT_*` in three files; `calculateLayoutWithEngine` invoked twice in both `print()` and `generatePreview()`; `formatDate` at `:351` reads `new Date()` and uses non-global `.replace`).

## Major strengths

- **Evidence quality.** Claims are tied to specific files and line ranges, and they hold up under independent grep. This is the difference between a plan an implementer trusts and one they must re-derive.
- **Invariants section is the best part.** Print/PDF parity, the `RenderBackend`-only boundary, provider-as-only-data-source, `PaginationEngine` authority, pure `render-shared.ts`, determinism via injected `now`, and coordinate-space (points vs 96-DPI px) discipline are all named and correctly scoped as preserve/strengthen. The "implement once, consume from both paths" framing for the shared header/footer engine is the right architectural move — it removes the divergence by construction rather than patching each path.
- **Scope discipline.** In-scope edit targets vs. named-but-not-edited coupling (`@mog/pdf-layout`, `@mog/pdf-graphics`, app provider files) is explicit, and cross-folder dependencies (backend metadata/outline hooks, `PageSetupInput` carrying gridline/header flags) are flagged rather than silently assumed.
- **Sequencing and parallelization.** The sequential chain (Phase 1 shared module → Phase 2 PDF renderer → parity regression) is correct, and the independent/parallel phases (4 HTML merges, 5 position resolver, 6 perf, 7 number-format) are genuinely independent given the file boundaries.
- **Verification gates are concrete and per-objective**, including a fixture-driven print/PDF parity regression and a barrel-surface contract test. The plan also respects the "no builds/tests run here" constraint while still specifying the gates.
- **Honors the `no-excel-in-code` project memory** as an explicit risk for any authored/moved comments, with the correct "don't mass-rewrite untouched comments" caveat.

## Major gaps or risks

- **The F1/F2 "dead contract" evidence is overstated and partly wrong.** The plan states `differentFirstPage`/`firstPageHeader`/`differentOddEven` etc. are "referenced nowhere else in the repo (grep: only their own definitions plus a date-tagged plan log)." In fact `mog/apps/spreadsheet/.../PrintPreview.tsx:209-212` *produces* these fields (`differentFirstPage: hf?.differentFirst`, `firstPageHeader: …`, `differentOddEven: …`) and hands them to `printHandler`. The render path then drops them — `page-layout.ts` only ever reads `pageSetup.header`/`.footer` (`:244,:266`), never the first/even variants. So the architectural conclusion (no rendering *consumer*; section selection unimplemented) is **correct and verified**, but the framing is wrong in a way that matters: this is *silent data loss of app-supplied input*, a stronger bug than "aspirational types with no producer." It also changes the Phase 3 step-11 cost calculus — "remove from the public surface" would break a live `PrintPreview.tsx` producer, so removal is more expensive than the plan implies and should default to implement-the-selector, not remove.
- **Dangling "Phase 0".** Step 11 and the objective-5 discussion both defer to "the objectives decision in Phase 0 review," but there is no Phase 0 in the plan. The implement-vs-remove decision for F1/F2/E1/E2/E4 is therefore never actually located anywhere an implementer can act on.
- **Unresolved owner decisions block two phases.** Phase 7 (number-format renderer: wire vs. delete) and the F1/F2/E2 implement-vs-remove choice are explicitly punted to "the export owner." That's defensible for a plan, but it means Phases 3 and 7 are not start-ready; the plan should at least commit to a recommended default per item (it does for some) and note who decides and by when.
- **Phase 3 value-without-backend is thin.** Doc-properties and bookmarks depend on `@mog/pdf-graphics` `RenderBackend` additions this plan can't make. The "ship plumbing with one well-named not-yet-wired seam" approach is reasonable, but plumbing that emits nothing has near-zero user value until the Rust backend lands; the plan would be cleaner to defer Phase 3 entirely behind the backend work rather than build a dead seam.
- **Minor location slip.** The barrel is `src/index.ts` (verified), but the scope section files it under "Contracts (`contracts/`): … the barrel `index.ts`," and `contracts/` actually contains only `types.ts`. The line citations (`index.ts:48-56`) point at the root barrel, so this is cosmetic, but it should be corrected.
- **Feature visibility depends on un-edited app wiring.** Gridlines, row/col headers, and real header/footer content only become visible once the app provider (`use-pdf-export.ts`, `ViewportTableDataProvider.ts`) supplies `getPageSetup()`/`getMergedRegions()`/gridline color. The plan flags this honestly, but the headline objectives (1–4) can land green in unit tests while the user-visible feature stays off until cross-folder work the plan doesn't own is also done. The "highest value" framing should acknowledge the parity win is gated on that app wiring.

## Contract and verification assessment

- **Contract clarity is high.** The plan treats `contracts/types.ts` + the barrel as the public surface, correctly flags barrel removals as breaking changes, scopes new provider needs as *optional* methods with safe fallbacks (the right call for the provider-only invariant), and keeps shared header/footer logic unit-agnostic to respect the points-vs-px split. The one weakness is the F1/F2 framing above, which feeds an incorrect "safe to remove" intuition.
- **Verification gates are well-matched to the changes**: per-phase unit tests (placeholder/section/format-code parsing with injected `now`; `drawTextRuns` band coordinates; gridline/label counts; merge colspan/rowspan + page-break clipping; position-resolver hidden-aware + clip-warn; an O(rows+cols) vs O(rows×cols) provider-call-count spy; defaults-derivation), plus a fixture-driven parity regression asserting identical `pageCount` and matching per-page header/footer text, plus a barrel surface test. These are the right gates and are specific enough to implement.
- The plan appropriately declines to run builds/tests and instead enumerates the gates a follow-on implementation must pass, which fits the constraint set.

## Concrete changes that would raise the rating

1. **Correct the F1/F2 evidence.** Reframe as "app produces these via `PrintPreview.tsx:209-212` but the render path (`page-layout.ts:244,266`) silently drops them — a data-loss bug," and change the Phase 3 default for F1/F2 from "implement or remove" to "implement the section selector" since a live producer exists. Note that removal would break `PrintPreview.tsx`.
2. **Add the missing Phase 0** (or relocate the decision): a short up-front "decide implement-vs-remove for F1/F2, E1 metadata, E2 bookmarks, E4 format codes, and number-format renderer" gate with a named owner, so Phases 3 and 7 are unblocked.
3. **Commit to a default for Phase 7** number-format renderer (the plan recommends "wire it" — make that the plan-of-record with the provider supplying the format string, and specify the fallback if the provider can't).
4. **Re-scope Phase 3** to "blocked on `@mog/pdf-graphics` backend hooks; do not build emitting-nothing plumbing until the backend lands," and split it out of the critical path explicitly (the plan already leans this way — make it the decision).
5. **Fix the barrel location** description (`src/index.ts`, not under `contracts/`).
6. **State the app-wiring dependency in the objectives**, so reviewers understand objectives 1–4 are unit-testable in this folder but user-visible only after the provider work in `mog/apps/spreadsheet` (not owned here) is done.
