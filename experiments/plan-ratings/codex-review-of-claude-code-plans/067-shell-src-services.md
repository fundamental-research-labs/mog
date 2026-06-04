Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It correctly treats `shell/src/services` as an orchestration layer rather than a place to rework kernel document internals, and most of its findings are backed by concrete code evidence: the raw-prefix path containment check, global save mutex, throwing `attachSidecar` contract, duplicated document-open machinery, unsafe `disposeAll` failure behavior, process-global lifecycle provider clearing, test mock barrel export, duplicated `generateFileId`, and direct `Date.now()` usage are all real issues in the current tree.

The plan is strongest where it names invariants that must survive implementation, especially the document identity invariant, generation/abort protocol, per-file operation chain, collaboration fences, and live-read lifecycle-state contract. It also has a useful phased structure and acknowledges cross-folder dependencies instead of pretending all fixes are isolated to the service folder.

The rating is not higher because several objectives still need sharper contracts before implementation. The plan sometimes says "wire or remove" where the current public/action-handler contract already makes one option much more likely, and some security and recovery fixes do not specify the exact ownership changes needed to make the invariant true.

Major strengths

- Evidence quality is high. The plan cites specific files and behaviors, and spot checks against `project-service.ts`, `create-document-manager.ts`, `shell-service.ts`, `lifecycle-state.ts`, and `imported-pivot-metadata.ts` confirm the main defects.
- The plan focuses on production paths, not test harnesses. The path containment, save serialization, document-open cache validation, disposal, lifecycle registry, and action-facing shell facade all sit on real user workflows.
- Architectural framing is mostly right. It preserves the "smart service, dumb store" split, keeps `ProjectIpc` as the platform boundary, keeps `DocumentManager` as the owner of the open-document set, and avoids changing trap recovery or capability semantics unnecessarily.
- The plan identifies complete categories rather than isolated symptoms. For example, it expands the path problem from one bad `startsWith` check to all file operations, and expands open-mode validation from collaboration-only checks to the normal load/create paths.
- Sequencing is thoughtful. Running cache-option recording before extracting `openPipeline` is the right order, and calling out `create-document-manager.ts` as a sequential hotspot is important because the abort protocol is easy to regress.

Major gaps or risks

- Phase 2 needs a firmer save ownership contract. `apps/spreadsheet/src/actions/handlers/ui/file-handlers.ts` already writes through `PlatformFileHandle` directly for SAVE and EXPORT, while `ProjectService.saveFile` writes through `ProjectIpc`. The plan correctly sees a disconnected handle map, but "wire it or remove it" is too loose because `ShellService`, `ShellDocumentState`, and action-handler tests already depend on handle persistence. The plan should define whether `ProjectService.saveFile` remains a desktop/project-path save API, whether action handlers remain the handle-based save path, or whether all saves are unified behind one shell facade method.
- Path containment needs stricter input contracts. The plan says canonicalize and compare segment boundaries, but should explicitly require validation of `renameFile`'s computed `newPath`, rejection or sanitization of `newName` containing separators or `..`, validation of `createSpreadsheetInFolder`, `createFolder`, and `importFiles` target directories, and a clear stance on symlink/realpath escapes. A string-only normalizer fixes prefix siblings and lexical `..`, but it cannot prove filesystem containment when symlinks are involved unless the IPC layer participates.
- The `disposeAll` fix is underspecified relative to current implementation. `disposeDocument` deletes `documents` and `hostAdapters` before awaiting `disposeLoadedResources`, so `disposeAll` cannot retain failed entries merely by changing its own cleanup after `manager.disposeDocument()` rejects. The plan should explicitly require changing the single-document disposal order or adding an internal disposal helper that removes map entries only after successful teardown.
- Imported-pivot relocation is directionally right but still speculative. The plan assumes a clean import/host seam and a shared XLSX/ZIP utility are available. It includes a blocked-evidence note, which helps, but the phase should first define the target owner package, returned metadata contract, diagnostics contract, and dependency direction. Otherwise this could turn into a cross-package parser migration without a verifiable acceptance boundary.
- Cache-hit option validation needs an exact compatibility model. Comparing `kind` and `csvOptions` is straightforward, but `operation`, `documentId`, and `workbookLinkResolver` need a stable signature or intentionally non-comparable treatment. The plan should specify which options participate in identity, which are creation-only, and what error is thrown for mismatches.
- Observability is too broad for the rest of the plan. A shell diagnostic helper is reasonable, but Phase 9 spans document manager, trap recovery, project restore, recency, recent-docs, registry, and audit log. It needs a minimal contract for event names, payload shape, and test expectations; otherwise it risks becoming a cosmetic console replacement.

Contract and verification assessment

The contract section is one of the plan's best parts. It names the load-bearing invariants that an implementer must preserve, especially `handle.documentId === fileId`, the generation/dispose abort protocol, collaboration mode fences, live lifecycle-state reads, and lazy capability expiry semantics. That substantially lowers implementation risk.

Verification is good but not complete. The listed unit suites are relevant, and the new regression tests cover most local defects. The plan should add exact commands, such as the package-level `@mog/shell` Jest target and `pnpm --filter @mog/shell typecheck` or the repo's equivalent. Because Phase 2 touches action-facing save behavior, it should include the spreadsheet file-handler tests and a real UI save/open smoke path if behavior changes. Because Phase 4 and Phase 2 touch `@mog-sdk/types-document` contracts, it should include the `types/document` type/build gate and downstream action-handler typecheck. If any Tauri IPC contract changes are made for path canonicalization or handle-backed saving, the corresponding Rust/desktop command verification should be named too.

Concrete changes that would raise the rating

- Replace Phase 2's "wire or remove" branch with a chosen save architecture and acceptance tests for both `ProjectService.saveFile` and action-handler SAVE/EXPORT. Define how `lastSaved`, `isModified`, display name, and handle persistence are updated in each path.
- Specify a path-containment contract that covers `oldPath`, computed `newPath`, `newName`, folder creation, spreadsheet creation, import target directory, mixed separators, Windows drive/UNC paths, and symlink/realpath behavior.
- Amend the `disposeAll` phase to change the underlying disposal primitive so failed resources remain reachable after a rejected dispose.
- Turn the imported-pivot relocation into an investigation-first contract: target package, API shape, diagnostics behavior, parser utility, and dependency direction before implementation.
- Define cache-option compatibility precisely, including what to do with non-serializable options like `workbookLinkResolver`.
- Replace vague static gates with exact package commands and add cross-package verification for `types/document`, spreadsheet action handlers, and any IPC/Rust changes.
