Rating: 8/10

# Review of 074 — `mog/types/core/src`


## Summary judgment

This is a strong, unusually well-grounded plan. I spot-checked a large fraction of its
factual claims against the live source and almost all of them hold:

- `core.ts` defines `CellValue = CellValuePrimitive | CellError` with `CellControl`
  declared separately, while the Rust `value-types::CellValue` enum genuinely has
  `Array(Arc<CellArray>)`, `Control(CellControl)`, and `Image(CellImage)` variants, and
  `serde_impl.rs` serializes controls as `{type:"control", controlType:"checkbox",
  checked, value}` and images with `source/altText/sizing/height/width` — exactly as the
  plan asserts.
- `CellAddress.sheetId: string` (core.ts:160) and `CellRange.sheetId?: string`
  (core.ts:180) are plain, unbranded strings, despite a branded `SheetId` existing and
  being re-exported from the same file.
- `formula-string.ts` ends with a `// Constructors` banner and **no** constructors.
  `result.ts` documents `ok`/`err` in its example but exports only the `Result` type.
  `disposable.ts` documents `DisposableBase`/`DisposableStore` but exports only
  `IDisposable`/`CallableDisposable`. `rich-text.ts` claims "Runtime utility functions
  live in utils/rich-text.ts" — a file that does not exist in this package.
- `spill.ts` literally says the projection types "coexist with the SpillResult/
  SpillRangeInfo types above," and tags `ArrayFormulaState` as legacy CSE.
- `runtime/sdk/etc/node.api.md` contains both the impossible
  `import { FormulaA1 } from '@mog/types-core/cell-identity'` (FormulaA1 lives in
  formula-string.ts) **and** several leaked workspace-internal `@mog/types-*` imports
  (`ColId`, `SheetId`, `RichText`), confirming the declaration-leak failure mode is real
  and currently shipping, not hypothetical. There is even a truncated `import { n';` line.
- `package.json` has `files: ["src"]` while `exports` point `types`/`import` at `./dist`,
  and there is no `./sheet-id` subpath export even though `sheet-id.ts` exists and is
  re-exported through `core.ts`.

The plan's evidentiary discipline is its biggest asset: the objectives are anchored to
verifiable defects, the invariants section is precise, and the verification gate list is
comprehensive across both the TS and Rust sides. The deductions are about scope realism,
under-specified blast radius for the one genuinely breaking change, and a few contract
decisions the plan defers instead of pinning.

## Major strengths

- **Production-path relevance is excellent.** This is correctly identified as a Tier 0
  surface whose drift leaks into the published `@mog-sdk/contracts` declarations and SDK
  API reports. The plan ties each objective to a shipped consumer, and the `node.api.md`
  evidence proves the public-leak risk is already a live bug.
- **Cross-language contract clarity.** The invariants section pins `MAX_ROWS`/`MAX_COLS`,
  zero-indexing, the exact 11 `CellError` variants (which match the TS `ErrorVariant`
  union and the Rust enum), and the precise serde JSON shapes. This is the kind of
  contract specification a Tier 0 plan needs.
- **Strong, layered verification gates.** Typecheck → package tests → contracts typecheck
  → spreadsheet-utils/kernel tests → public-artifact build → declaration-identity /
  rollup / api-snapshot / external-fixture / publish-readiness checks → Rust crate tests.
  The ordering is sensible (cheap/local first, cross-language last) and matches how
  declaration leaks are actually caught in this repo.
- **Audit-before-delete sequencing** for the spill/projection transition and the
  `spreadsheet-utils` helper unification is the right instinct and explicitly called out
  as a risk.
