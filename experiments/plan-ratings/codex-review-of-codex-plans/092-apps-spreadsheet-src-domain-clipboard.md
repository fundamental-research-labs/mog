Rating: 8/10

Summary judgment

This is a strong, production-aware plan for a high-risk folder. It correctly identifies that clipboard behavior is split across app-local payload helpers, actor `ClipboardData`, the grid-editing machine, native clipboard hooks, action handlers, infra parser/export utilities, unified paste routing, and the kernel clipboard service direction. The proposed direction - one transfer envelope around the existing public actor data, one capture/export path, one external importer, one router/host boundary, and a paste write planner reused by preview and execution - fits the actual shape of the code and addresses systemic drift rather than isolated bugs.

The rating is not higher because the plan is still more of a complete architectural map than an executable contract. It names many new types and helpers, but it does not pin their fields, ownership rules, compatibility adapters, phase boundaries, or deletion criteria tightly enough for several parallel workers to compose without re-litigating key decisions. For a clipboard refactor spanning user activation timing, browser clipboard permissions, actor contracts, compute-core `copyRange`, kernel clipboard migration, native paste events, and E2E UI flows, those missing contracts are the main residual risk.

Major strengths

- The plan is grounded in the production path. It calls out the real duplication between `actions/handlers/clipboard.ts` and `hooks/editing/use-clipboard.ts`, the separate `infra/utils/clipboard-utils` parser/export path, the machine-local external parsing, the exported but mostly non-authoritative `ClipboardService`, and the preview/executor drift risk.
- It protects the most important behavioral invariants: synchronous system clipboard write reservation, stale system clipboard winning over rich internal data, canceled-signature suppression, image-only routing, cut single-use semantics after successful commit, sparse/full-shape geometry, and compute-core `copyRange` as the preferred internal formula-rebasing path.
- The scope is appropriately systematic. It does not propose fixing only HTML parsing, only signatures, or only paste preview. It recognizes that clipboard correctness depends on capture, serialization, import, routing, planning, execution, preview, actor state, and browser event behavior staying aligned.
- Verification expectations are unusually good. The plan asks for codec, contract, capture, router, paste plan/executor, machine/integration, and browser E2E coverage, and it explicitly requires real UI input paths for E2E tests.
- The parallelization notes are practical. The proposed worker boundaries map to natural seams in the codebase and include the integration worker needed to prevent parallel sub-results from becoming disconnected abstractions.

Major gaps or risks

- The new transfer model is not specified at field level. Names like `SpreadsheetClipboardTransfer`, `ClipboardSystemFormats`, `ClipboardGeometry`, `ClipboardSignatureSet`, and `ClipboardPasteIntent` are directionally right, but the plan should define the exact fields, required/optional status, normalization rules, versioning, and mapping to actor `ClipboardData` and app-local `ClipboardPayload`.
- The plan says not to add a third unowned runtime representation, but the proposed envelope could become exactly that unless ownership is made explicit. It needs a hard rule for which representation is stored in actor state, which exists only transiently, and which public package owns any exported contract.
- Sequencing is broad enough to create migration risk. A safer plan would define phase gates such as: add pure codecs and invariant assertions first; introduce adapters with old behavior preserved; migrate one copy path; migrate one paste path; replace machine parsing; align preview; then delete old utilities. Each phase should have acceptance tests and rollback boundaries.
- The router/host plan needs sharper event semantics. Native `ClipboardEvent.clipboardData`, keyboard/action paste, toolbar/context-menu paste, edit-mode deferral, `preventDefault`, image files, `navigator.clipboard.read`, `readText`, and read-denied fallback all have different browser constraints. The plan identifies them, but not the exact host API return shape or precedence table.
- The paste write plan needs transactional and failure semantics. It should specify whether validation/protection blocks are preflight or applied during execution, how undo grouping is represented, what happens if secondary payload application fails after core `copyRange`, and when cut data is consumed or retained.
- HTML import/export security and fidelity policy is under-specified. DOMParser is not script-executing, but the importer still needs explicit rules for dropping unsafe URLs/styles, preserving hyperlinks, handling formula-looking text, mapping number formats, and ignoring unsupported CSS without creating misleading formats.
- Performance budgets are mentioned only generally. The plan should define size limits, asymptotic expectations, and fixture strategies for large TSV/HTML, sparse full-column/full-row selections, signatures, and preview calculation.
- Coordination with the kernel clipboard service is correct but still ambiguous. The plan should state which service is authoritative in each migration phase and how payload versions, stale state, and cut lifecycle are asserted when both spreadsheet actor state and kernel clipboard service exist.

Contract and verification assessment

The contract thinking is the best part of the plan, but it needs to move from invariant list to executable specification. The geometry, signature, source-kind, source-range, system-format, and paste-intent invariants should become concrete type definitions plus assertion helpers that are used on every boundary: capture result creation, external import result creation, machine storage, router decisions, paste plan build, and preview build.

Verification gates are strong and production relevant. The focused `@mog/app-spreadsheet` tests, typecheck, public API checks when actor contracts change, and browser pass are appropriate. The plan also correctly says E2E must use real keyboard/mouse/clipboard paths. To be fully verifiable, it should add phase-specific gates and require at least one regression fixture per external source class: Excel HTML, Google Sheets HTML, browser table HTML, plain TSV, CSV, image-only clipboard, and mixed image plus text.

Concrete changes that would raise the rating

- Add exact TypeScript sketches for the new transfer, geometry, signature, import result, capture result, host read result, and paste write plan types, including ownership and lifecycle notes.
- Add a routing precedence table covering internal fresh copy, internal cut, stale internal data, changed system text, changed system HTML, suppressed text, read failure, empty clipboard, image-only, and mixed image/text/html payloads.
- Split implementation into explicit migration phases with acceptance tests and deletion criteria for old parser/export/router/service paths.
- Define transaction semantics for paste planning and application: preflight checks, core `copyRange` eligibility, secondary payload ordering, undo grouping, partial failure handling, and cut consumption timing.
- Specify security and fidelity policy for HTML import/export, including unsupported styles, hyperlinks, formulas, number formats, unsafe URLs, large cells, malformed tables, rowspan/colspan, and surrogate-pair truncation.
- Add performance budgets for large text/HTML parsing, signatures, sparse full-shape exports, and preview generation.
- Make kernel clipboard coordination phase-specific, with one authoritative freshness/version owner per phase and tests proving no split-brain clipboard state.
