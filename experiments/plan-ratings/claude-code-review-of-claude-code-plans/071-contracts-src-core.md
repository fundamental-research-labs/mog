Rating: 8/10

# Review of Plan 071 — `mog/contracts/src/core`


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every concrete claim I spot-checked against the source held up exactly: the four-copy `RangeKind` duplication (`contracts/src/core/core.ts:21`, `types/core/src/core.ts:102`, `compute-types.gen.ts:3744`, `range_id.rs:106`), the conflicting `MAX_ROWS = 1_000_000` in `apps/spreadsheet/src/domain/fill/types.ts:373`, the stringly-typed `DirtyCell` (`execution.ts:29`, `sheet`/`address` strings, `oldValue`/`value: unknown`, `editRanges: string[]`), the loose `schema.ts` holes (`DistributionConfig.params: Record<string, number>`, `SchemaValidationError.code: string`, `sheetId: string` on the registry/validator, unbranded `RangeSchema.id`/`ColumnSchema.id`), and the `kind as RangeKind` wire cast in `range-metadata-cache.ts:185`. The named verification gates (`check-contracts-declaration-identity`, `verify-runtime-exports`, `check-contracts-runtime-inventory`, `check-contract-runtime-imports`) all exist as real tooling. The architectural framing — the runtime-vs-type split forced by the no-private-runtime-import rule, and the consequence that the *local* enum is the shipped value — is correct and well-reasoned.

The plan understands its own constraints: it correctly refuses to "merge" `RangeKind` (which would introduce a forbidden runtime import) and instead proposes a parity guard, and it flags the highest-blast-radius work (execution identity model) for last. It cleanly separates objectives that are crisp and obviously correct (objectives 2 and 4) from those that carry real cross-team dependencies and under-specification (objectives 1 and 3). That honesty is what keeps it credible.

What holds it back from a 9–10 is that the two riskiest objectives lean on work the plan cannot fully scope from inside this folder, and a couple of framing imprecisions around the `MAX_ROWS` "bug."

## Major strengths

- **Exceptional citation accuracy.** File:line references are verifiable and correct, which makes the diagnosis trustworthy and the implementation directly actionable.
- **Correct invariant preservation list.** The "must preserve" export set matches `index.ts` exactly (names, the runtime values, the `RangeKind` member order/values), and the plan ties the string-value stability directly to the Rust serde wire boundary — the most important constraint in this folder.
- **Right fix shape for `RangeKind`.** A parity guard generated from / asserted against the same Rust→TS source, with a unit-test fallback, is the correct answer given the no-private-import rule. The plan names the fallback precisely (set-equality across all four definitions).
- **Real correctness bug surfaced.** The `fill/types.ts` `MAX_ROWS = 1_000_000` conflict is a genuine latent inconsistency, and the plan pairs the fix with the right caution (audit whether any fill path depended on the lower bound).
- **Sequencing and parallelism are sound.** Phases 2 and 4 are correctly identified as independent; Phase 3 last; Phase 1 gated on the codegen owner; the no-"Excel" rule (real, per repo convention) is called out with a closing `rg -i excel` sweep.

## Major gaps or risks

- **Objective 1 hinges on an unowned generator.** The "preferred" path — extend the existing Rust→TS generator that emits `compute-types.gen.ts` — is deferred to Phase 0 ("confirm how it's generated") and explicitly handed to another owner. The plan never confirms the generator is extensible or where it lives, so the *actual* committed work may collapse to the fallback unit test. That is fine, but the plan should lead with the fallback as the baseline deliverable and treat the generator hook as a stretch, rather than presenting them as co-equal.
- **`MAX_ROWS` count-vs-index conflation.** `fill/types.ts:373` is commented "Maximum row **index** (… 0-indexed)" while the contract `MAX_ROWS = 1_048_576` is a **count**. The plan's "off-by-48,576" framing compares a max-index to a count. It does address the index/count distinction generally in Phase 2 ("derive `MAX_ROWS - 1` where a max index is needed"), but the specific fill site needs that exact reasoning applied, not a flat literal swap — otherwise the migration introduces a real off-by-one at the fill boundary. This is the single place the plan's own caveat must be wired into the concrete step.
- **Phase 3 under-specifies its dependencies.** "The shared cell-value union already used elsewhere in the contracts" is asserted but not located/named, and the bridge serializer and `formattedSummary` producer that would break are described but not pinned to files. For the highest-blast-radius change, that's the part most needing a concrete consumer inventory before work starts.
- **Minor factual slip:** the plan says "the 11 files in this folder" but the folder contains 10 (`commands.ts`, `core.ts`, `disposable.ts`, `event-base.ts`, `execution.ts`, `formatted-text.ts`, `index.ts`, `result.ts`, `schema.ts`, `testing.ts`) — and the plan itself enumerates 10. Cosmetic, but it slightly undercuts the otherwise meticulous accounting.

## Contract and verification assessment

The contract analysis is the plan's strongest dimension. It correctly identifies the seam (local runtime enum is the shipped value), the wire-stability invariant (`kind as RangeKind` round-trip), and the single-brand-owner rule for `FormattedText` enforced by `check-contracts-declaration-identity`. The preserve/strengthen split is precise and matches the real export surface.

Verification gates are appropriate and grounded in real scripts. The plan adds two well-targeted new gates (a `RangeKind` four-way parity test; a constants test plus a repo-lint against fresh `1048576`/`16384` literals) and routes downstream typechecks (`kernel`, `apps/spreadsheet`, `canvas/grid-renderer`, `shell`) and the existing `validation-cache.test.ts` correctly. It properly scopes builds/typechecks as owner-run rather than something the planning agent executes.

Two verification gaps: (1) there is no explicit gate proving the new `SchemaId` brand and `ValidationErrorCode`-typed `code` don't create a *second* brand owner under `check-contracts-declaration-identity` — the same risk the plan correctly raises for `FormattedText` should be stated for the new `SchemaId` brand. (2) Phase 3's engine↔Platform round-trip is named as a risk but has no concrete assertion/test attached; it relies on downstream typecheck, which won't catch a serializer-level shape regression.

## Concrete changes that would raise the rating

1. **Demote the generator hook for `RangeKind`** to a stretch goal and make the four-way set-equality unit test the committed Phase 1 deliverable, so the objective doesn't depend on an external owner to be "done."
2. **Apply the count-vs-index reasoning explicitly at `fill/types.ts:373`**: decide whether the fill bound is a max index or a count, and migrate to `MAX_ROWS` or `MAX_ROWS - 1` accordingly — don't present it as a flat literal substitution.
3. **Name the cell-value union and the bridge serializer / `formattedSummary` producer** for Phase 3, with a concrete consumer file list and a round-trip assertion, before committing to the `DirtyCell` evolution.
4. **Add a brand-owner gate note for the new `SchemaId`** mirroring the `FormattedText` single-owner caution, and confirm `check-contracts-declaration-identity` will accept it.
5. **Fix the "11 files" count** to 10 to keep the accounting airtight.