- **Inventory-first step (#1)** is the correct opening move and produces the artifact the
  rest of the work depends on.

## Major gaps or risks

- **Parallelization is presented as cleaner than the dependency graph allows.** The plan
  claims "strict ownership boundaries" with 6 parallel agents, but Agent A's inventory and
  module split is a hard prerequisite for Agents C (branding consumers), D (projections),
  and E (helper ownership), and Agent B's serde alignment gates Agent F's fixtures. These
  are pipeline phases, not independent lanes. The plan would be stronger if it labeled the
  true ordering (A and B can start; C/D/E gate on A; F gates on B+D).
- **The CellValue widening is a breaking change to the most-consumed type, and its blast
  radius is under-quantified.** Expanding `CellValue` from `primitive | error` to include
  arrays/controls/images will break every consumer that currently relies on exhaustive
  narrowing (`typeof`/`'type' in v` switches assuming only primitives+errors). The plan
  introduces `ScalarCellValue`/`PublicCellValuePrimitive` projections to manage this, which
  is the right idea, but it does not enumerate or even estimate the call sites that must
  migrate, nor sequence that migration. Combined with the explicit non-goal of "no
  compatibility wrapper," this risks a big-bang change across `types/api`, `rendering`,
  `kernel`, and SDK return types with no staged rollout.
- **Two contract decisions are deferred that a Tier 0 contract plan should pin.** (a)
  Jagged-array handling is listed only as an edge case "to cover (pad vs reject)"; the
  canonical answer should be stated, since Rust's `CellArray` is rectangular-by-
  construction (`try_new`/`try_from_rows` return `ShapeMismatch`), which strongly implies
  TS must reject, not pad. (b) The spill-vs-projection canonical model is left as an
  "if/else" pending audit. Deferring is defensible, but the plan should commit to deciding
  within the plan's lifetime and name the gate that proves it.
- **No baseline capture / acceptance criteria for the snapshot gates.** "Regenerate API
  specs and fix stale imports" and "add declaration snapshot gates" are listed, but the
  plan never says to capture the current (broken) baseline first or define what a passing
  diff looks like. Without a pre-change snapshot, the `node.api.md` regressions can't be
  proven fixed rather than merely re-baselined.
- **The `files`/`exports`/`dist` mismatch fix is named but not resolved.** The package is
  `private: true` and uses a `development` export condition pointing at `src`, so the
  `files: ["src"]`-vs-`dist` discrepancy may be intentional (never packed). The plan flags
  the inconsistency but doesn't decide whether to add `dist` to `files`, drop the `dist`
  conditions, or document the private-package intent.

## Contract and verification assessment

Contract clarity is high. The serde-shape and error-variant specifications are concrete
and verifiably match the Rust owners (`value-types`, with `cell-types`/`snapshot-types`
correctly named). Branding targets are field-precise (`CellAddress.sheetId`,
`CellRange.sheetId`, `IdentityRangeSchemaRef`, `CellIdRange`, `IdentityMergedRegion`),
which is what makes objective 2 actionable rather than aspirational.

The verification section is the plan's second-strongest part: it covers type-level
assertions, runtime-helper tests, cross-language JSON fixtures, and the publish-readiness/
declaration-identity gates that are the actual mechanism for catching the `@mog/types-*`
leak. Two refinements would close the loop: (1) define the pass/fail criterion for the
snapshot gates and capture a baseline before edits, and (2) for the breaking CellValue
change, add an explicit gate that the public scalar projection types do *not* widen (a
type-level assertion that `PublicCellValuePrimitive` excludes array/control/image), so the
"intentional collapse" boundary is enforced, not just documented.

## Concrete changes that would raise the rating

1. **Add a migration/sequencing sub-plan for the CellValue widening**: enumerate (or
   estimate via an `rg` of `CellValue` narrowing sites) the consumers that assume
   primitive+error, and stage their migration behind the new projection types before the
   union is widened. This is the single change that would most de-risk the plan.
2. **Pin the jagged-array contract** (reject at the TS boundary, mirroring Rust
   `CellArray::try_*` `ShapeMismatch`) and the NaN/Infinity → `#NUM!` normalization rule,
   rather than listing them as edge cases to "cover."
3. **Commit to the spill/projection decision** within the plan and name the kernel/UI
   test that proves the chosen canonical model, instead of leaving it as an open if/else.
4. **Capture a pre-change baseline** of `node.api.md` / declaration rollups and state the
   expected diffs, so the stale-import and leak fixes are demonstrably regressions-closed.
5. **Relabel the parallelization section** to reflect the real dependency phases (A/B
   first; C/D/E gate on A; F gates on B+D) instead of "strict independent ownership."
6. **Decide the `files`/`exports`/`dist` policy explicitly** (add `dist` to `files`, or
   document that the package is intentionally never packed and the `dist` conditions exist
   only for downstream build output), since the current text only flags the inconsistency.
