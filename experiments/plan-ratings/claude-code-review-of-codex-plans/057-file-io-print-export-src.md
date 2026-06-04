Rating: 8/10

# Review of Plan 057 — File I/O Print Export Source

## Summary judgment

This is a strong, evidence-grounded plan. I independently verified its core diagnostic claims against the live source in `mog/file-io/print-export/src` and the adjacent app hooks, and they are accurate — not hand-waving. The plan correctly identifies the most important structural defects in this package: a genuine duplicate-name `PdfExportResult` collision, a missing PDF artifact finalization path that the app papers over with speculative casting, a double pagination pass in `PrintHandler`, raw `String(value)` cell mapping that bypasses the formatting engine, and stubbed floating-object/CF/sparkline providers. The objectives, invariants, and verification gates are coherent and well-sequenced. The plan loses points for scope ambition that risks being unschedulable as a single unit, some under-specified contract shapes (it describes the union members but not the field-level types), and a few places where it defers hard dependency decisions ("once those APIs are exposed") without committing to who unblocks them.

## Evidence checked

- `src/pdf/exporter.ts:201` defines `interface PdfExportResult { pageCount; warnings }`; `src/contracts/types.ts:360` defines a **different** `interface PdfExportResult extends PrintResult { blob?; dataUrl? }`. Both flow through `index.ts` (named export + `export *`). The plan's claim of two conflicting result types is correct and material.
- `exporter.ts:472` returns `{ pageCount, warnings }` only — no bytes/blob. `create-exporter.ts:26` just news up the exporter with no document-finalization wiring. The "artifact gap" is real.
- `apps/spreadsheet/.../use-pdf-export.ts:261` defines `DownloadablePdfResult = PdfExportResult & { blob?; dataUrl?; bytes? }` and probes all three at runtime — exactly the "app guesses" anti-pattern the plan calls out.
- `use-pdf-export.ts:162` maps `displayValue: String(value)`; the file's own comments admit charts/drawings/CF/sparklines "return stubs." Matches the plan.
- `print-handler.ts:147` then `:161` calls `calculateLayoutWithEngine` twice (once to sum `totalPages`, once to render). The double-pass claim is correct; `generatePreview` (`:610`) repeats the pattern.

This level of corroboration is the plan's biggest credibility asset.

## Major strengths

- **Diagnostically accurate.** Nearly every concrete defect cited is verifiable in the tree. That earns trust in the parts I did not exhaustively check.
- **Strong boundary discipline.** The package-boundary invariants (no `mog-internal` dep, no React/app-internal imports, `@mog/pdf-layout` stays format-agnostic, `@mog/pdf-graphics` stays backend-oriented) are explicit and correctly placed. This is exactly the contract clarity a reviewer wants.
- **Single-source-of-truth framing.** Collapsing four duplicated conversion sites (`PrintPreview`, `SpreadsheetGrid`, `use-print`, `use-pdf-export`) into one job model + one adapter is the right architectural move and is stated as a testable invariant ("same `SheetPrintJob` for the same workbook state").
- **Verification gates are specific and runnable.** Per-package `pnpm test`/`typecheck`, Rust `cargo test/clippy -p pdf-core`, plus real-UI E2E through Backstage/Print Preview with a "no direct state mutation" rule. The insistence that performance be measured on the production path, not mocks, is a notable quality signal.
- **Honest about dependency blockers.** It explicitly forbids "silent empty stubs" and demands a typed warning + upstream task when a kernel API is missing — rather than pretending the data exists.

## Major gaps or risks

