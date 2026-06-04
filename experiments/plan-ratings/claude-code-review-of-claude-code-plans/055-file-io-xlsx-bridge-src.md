Rating: 8/10

# Review of Plan 055 — Realign the XLSX TypeScript bridge to the generated Rust contract

## Summary judgment

This is a strong, evidence-grounded plan. It correctly diagnoses the central problem in `mog/file-io/xlsx/bridge/src`: the package presents itself as the authoritative TypeScript view of the Rust XLSX parser, but its hand-written `FullParseResult` (`types.ts:176-210`) has drifted materially from the generated single-source-of-truth contract, and its worker harness — the apparent "production bridge" — is in fact tooling/test-only. The plan's stated objectives (collapse the parallel type tree into re-exports, type the WASM boundary, make progress/cancellation honest, centralize option forwarding, resolve orphaned helpers) are the right set, well-sequenced from lowest-risk/highest-value to higher-churn worker edits.

I independently verified the plan's most load-bearing claims and they hold:
- The generated `FullParseResult` (`mog/infra/rust-bridge/bridge-ts/generated/xlsx-types.ts:415+`) has `sharedStrings: string[]`, `theme: string | null`, optional `metadata?: MetadataOutput`, and fields `iterativeCalc` / `timelineCaches` — exactly the discrepancies in the plan's drift table. The hand-written shape in `types.ts:176-210` confirms the mismatch.
- `maxStringBytes?` exists on `FullParseOptions` (`types.ts:2352`) and is indeed absent from the inline snake_case literal forwarded in `parse-worker.ts` (`mode`/`max_cells`/`skip_*`/`sheet_filter`/`values_only` only) — the silent-drop claim is real.
- `wasmModule: unknown` (`parse-worker.ts:129`) plus `@ts-expect-error` dynamic access (the `xlsx_parse_full` and `xlsx_version` sites) confirm the untyped WASM boundary.
- The synthetic progress milestones (`init` 0, `zip` 5, `xml` 20, `complete` 100) wrap a single synchronous `xlsx_parse_full` call — the "fiction" characterization is accurate.
- Repo-wide search confirms the only non-test/non-tooling reference to `createWorkerParser`/`parse-worker` is the dependency allowlist; the sole runtime consumer is `tooling/tests/cancellation.test.ts`. Production import flows through the transport `xlsx_parse_full` command and kernel `hydrateXlsx`/`createFromXlsx`, returning `ImportXlsxResult`, not the bridge's `FullParseResult`.
- `xlsx-parser/core.ts` and `data-validation.ts` have no production importers.

The plan's factual base is unusually solid for this experiment; it reads as if the author actually inspected the tree and the generated contract rather than pattern-matching.

## Major strengths

- **Accurate, falsifiable evidence.** The drift table is a real acceptance checklist, and every cited line number I spot-checked was correct. This is the difference between a plan that will land cleanly and one that will surprise the implementer.
- **Honest scoping.** It refuses to silently pick the cross-folder architectural decision (should production adopt the worker?) and instead designs the change to be correct under *either* end-state. That is the right call for a folder-scoped plan and avoids scope creep into the kernel/transport.
- **Contract preservation is explicit.** Public export identity, the worker message discriminated-union protocol, `ParseErrorCode`/`XlsxParseError` vocabulary, `CellRawValue`, and `sideEffects: false` are each named as invariants to preserve, with removals gated behind proof-of-non-use. This is exactly the contract discipline the package needs.
- **The "honest progress" objective is genuinely valuable**, not cosmetic — fabricated percentages around a synchronous call are a latent correctness/UX trap, and the plan ties the fix to doc updates in `progress.ts`.
- **Verification gates are concrete and mostly enforceable**, including a compile-time contract test as a regression guard against future drift and an option-forwarding unit test for `toWasmParseOptions`.

## Major gaps or risks

