Rating: 8/10

# Review — 074 `mog/types/core/src`


## Summary judgment

This is a strong, evidence-driven plan for hardening the Tier-0 `@mog/types-core`
foundation package. I independently verified its factual claims against the source
and they hold up with unusual precision: `core.ts` is 1530 LOC; `cells/formula-string.ts`
ends with a `// Constructors` header and zero constructors (lines 40–42); there are
exactly **13 `as FormulaA1` and 2 `as FormulaTemplate`** casts across the repo; the
named brand seams type identity fields as bare `string` (`CellAddress.sheetId` core.ts:160,
`CellRange.sheetId?` core.ts:180, `getSheetInfo(sheetId: string)` core.ts:1366,
`CellIdRange.topLeftCellId/bottomRightCellId` cell-identity.ts:333/336,
`IdentityMergedRegion.topLeftId/bottomRightId` cell-identity.ts:371/374,
`IdentityRangeSchemaRef.startId/endId/sheetId` cell-identity.ts:294/297/291);
`ResolvedCellFormat` is the `[K in keyof CellFormat]-?: CellFormat[K] | null` mapped type
(core.ts:587); `CellMetadata` (1400) and `CellProperties` (1452) are field-for-field
duplicates plus `format`; `SheetPrintSettings` is a live `@deprecated` alias (core.ts:1297);
three `extensions?: Record<string, unknown>` bags exist (583/1434/1490); the Rust-mirror
types carry only prose "must match Rust" comments; and `formatted-text.ts` does back-import
`FormattedText` from `core.ts`. The plan does not overstate or invent a single defect I could
find — a rare quality.

The objectives are well-chosen (make brands load-bearing, real formula constructors,
de-dup metadata, decompose the monolith, mechanize Rust parity, deprecation hygiene), the
invariants section correctly identifies the load-bearing contracts (source↔dist identity,
Tier-0 dependency purity, brand single-ownership, `ResolvedCellFormat` density, barrel
stability), and the risk section is honest about blast radius and the genuine widening risk
on `AxisRunId`/`AxisIdentityRef`.

## Major strengths

- **Accurate, falsifiable evidence.** Nearly every assertion is backed by a line-level fact
  I could confirm. This makes the diagnosis trustworthy and the plan executable without
  re-discovery.
- **Correct contract framing.** The plan understands that the emitted `dist` `.d.ts` is the
  published artifact, that brand-tightening is a *narrowing* that is source-compatible for
  branded producers and surfaces unsafe raw-string seams elsewhere, and that the binding
  acceptance gate is whole-repo `tsc` after the contracts declaration rollup. It correctly
  refuses to mint parallel brands or add `as any` shims.
- **Real verification gates.** Type-level `*.test-d.ts` assertions (raw string not assignable
  to a tightened field; `FormulaTemplate` not assignable to `FormulaA1`; `ResolvedCellFormat`
  key-completeness), constructor round-trip tests, a barrel name-set diff, and a no-new-dependency
  check are all concrete and appropriate for a types package.
- **Honest sequencing and risk.** It flags the `formatted-text.ts → core.ts` cycle as something
  the decomposition must not worsen, recommends landing Phase 4 (pure move) first, and warns
  against false-precision branding on cross-axis ids.

## Major gaps or risks

- **Phase 5 (Rust parity guard) is the weakest spec.** It says "establish a mechanism" with two
  fallbacks but does not pin the `compute-core` serde source paths, name the existing
  `NumberFormatType` Rust→TS generator, or state where the guard/fixture would live and what CI
  job runs it. As written it is an intention, not a buildable step. This is the one phase a
  second engineer could not execute from the text alone.
- **Cross-folder blast radius undercuts "single-folder plan."** Objective 1 mandates landing
  producer fixes "in the same change set," but those producers live in `mog/kernel` bridges/store/
  importers and `@mog-sdk/contracts` — explicitly out of this folder. The plan acknowledges this
  in the parallelization notes, but the practical consequence is that Phases 1 and 2 are not
  self-contained and cannot merge or typecheck in isolation. The ~126-consumer / 15-cast churn is
  real and the coordination cost is larger than a folder-scoped plan implies.
- **Phase 4 + Phase 1/3 interleaving risk.** Decomposing a 1530-line monolith while also retyping
  fields inside it invites move-vs-edit conflicts. The plan mitigates by recommending Phase 4
  first, but the "byte-identical barrel" guarantee plus simultaneous signature tightening is a
  fragile combination that deserves a firmer "freeze order."
- **Deprecation lifecycle (Phase 6) is thin.** It proposes a `@deprecated since`/removal target and
  a typed extension-key registry, but gives no concrete removal milestone or registry shape — it
  reads more as a direction than a committed change.

## Contract and verification assessment

The contract section is the plan's best part: it names the exact invariants that must survive
(source↔dist shape identity, dependency purity, brand single-ownership, the `=`-prefix invariant,
`ResolvedCellFormat` density including the *shallow* nested-object resolution that consumers
branch on, Rust-mirror fidelity, barrel stability) and ties each to a verification gate. The
type-level test design is exactly right for a declarations package and the barrel name-set diff
is a precise guard against the decomposition leaking API changes. The one soft spot is that the
strongest gate (monorepo typecheck) cannot run in this pass and depends on a downstream contracts
rollup — correctly disclosed, but it means the plan's own confidence rests on a step deferred to
the implementer. The Rust-parity gate is asserted as a CI gate without a concrete mechanism, so
its assurance value is currently aspirational.

## Concrete changes that would raise the rating

1. **Pin Phase 5.** Cite the actual `compute-core` Rust file(s) where `RangeKind`/`RangeAnchor`/
   `PayloadEncoding`/`AxisIdentityRef` are defined, name the existing `NumberFormatType` generator
   it would reuse, and specify where the generated type or round-trip fixture lives and which CI
   job fails on drift. This single change would move the weakest phase from "intent" to "buildable."
2. **Restructure as a coordinated multi-folder change set.** Split the brand-tightening into a
   per-seam worklist that pairs each `types/core` edit with its concrete kernel/contracts producer
   sites (file paths), and state the merge ordering explicitly, so reviewers can see the plan is
   not actually self-contained and budget for it.
3. **Add an explicit Phase 4 freeze protocol** — e.g. land the pure move with a barrel-diff test in
   one commit, then apply Phase 1/3 retyping in follow-ups — rather than leaving "serialize or land
   first" as an either/or.
4. **Make Phase 6 concrete:** give `SheetPrintSettings` a named removal milestone and sketch the
   extension-key registry's shape (key namespace, value typing for `ignoreError`) so it is a
   committed deliverable, not a study.
5. **Confirm the `AxisRunId`/`AxisIdentityRef` decision before listing it as a seam** — the plan
   already hedges, but resolving it against the Rust definition up front would remove a known
   ambiguity from Phase 1's worklist.