- **Scope is a multi-week program, not a plan.** Fourteen implementation sections plus ten parallel agents (A–J) spanning print-export, pdf-graphics, pdf-core (Rust), and Tauri runtime. This is closer to an epic than a single executable plan. The "contract work lands first" sequencing helps, but there is no explicit MVP/first-slice cut. A reviewer cannot tell what "done" means for one PR.
- **Contract shapes are named but not typed.** `PrintExportJob`, `SheetPrintJob`, `ResolvedPageSetup`, `CellRenderPlan`, and the `PrintExportWarning` union are described as bullet lists of members, not as field-level TypeScript with types/optionality. The plan asserts "one canonical structure that can lower to points/inches/pixels" without showing the shape — the single hardest design decision is left to the implementer.
- **The cross-boundary artifact work is the highest risk and least specified.** Section 5 offers two designs (bridge lifecycle vs. `PdfDocumentBackend` wrapper) but does not choose. Because this touches Rust `serialize_document_to_bytes` and Tauri command ownership, indecision here blocks Agents C, and transitively the app download path and all E2E. The plan flags this risk but does not resolve the fork — it should pick one and justify it.
- **Floating-object coordinate fix correctness is asserted, not proven.** Section 8 states the current exporter applies margin/scale transforms while `PositionResolver` already includes margins (double-application). This is a plausible and important bug, but unlike the result-type and double-pass claims, I did not see it independently demonstrated in the plan with line evidence. The "preferred contract" (content-space resolver) is reasonable but needs a before/after numeric example to de-risk.
- **Unit/color normalization may be larger than one section.** Auditing 10 renderers for `[0..255]` vs `[0..1]` mixing, plus rewriting tests that "accidentally" relied on the wrong space, is open-ended. Without a current inventory of which files actually mix spaces, the effort is unbounded.
- **Browser-print fidelity caveat undercuts a stated invariant.** The plan wants browser print to render "the same planned pages" as PDF, then admits native print engines apply their own paged-media rules. The reconciliation (emit explicit page containers) is mentioned but the acceptance criterion for "close enough" is undefined.

## Contract and verification assessment

Contract clarity is good at the boundary/invariant level and weak at the type level. The package-import rules, pagination-once rule, inclusive-vs-half-open range ownership, render-order contracts (page-level and cell-level), and the points-as-canonical-unit rule are all crisp and testable. What is missing is the actual interface text for the new job/result/plan types — a plan of this ambition should include at least skeletal `interface` declarations so that ten parallel agents target identical shapes. The explicit split into `PdfRenderResult` vs `PdfArtifactResult` is the correct fix for the collision and is well-argued.

Verification gates are above average. They are concrete, scoped per package, include the Rust and Tauri layers, mandate real-input E2E, and explicitly reject mock-only performance claims and partial-export-as-success. The before/after performance metric list (time-to-first-page, merge lookup count, provider calls, artifact size) is unusually disciplined. The main gap: no gate ties a specific test to the floating-object double-transform fix beyond "tests for objects on …pages," and no gate defines the browser-vs-PDF pagination tolerance.

## Concrete changes that would raise the rating

1. **Add a first-slice / MVP definition.** Identify the minimum landable increment — almost certainly: (a) split the duplicate `PdfExportResult` into `PdfRenderResult`/`PdfArtifactResult`, (b) implement real artifact finalization end-to-end for one backend, (c) remove the `DownloadablePdfResult` speculative cast. Everything else becomes follow-on. This makes the plan schedulable.
2. **Commit to one artifact-finalization design** (bridge `beginDocument/writeContentOps/endDocument` vs. `PdfDocumentBackend` wrapper) and state why, since it gates the Rust/Tauri/app chain.
3. **Inline the actual TypeScript interfaces** for `PrintExportJob`, `SheetPrintJob`, `ResolvedPageSetup`, `CellRenderPlan`, and the full `PrintExportWarning` union — with field types and optionality — so parallel agents cannot diverge.
4. **Prove the floating-object double-transform** with a concrete coordinate example (current resolver output + current exporter transform = wrong final position; proposed = correct), mirroring the rigor used for the result-type and double-pass claims.
5. **Bound the color/unit audit** by listing the files currently known to mix `[0..255]`/`[0..1]` (or stating the audit must produce that inventory as deliverable #1 of Section 6).
6. **Define a browser-vs-PDF pagination acceptance criterion** (e.g., identical page *count* and identical row/col *slices* per page; visual rendering allowed to differ) so the Section 12 "same planned pages" invariant is testable rather than aspirational.
7. **Name the upstream owners** for the missing kernel APIs (charts/drawings/images/CF/sparklines) so the "typed warning + upstream task" path has an actual destination rather than an indefinite deferral.
