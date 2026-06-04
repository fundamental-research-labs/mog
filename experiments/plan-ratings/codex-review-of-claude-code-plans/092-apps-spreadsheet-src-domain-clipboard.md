Rating: 7/10

Summary judgment

This is a technically serious plan with a mostly accurate model of the clipboard folder: it correctly identifies the dense `ClipboardPayload` path, the sparse `ClipboardData` grid-paste path, the formula-aware parser, the large `executePaste` orchestration surface, and the load-bearing `copy_range` fast-path constraints. The preservation list is unusually strong and would help prevent the most dangerous regressions in paste behavior.

The rating is held back because several objectives are not yet anchored to the actual production path. `serializers.ts` and the app-local `ClipboardService` appear to be used only by that service, the barrel, and tests; normal grid copy/paste flows through `unifiedCopy`/`unifiedPaste`, `rangeToTSV`/`rangeToHTML`, and the clipboard machine. The plan partly notices this via Phase 0, but it also states some unverified or false reachability as fact. That makes the plan good as a research-and-refactor proposal, but not yet a crisp implementation contract.

Major strengths

- The plan preserves the critical executor invariants: internal single-range source gating, core copy type selection, format-only guard for `CopyType::All`, skip-hidden/skip-cells exclusions, full-shape unsafe guard, cross-sheet `copy_range` behavior, and phase ordering.
- It correctly treats `ClipboardPayload` and `ClipboardData` as different models rather than forcing a premature model merge.
- The parser objective is well motivated. The current folder really has a formula-aware tokenizer in `clipboard-parser.ts` and an independent `tsvToCells` parser plus `inferValue` in `serializers.ts`.
- The executor decomposition is sequenced last and called out as highest risk, which is appropriate for a 1,330-line paste engine with subtle cross-sheet and validation behavior.
- The test matrix covers important edge cases: formula delimiters, leading-zero preservation, HTML style breakout, image routing, cut lifecycle, transpose metadata offsets, arithmetic semantics, and core fast-path decision tables.

Major gaps or risks

- Production-path reachability is overstated. `ClipboardService` in `apps/spreadsheet/src/domain/clipboard/clipboard-service.ts` is not the same thing as the kernel `IClipboardService` passed through `shell-coordinator`, `actor-manager`, and `clipboard-machine`; the app-local class is exported and tested but does not appear to be what those production paths call.
- The plan says `ClipboardService` is referenced by `shell-coordinator.ts`, `actor-manager.ts`, and `clipboard-machine.ts`, but those files reference kernel clipboard service plumbing or `ClipboardPayload` conversions, not this class's `copyToSystem`/`readFromSystem` methods.
- The HTML sanitization objective misses the main grid copy serializer. Normal grid copy builds HTML through `infra/utils/clipboard-utils.ts:rangeToHTML`, then writes it through `writeToSystemClipboard`; sanitizing only `serializers.ts:cellsToHTML` closes a cross-view/helper path but not the regular grid system-clipboard path.
- Scope is inconsistent. The plan declares out-of-folder files out of scope, then Phase 4 requires updating coordinator callers, and objective 2 requires reconciling `clipboard-machine` external paste typing. Those cross-folder changes may be correct, but the plan needs to explicitly make them in-scope dependencies rather than treating them as coordination notes.
- The inference objective is underspecified for grid paste. Today the clipboard machine builds external `ClipboardData` from parsed strings, so routing it through a shared `inferValue` would be a user-visible behavior change on the primary paste path. The plan should specify the exact resulting `CellValue` contract for external grid paste, not just parity.
- `tsvToCells` contract is ambiguous. If it remains a TSV parser, it should consume `parseTSV`; if it auto-detects CSV through `parseClipboardText`, rename or add a separate `textToCells` API. The proposed CSV test through `tsvToCells` implies a behavior/name mismatch.
- Removing or gating `legacyCopyToClipboard` is low value unless Phase 0 proves the app-local `ClipboardService` is production reachable. Meanwhile `writeToSystemClipboard` already has its own async Clipboard API contract and no legacy fallback.

Contract and verification assessment

The preservation contracts for `executePaste`, cut lifecycle, signature matching, image priority, write activation, and hidden-row defaults are strong and aligned with the source. This is the best part of the plan.

The parser and inference contracts need sharper before/after definitions. The plan should state whether external grid paste should preserve all parsed text as strings, infer booleans/numbers/percentages, or defer coercion to the compute/store layer. Without that, "one inference contract" can accidentally become a broad behavior change hidden inside a cleanup.

The verification gates are directionally right but not executable enough. They list test families and scenarios, but an implementation plan should name the concrete package commands and app-eval/API-eval scenarios to run. It should also state that any E2E clipboard verification must use real keyboard/clipboard/browser input paths, not state-machine shortcuts.

Concrete changes that would raise the rating

- Rewrite Phase 0 as a hard prerequisite with expected outputs: a caller matrix for `ClipboardService`, `serializers.ts`, `rangeToTSV/rangeToHTML`, `parseHTML`, `parseClipboardText`, and `executePaste`.
- Correct the `ClipboardService` reachability claims and decide whether it is production, public API compatibility surface, or dead code. Each path implies a different scope and verification bar.
- Add `rangeToHTML` sanitization or explicitly narrow the security objective to the `ClipboardPayload` serializer. If the goal is security on system clipboard writes, the infra serializer must be covered.
- Define a named external-paste value coercion contract with examples and owners for both `ClipboardPayload` and `ClipboardData`.
- Split `tsvToCells` from auto-detected text parsing: either preserve TSV-only behavior or introduce a clearly named `clipboardTextToCells`.
- Make cross-folder edits explicit when required, especially `clipboard-machine`, coordinator/kernel clipboard service call sites, and infra HTML serialization.
- Replace broad verification labels with concrete commands plus specific app-eval scenarios for copy, cut, paste special, cross-sheet formula rebasing, filtered rows, external HTML/CSV/TSV paste, and image-only paste.
