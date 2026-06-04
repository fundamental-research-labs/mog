Rating: 8/10

Summary judgment

This is a strong, source-aware plan that targets real production editor behavior rather than a test-only cleanup. It correctly identifies the duplicate formula analyzer implementations, the regex-only reference extraction path, the absolute marker bug, metadata cache inefficiencies, and the weak DOM boundary in cursor/selection utilities. The sequencing is mostly sensible: consolidate first, then make the parser/tokenizer changes, then parallelize independent cache, DOM, and completion work.

The rating is not higher because the central tokenizer/reference contract is still underspecified. The plan says "one formula grammar" and "grammar-correct," but does not pin the exact token API, supported reference forms, metadata inputs needed for name disambiguation, or the compatibility story for consumers that only understand `FormulaRangeReference`. Several acceptance criteria are descriptive rather than executable, and the verification gates name broad suites without exact package commands or required app-eval scenarios.

Major strengths

- The plan is grounded in the actual production path: `InlineCellEditor`, `FormulaBarContainer`, renderer coordination, range-drag handlers, formula auditing, and the editor machine all depend on this behavior.
- The duplicate-source problem is real and high value. The current `domain/editor` and `systems/shared/utils` formula context/range parser files are identical while consumers import both paths.
- It preserves important published contracts: named exports, `FormulaRangeReference` shape, end-exclusive positions, color cycling, metadata cache snapshot semantics, WeakMap identity, and idempotent disposal.
- It does not stop at the first bug. It groups related issues into systematic coverage: string literal handling, structured references, absolute marker parsing, A1 conversion duplication, metadata cache lifecycle, viewport injection, and rich-text selection cost.
- The phase order is mostly safe. Phase 1 reduces divergence before deeper parser work; Phases 4-6 are correctly identified as mostly independent after import consolidation.
- The test plan covers existing pinned behavior and adds meaningful regression cases for string literals, mixed absolutes, metadata error retry, host injection, and selection round trips.

Major gaps or risks

- The tokenizer contract needs a precise spec before implementation. It should define token types, fields, normalization rules, start/end offsets, error recovery, quoting/escaping behavior, and whether tokens carry parsed coordinates or only raw spans.
- "Named ranges shaped like cell refs (e.g. Q1)" is not established as a current valid production case. The named-range validator rejects A1-like names, and table-name validation rejects A1-like names. If API/import paths can still create such names, the plan should cite that path and define how metadata reaches a pure extractor; otherwise this example should be removed.
- The plan says structured/named references should "optionally" surface as highlightable spans, which weakens the objective. Consumers need an explicit compatibility contract: either keep `extractFormulaRanges` cell/range-only and add a new richer extraction API, or extend the existing shape with discriminants in a backward-compatible way.
- The A1 utility dependency is vaguer than necessary. `@mog/spreadsheet-utils/a1` already exposes `colToLetter`, `letterToCol`, `parseCellAddress`, `parseCellRange`, and sheet-name quoting, while `@mog-sdk/contracts/core` already has `MAX_ROWS` and `MAX_COLS`. The plan should specify whether to reuse and harden that package or move a subset into contracts, and account for current bounds gaps in some A1 parsing paths.
- "Grammar-correct" is too broad for the non-goals listed. Full-column/row refs, quoted sheet names with embedded apostrophes, 3-D refs, and R1C1 should each be explicitly accepted, rejected with tests, or deferred with a documented user-visible limitation. Today they are mixed between "edge cases" and "non-goals."
- Metadata invalidation semantics are internally fuzzy. It asks to coalesce bursts while preserving per-event version bumps and idle/null snapshots "or document" changed semantics. That choice affects subscribers and should be decided in the plan, not left to implementation.
- The DOM-boundary phase should name the host abstraction shape. For example, a `SelectionHost`/`ViewportHost` with `getSelection`, `createRange`, `createTreeWalker`, and viewport dimensions would make SSR, iframe, and shadow-root behavior testable.

Contract and verification assessment

The plan does a good job listing invariants, especially around pure analyzer determinism, exported names, `FormulaRangeReference` offsets, `updateFormulaReference` cursor position, metadata cache snapshots, and rich-text clamping/no-throw behavior. Those are the right contracts to preserve.

The weak point is the new contract surface. A tokenizer-backed implementation can easily break consumers if token classification, active-reference selection, structured references, and named references are not specified as public behavior. The plan should add a pre-implementation contract section with example inputs and exact outputs for ordinary A1 refs, sheet-qualified refs, quoted sheets, string literals, structured refs, full-row/column refs, invalid refs, and formulas with incomplete syntax while the user is typing.

Verification is directionally good but should be made executable. For this TypeScript area, the plan should name commands such as `pnpm --filter @mog/app-spreadsheet test -- formula-context formula-range-parser formula-metadata-cache`, relevant editor-machine tests, `pnpm --filter @mog/app-spreadsheet typecheck`, and repo-level `pnpm typecheck` when public/shared package surfaces change. UI/app-eval gates should identify the concrete scenarios for inline editing, formula-bar highlighting, drag-to-edit, autocomplete, and rich-text caret restore, and should state that E2E coverage must drive real keyboard/mouse/clipboard paths.

Concrete changes that would raise the rating

- Add a tokenizer API contract with a table of exact token streams for representative formulas, including cursor-in-progress cases and malformed/incomplete formulas.
- Decide whether structured/named references extend `extractFormulaRanges` or require a new richer API, and document the migration path for every listed consumer.
- Replace the `Q1` named-range example with evidence from a real import/API bypass path, or remove it and focus on valid ambiguity cases.
- Specify the A1 utility owner: reuse/harden `@mog/spreadsheet-utils/a1` versus moving a minimal parser/formatter to contracts, including bounds validation requirements.
- Turn the metadata coalescing behavior into one clear contract with version/subscriber expectations.
- Add exact verification commands and exact app-eval scenario names, including a browser exercise for UI-visible editor behavior.
- Add acceptance criteria for all formula reference forms that are accepted, rejected, or explicitly deferred, so "grammar-correct" is measurable.
