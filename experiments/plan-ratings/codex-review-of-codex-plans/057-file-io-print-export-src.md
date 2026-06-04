Rating: 8/10

Summary judgment

This is a strong architectural plan for `file-io/print-export/src`. It correctly treats print/PDF export as a production contract problem, not a renderer whack-a-mole problem, and it is well grounded in the actual package shape: duplicate `PdfExportResult` names exist, `SpreadsheetPdfExporter.export()` returns only page metadata/warnings, the app hook speculatively casts for `blob`/`bytes`/`dataUrl`, `use-pdf-export.ts` still maps cells mostly via `String(value)` with empty format, print settings conversions are duplicated in app UI/grid code, browser print recalculates pagination, and PDF renderer color units are mixed across modules/tests.

The rating is not higher because the plan is closer to an epic-level architecture document than an implementation-ready contract. It names most of the right targets, but several cross-package boundaries, missing upstream APIs, and migration acceptance criteria need to be made sharper before parallel implementers can land changes without overlap or incompatible type shapes.

Major strengths

- The plan has the right top-level direction: make `@mog/pdf-layout` the pagination source of truth, define one canonical job model, and consolidate print preview, browser print, page-break preview, and PDF export around the same sheet/job contracts.
- It preserves package boundaries correctly. `@mog/print-export` stays public and independent of app internals, while app adapters are allowed to translate workbook/kernel state into print-export contracts.
- It identifies real production-path gaps rather than test-only gaps: incomplete app provider mapping, missing PDF artifact ownership, duplicated print setting conversion, double pagination passes, floating-object coordinate ambiguity, and per-cell merge/hidden lookup costs.
- The invariants section is unusually useful. It specifies render order, unit boundaries, inclusive vs half-open range conversion, escaping obligations, hidden row/column behavior, and failure semantics for unsupported PDF backends.
- Verification coverage is broad and mostly production-relevant: package tests, app hook tests, Rust bridge tests, browser UI exercises through Backstage/Print Preview, and performance checks through the real app path.
- The parallelization notes are practical after the core contracts are specified. They separate job/result contracts, app adapter work, PDF finalization, unit normalization, pagination planning, object positioning, renderer integration, header/footer work, render-plan indexing, and UI verification.

Major gaps or risks

- The plan needs an explicit first deliverable that freezes the actual TypeScript contracts. `PrintExportJob`, `SheetPrintJob`, `ResolvedPageSetup`, warning unions, artifact result unions, unit aliases, range conventions, and adapter input/output interfaces should be written as a contract spec before implementation agents start.
- The adapter boundary remains too ambiguous. It says the shared adapter can live in the app layer or in `print-export` if it only depends on public contracts, but this choice controls dependency direction, test fixtures, and replacement of `ViewportTableDataProvider`. The plan should choose one target boundary and state what app-only APIs are allowed there.
- Missing upstream APIs are treated correctly as blockers in principle, but not enumerated as concrete dependency tickets. Formatted display values, resolved cell styles, chart rasterization, drawings/images, conditional formatting results, sparklines, checkbox/form control state, comments policy, and header/footer images each need an owner API, expected shape, and fallback warning contract.
- The current `ws.print.getArea()` public API returns a string/null in the kernel implementation, while some app code casts it to a structured range. The plan should explicitly require a canonical parser or typed worksheet API for print areas instead of assuming a structured object is already available.
- PDF artifact finalization is the highest-risk cross-package change, but the plan presents two possible designs. It should select a preferred discriminated result contract, define cancellation/error cleanup semantics, and name the exact bridge/runtime ownership before work begins.
- Sequencing is broad but not acceptance-driven. Each phase should have a "done when" condition, a compatibility policy for existing exports, and a required integration test proving the new contract is actually used by the app path.
- Some goals are very large for one implementation stream: job model, app adapter consolidation, PDF byte finalization, color/unit normalization, object positioning, header/footer parity, render-plan indexing, and UI E2E. This is parallelizable, but only if contract owners land stable interfaces first.
- The plan should call out public API compatibility more explicitly. Re-exported types from `index.ts` and the duplicate `PdfExportResult` collision can break consumers; migration names and deprecation/removal behavior need to be specified.

Contract and verification assessment

The contract quality is high at the invariant level but incomplete at the API-shape level. The plan names the right contracts and invariants, especially around `@mog/pdf-layout`, PDF artifact ownership, range semantics, units, warnings, and adapter responsibilities. It should raise those from prose into exact discriminated unions and adapter interfaces before implementation.

The verification plan is strong and production-oriented. It includes relevant package gates, app type/test gates, Rust PDF core gates, browser UI verification through real user paths, and performance verification through the production export/preview path. The main missing piece is phase-specific verification: implementers need to know which focused tests prove each migration step before later phases exist. The plan should also require one cross-format fixture that asserts browser-print page slices and PDF page slices are generated from the same `SheetPrintJob`.

Concrete changes that would raise the rating

- Add a Phase 0 contract spec with exact TypeScript definitions for job/result/warning/unit/range/adapter types, including examples of success, unsupported backend, cancellation, partial-with-warnings, and empty sheet outcomes.
- Choose the adapter boundary now: either an app-owned `print-export-adapter.ts` with workbook dependencies, or a public contract-only adapter package. State all allowed imports and all call sites it will replace.
- Split upstream data dependencies into named prerequisite tasks with owner APIs and warning behavior for each missing data category: formatted values, resolved styles, objects, CF, sparklines, comments, checkboxes, and header/footer images.
- Define the PDF artifact lifecycle as one selected design, not alternatives, with begin/finalize/error/cancel cleanup semantics and a single exported result type.
- Specify a typed print-area parser/API migration so `ws.print.getArea()` string values cannot keep leaking into structured range consumers through casts.
- Add phase-by-phase acceptance gates: contract tests first, adapter tests second, artifact finalization tests third, app hook/UI tests after the production path consumes the new contracts.
- Include a public API migration note for the duplicate `PdfExportResult` names, including final exported names, compatibility/deprecation behavior, and expected import changes.