- **The compile-time contract test (gate 2) is near-tautological as written.** After Step 2, the public `FullParseResult` *is* a re-export of the generated symbol, so asserting it is "assignable to and from `WasmFullParseResult`" — itself a re-export of the same generated type — proves almost nothing; both alias the same declaration. The real regression risk is the bridge's *option DTOs and worker payload* diverging from the generated *output*, or a future hand-written field creeping back. The guard should instead assert structural equality against a freshly-imported generated type via a distinct import path, or lint/forbid local `interface`s in `types.ts` whose names collide with generated names. As specified, the guard gives false confidence.
- **Hidden-consumer enumeration is deferred, not done.** The plan flags (correctly) that deleting drifted fields will turn tooling/test reads of `calcChain`/`customProperties`/`vbaProject`/`activeSheetIndex`/`theme: ParsedTheme` into typecheck errors, but it leaves the enumeration to implementation time ("Enumerate these before deleting"). Since the plan already did repo-wide searches for consumers, doing this enumeration now (a concrete list of files/lines reading drifted fields) would de-risk Step 2 substantially and is the single most likely source of unplanned churn.
- **Step 2 leaves a real decision open-ended.** "Retire the `Wasm*` alias *or* keep both (decide once)" is exactly the kind of micro-decision a plan should settle, because `WasmFullParseResult`/`WasmFullParsedSheet` are already exported names (`types.ts:52-55`) and the choice affects the public surface diff in gate 7. Recommending one (keep both as aliases of the same symbol, to preserve export identity) would be cleaner.
- **`toWasmParseOptions` output type depends on a contract not yet pinned.** The adapter's `WasmParseOptions` snake_case DTO is asserted to be the WASM input shape, but the plan does not point at where that shape is authoritatively defined (the Rust option struct / generated input type). If it is hand-authored in the bridge, it becomes a *new* drift surface — the very problem the plan is fixing. The plan should source `WasmParseOptions` from a generated input type if one exists, or explicitly note that none does and this is a deliberately bridge-local DTO with its own test.
- **Worker round-trip smoke (gate 5) is asserted but not located.** It assumes existing tooling benchmarks call `createWorkerParser` against a real fixture; the plan should name that script so the implementer knows the gate is runnable, not aspirational.

## Contract and verification assessment

The contract section is the plan's strongest part: it correctly distinguishes shapes to preserve (export identity, message protocol, error vocabulary, `CellRawValue`) from shapes to strengthen (generated-types-canonical invariant). The import-boundary `hardware` classification and `sideEffects: false` are both real constraints I confirmed are relevant. Verification gates cover typecheck/declaration-rollup (correctly invoking the `@mog/bridge-ts` build-before-consumer ordering), import-boundary lint, and a public-surface diff — a good spread. The weaknesses are the two noted above: gate 2 as written is too weak to actually catch drift, and gates 4/5 lean on artifacts (the `WasmParseOptions` source of truth; the named smoke fixture script) that the plan should pin down rather than assume. Tightening those three would make the verification story airtight.

## Concrete changes that would raise the rating

1. **Redesign the drift regression guard (gate 2)** so it cannot pass trivially: forbid (via lint or a `tsd`-style structural assertion against an independently-imported generated type) any local declaration in `types.ts` that shadows a generated output type. State the failure mode it is meant to catch.
2. **Do the hidden-consumer enumeration now.** Produce the concrete list of files/lines that read `calcChain`/`customProperties`/`vbaProject`/`activeSheetIndex`/`theme`-as-object/`sharedStrings`-as-rich-text, with the migration target for each, so Step 2 has no open discovery.
3. **Settle the `Wasm*` alias decision** in the plan (recommend keeping both names as aliases of the one generated symbol to preserve export identity) instead of deferring it.
4. **Pin the `WasmParseOptions` source of truth.** Confirm whether a generated input-options type exists; if so, re-export it; if not, state that the snake_case DTO is intentionally bridge-local and rely on the option-forwarding test to guard it.
5. **Name the worker round-trip smoke script** (the specific tooling benchmark / `xlsx-fidelity` entry) so gate 5 is concretely runnable.
6. **For `maxStringBytes`, resolve the open "forward vs. drop" question** by checking whether the Rust option struct accepts it, rather than leaving both branches live — the plan already has the parser folder in reach.

None of these are structural; the plan is fundamentally sound and ready to execute. They would move it from "very good" to "execution-ready with no open discovery."
