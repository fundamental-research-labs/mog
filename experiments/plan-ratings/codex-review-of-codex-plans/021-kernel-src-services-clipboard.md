Rating: 8/10

## Summary judgment

This is a strong, production-aware plan. It correctly recognizes that `mog/kernel/src/services/clipboard` is currently a small per-document state service, while real clipboard behavior is spread across the app API bridge, spreadsheet grid-editing machine, spreadsheet clipboard domain, native browser clipboard events, and system clipboard reads/writes. The plan is especially good at naming behavioral contracts: reusable copy, cut single-use after successful paste, stale detection, text/html signatures, immutable payload snapshots, rectangular payload validation, and real UI clipboard E2E paths.

The rating is not higher because several key decisions are deferred instead of specified. The plan says to choose one canonical public contract, introduce a host port, and migrate duplicated spreadsheet/app behavior, but it does not define the exact contract shape, exact package ownership, exact port semantics, or exact cutover protocol. It also misses some important existing contract surfaces that are in the production path today, especially `contracts/src/actors/clipboard.ts`, `types/machines/src/actors/clipboard.ts`, duplicated clipboard selectors, `domain/clipboard/unified-paste.ts`, and object/chart clipboard paths.

## Major strengths

- The current-state diagnosis is accurate. The kernel service stores payload, operation, stale state, and paste lifecycle, but does not parse external data or own system clipboard I/O. The app API bridge currently writes `text/plain` directly through `navigator.clipboard.writeText`, hard-codes `source.viewType: 'kanban'`, synthesizes `col-${i}` IDs, and drops rich fields. The spreadsheet machine and domain clipboard modules own richer production behavior.
- The plan is correctly aimed at production behavior, not a test-only harness. It explicitly calls out native clipboard timing, keyboard/browser clipboard paths, app capability boundaries, headless fallback behavior, and spreadsheet integration gates.
- The invariants are high quality. Session-tokened paste completion, immutable `getPayload()`, rectangular cells, table-context dimensional consistency, source metadata preservation, HTML-first external paste, independent read/write grants, and no app dependency from kernel are the right kinds of contracts.
- The sequencing is plausible: canonical contract and pure normalizers first, kernel internals second, app/spreadsheet migration third, duplicate deletion after production paths move.
- The parallelization notes are useful and align with the repo's development model. Contract, kernel, codec, app API, spreadsheet integration, and E2E workers are separable if the contracts are nailed down first.

## Major gaps or risks

- The contract inventory is incomplete. It lists several relevant files, but omits `contracts/src/actors/clipboard.ts`, `types/machines/src/actors/clipboard.ts`, `kernel/src/selectors/clipboard.ts`, `apps/spreadsheet/src/selectors/clipboard.ts`, `apps/spreadsheet/src/domain/clipboard/unified-paste.ts`, action-handler copy/cut/paste paths, `rangeToTSV`/`rangeToHTML`, chart clipboard, and floating object/image clipboard behavior. Those are not peripheral; they are production paste routing and UI state contracts.
- "Choose one canonical public payload contract" is the most important decision and remains undecided. The plan should specify the package, exported names, import direction, field types, versioning, session IDs, readonly/deep-freeze semantics, and whether the canonical payload is cell-only or a discriminated union that can also represent images, floating objects, charts, and external-only formats.
- The host clipboard port is underspecified. Browser clipboard writes currently need user-activation-sensitive reservation with promised blobs, while paste may arrive through either `ClipboardEvent.clipboardData` or `navigator.clipboard.read()`. The plan needs an exact `ClipboardHostPort` API, error model, capability model, and distinction between event-sourced paste data and async navigator reads.
- Kernel and codec ownership is not fully resolved. The plan says to add pure helpers in the kernel folder, but also to extract TSV/CSV/HTML/style codecs into a lower public layer. It should decide where DOM-dependent HTML parsing, format mapping, external spreadsheet quirks, and image MIME routing live so the kernel stays browser-safe and app-independent.
- The migration has a dual-authority risk. Today the spreadsheet clipboard machine keeps `data`, `viewData`, stale flags, suppressed signatures, marching ants, preview state, paste options, and kernel delegation. The plan says the kernel becomes primary storage but does not define the interim invariant, adapter mapping, divergence detection, or how `PASTE_COMPLETE`, `CLEAR`, and suppressed text signatures stay coherent across both machines during migration.
- Capability gating is asserted but not specified. The plan should say which API layer enforces `clipboard:read` versus `clipboard:write`, what a write-only snapshot exposes, and how subscriptions are filtered.
- Format transfer coverage is ambitious but still not mapped to the existing paste executor contract. It lists many format categories, but does not tie each one to existing `ClipboardData`, `PasteSpecialOptions`, worksheet APIs, unsupported cases, or roundtrip fixtures.

## Contract and verification assessment

The plan has excellent behavioral intent, but it is not yet an executable contract. The invariant list is strong enough to guide implementation, but implementers would still need to invent the canonical type schema, host-port interface, payload/version/session identity model, and deletion map. That is where parallel agents can diverge.

The verification section is above average. It includes kernel state-machine tests, normalization/property tests, codecs, app API permission tests, spreadsheet integration tests, and browser E2E tests using real keyboard and clipboard input paths. The main weakness is that the gates are not exact enough. It should name concrete package commands such as the kernel and spreadsheet package test/typecheck scripts, public API publish-readiness checks for contract exports, and the specific E2E scenario files or tags expected to cover native copy/cut/paste, external HTML, paste special, image-only paste, and cut retry after paste error.

## Concrete changes that would raise the rating

1. Add the actual canonical contract draft to the plan: package path, exported type names, discriminated payload/read-result shape, payload version/session fields, source metadata, signatures, capabilities, and readonly/mutability semantics.
2. Expand the inventory into a deletion/migration table covering actor contracts, selectors, unified paste, action handlers, native event hook, spreadsheet domain codecs, app API bridge, chart/object clipboard, and existing tests.
3. Define `ClipboardHostPort` precisely, including `write` with promised `text/plain`/`text/html` blobs, event clipboard data ingestion, async `read`, image MIME handling, Tauri/headless implementations, and error/capability reporting.
4. Specify the kernel-vs-codec boundary so HTML parsing and browser globals cannot leak into kernel service logic, while shared codecs remain below apps and shell.
5. Add a dual-authority cutover contract: for each migration phase, identify the source of truth, mirrored state, allowed divergence, session-token behavior, clear/cut completion propagation, and the tests that prove old spreadsheet paths no longer own rich storage.
6. Replace generic verification gates with exact commands and fixture/scenario names, including public API snapshot or publish-readiness checks when exported clipboard contracts change.
