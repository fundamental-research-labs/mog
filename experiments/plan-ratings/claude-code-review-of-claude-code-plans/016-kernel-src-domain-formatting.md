Rating: 8/10

# Review of Plan 016 — Harden `mog/kernel/src/domain/formatting`

## Summary judgment

This is a strong, evidence-based plan. Nearly every factual claim it makes about the
two in-scope files (`merges.ts`, `format-registry.ts`) and their surroundings checks out
against the source, which is the single most important property of a hardening plan and the
one most plans get wrong. The diagnosis is accurate, the contracts/invariants section is
unusually disciplined ("Rust stays the source of truth; TS stops re-deriving / hiding what
Rust computes"), and the sequencing/parallelization notes are concrete. The plan is held back
from a 9–10 by one genuinely under-specified work item (the `format-registry.ts` enforcement
in Step 7), by deferring the single highest-risk decision (the `MergeRegion` vs
`ResolvedMergedRegion` return type) to implementation time, and by missing two existing Rust
bridge methods that bear directly on its "remove the dead stubs" recommendation.

I verified the plan's central claims directly:

- Spatial queries exist on the generated bridge: `getMergesInViewportSpatial(...)` and
  `getMergeAtCellSpatial(...)` are present (`compute-bridge.gen.ts:311–312`,
  `manifest.gen.ts:304–305`), and the read paths in `merges.ts` (`getInRange:255`,
  `getInViewport:298`, `clearAll:386`) do indeed call `getAllMergesInSheet` + the local
  `rangesOverlap` (`merges.ts:34`) instead. Claim B "spatial queries unused" is correct.
- `mergeRange`/`unmergeRange` on the bridge return `MutationResult`
  (`compute-bridge.gen.ts:341–342`), and `merges.ts` discards it to return `void`
  (`merges.ts:79, 209`). `merge-operations.mergeCells` then builds an optimistic
  `MergedRegion` from the *input* range (`merge-operations.ts:80–91`), never inspecting what
  Rust actually did. The "MutationResult discarded → optimistic success" claim is correct.
- Direct-bridge bypass confirmed: `structure.ts:361` and `sorting.ts:59` both call
  `ctx.computeBridge.getAllMergesInSheet(...)` directly; the only repo consumer of the module
  is `merge-operations.ts`, which uses `getAll`/`getForCell`/`mergeRange`/`unmergeRange`/
  `mergeAndCenter` but **not** `getInRange`/`getInViewport`. So those two ranged getters have
  no callers, as claimed.
- `checkMergeDataLoss` (`merges.ts:136`) hardcodes `{hasDataLoss:false, cellsWithData:0}`,
  `validateAndClean` (`:407`) returns `0`, `subscribe` (`:433`) returns a no-op — all three
  confirmed dead in-repo.
- `patternBackgroundColor` is `contract:false` with `import/export/render:true`
  (`format-registry.ts:224`), and the file is saturated with "Excel" references — consistent
  with the [[no-excel-in-code]] convention the plan cites.

This level of fidelity is what earns the high rating.

## Major strengths

- **Accurate, reproducible diagnosis.** The "Problems found by inspection" section reads like
  it was written with the files open, and it survives line-by-line verification. No invented
  APIs, no phantom callers.
- **Correct architectural framing.** The plan repeatedly refuses to move semantics into TS and
  explicitly forbids a TS-side batching shim or caching layer that would re-implement Rust
  (Steps 5, non-goals). It keeps event emission in `MutationResultHandler`. This is the right
  instinct for a thin delegation layer and prevents the most likely way this work could go
  wrong.
- **The write-path fix is the highest-value item and is well-targeted.** Propagating
  `MutationResult` into `OperationResult<MergedRegion>` (Step 3) closes a real correctness
  hole — today an overlap rejection or data clobber by Rust is reported to API callers as
  success. The plan correctly ties the removal of the fake `checkMergeDataLoss` to this fix
  rather than deleting it in a vacuum.
- **Disciplined dead-code handling.** It demands grep-verification of zero callers *at edit
  time* before deleting (`subscribe`/`validateAndClean`/`checkMergeDataLoss`) and flags the
  re-export hazard for externally-visible function names — the exact failure mode for a public
  package.
- **Sequencing and parallelization are explicit and correct.** Step 1 → 2 → 4 ordering is
  sound (spatial reads must work before migrating consumers before deleting the filter), Step 3
  is correctly called out as independently landable, and the registry work is correctly
  identified as orthogonal.

## Major gaps or risks

- **Step 7 (`format-registry.ts`) is the weakest part of the plan and reads as aspirational.**
  The proposed guardrail test — "every `render:true` property has a corresponding case in the
  render path" — is hard to implement mechanically: it implies statically reconciling a data
  table against branching logic in `cell-layer.ts`/`format-mapper.ts`/`exporter.ts`, which the
  plan neither sketches nor scopes. Absent that, the test degrades into a snapshot of the table
  asserting against itself, which catches nothing. The plan also offers "add a test **or**
  relocate" as a fork without committing, so a downstream implementer gets no decision. This is
  the one section where the spec quality drops from "executable" to "wish."
- **The highest-risk decision is deferred, not made.** The plan itself names the
  `MergeRegion` (spatial) vs `ResolvedMergedRegion` (current) return-type mismatch as the
  top risk, then resolves it with "confirm whether…" / "if equivalent, normalize; if not,
  surface the spatial type." A plan that flags its riskiest unknown but leaves it unresearched
  is weaker than one that reads the two type definitions (both are in
  `compute-types.gen.ts`, trivially inspectable) and states which fields differ. The
  equivalence test is a good safety net, but the type reconciliation should have been answered
  in the plan, not pushed to edit time.
- **Two existing Rust bridge methods are missed, undercutting the "delete the stubs"
  recommendation.** The bridge already exposes `checkMergeDataLoss(...)` returning
  `[boolean, number]` (`compute-bridge.gen.ts:345`) and `validateAndCleanMerges(...)`
  returning `MutationResult` (`:348`). The plan treats the TS `checkMergeDataLoss` and
  `validateAndClean` purely as dead stubs to delete, never acknowledging that real Rust
  equivalents exist and could be *wired* instead. Objective 3 says "remove **or** wire to real
  behavior," but Step 4 silently collapses that to "delete." For `checkMergeDataLoss` deletion
  is probably right (MutationResult subsumes it), but the plan should say so having seen the
  alternative — not by omission.
- **Signature change framed as "no behavior regression."** Changing `void` → `MutationResult`
  return types (Step 3) is a public-signature change on a re-exported module. The plan asserts
  "no behavior regression for current callers" and separately flags the re-export hazard, but
  doesn't connect the two: returning a richer type is backward-compatible for callers that
  ignore the return, *unless* an external consumer relied on the `Promise<void>` shape in a
  typed context. Minor, but the plan's own "hidden callers via re-export" risk applies here too
  and isn't cross-referenced.
- **`clearAll` batching is speculative.** Step 5 is conditioned on "if a single bridge
  'clear all merges in sheet' / batch unmerge exists or can be requested." No such method
  appears in the manifest I scanned, so this likely reduces to "keep the loop + log it" — which
  is fine, but the plan presents batching as a real option without having confirmed the bridge
  surface, mirroring the Step 1 over-deferral.

## Contract and verification assessment

The contracts section is the plan's strongest dimension. It correctly enumerates the
invariants that must hold (pure-function `DocumentContext`-first shape, Rust as source of
truth, registry remaining the re-export target, type fidelity across the contracts/types
rebuild per [[mog-contracts-declaration-rollup]]) and ties each to a step. The verification
gates are mostly excellent and falsifiable:

- **Read-path equivalence** test with named edge cases (sparse/dense/straddling/empty) is the
  right gate for Step 1 and is specific enough to implement.
- **Write-path observability** ("assert `mergeCells` surfaces failure when Rust rejects an
  overlap") directly tests the Step 3 fix.
- **Consumer-migration** gate correctly notes existing tests mock `getAllMergesInSheet` and
  must be re-pointed through the module (consistent with
  `worksheet-impl.test.ts:318,1697`).

Weaknesses in the gates mirror the gaps above: the "registry guardrail" gate inherits Step 7's
vagueness (it asserts a test "fails loudly if status drifts from reality," but the mechanism
for knowing "reality" is undefined), and there is no gate proving the spatial origin-resolution
semantics of `getMergeAtCellSpatial` match `getMergeAtCellQuery` before `getForCell`/`isOrigin`
are switched — the plan flags this as a risk but doesn't add a corresponding test, leaving a
known semantic risk ungated. The "standard gates" deferral (lint/typecheck/app-eval/api-eval
not run here per task constraints) is appropriately scoped.

## Concrete changes that would raise the rating

1. **Resolve the type mismatch in the plan, not at edit time.** Read the `MergeRegion` and
   `ResolvedMergedRegion` definitions in `compute-types.gen.ts`, list the field delta
   (especially `rowSpan`/`colSpan`/origin fields consumers rely on), and state the chosen
   mapping. This removes the single biggest unknown and would move Step 1 from "investigate"
   to "do."
2. **Commit Step 7 to one path with a concrete mechanism.** Either (a) specify a test that
   reconciles the registry against an enumerable source of truth (e.g. the contract type union
   in `@mog-sdk/contracts/formatting`, or the import mapper's handled keys) rather than the
   un-enumerable render path, or (b) decide to relocate the constant and leave a typed
   re-export. A guardrail that can only re-assert the table against itself isn't worth adding.
3. **Acknowledge the existing Rust `checkMergeDataLoss` / `validateAndCleanMerges` bridge
   methods** and justify delete-vs-wire for each explicitly, so Step 4 reflects the full
   surface rather than treating these as orphan stubs.
4. **Add a gate (or pre-decide) for `getMergeAtCellSpatial` vs `getMergeAtCellQuery`
   semantics** before switching `getForCell`/`isOrigin`, since origin resolution is the kind
   of subtle difference that read-path equivalence on *ranges* won't catch.
5. **Confirm the `clearAll`/`mergeAcross` batch bridge surface** (or state plainly that no
   batch call exists, so the loop stays and is merely logged), removing the conditional
   "if … exists" framing.
6. **Cross-reference the re-export hazard with the `void → MutationResult` signature change**
   so the backward-compatibility reasoning is explicit for the typed public surface.

None of these are architectural objections — the plan's direction is correct and its evidence
is solid. They are the difference between a plan an implementer can execute end-to-end without
new investigation (9–10) and one that front-loads accurate diagnosis but defers its two
hardest decisions (8).
