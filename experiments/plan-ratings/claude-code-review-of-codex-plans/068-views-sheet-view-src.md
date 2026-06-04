Rating: 8/10

# Review of Plan 068 — Views SheetView Src

## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every concrete claim it
makes about the current code is verifiable in the source, and the few that
matter most — the leaky escape hatches — are exactly as described. It correctly
diagnoses the central architectural debt of `@mog-sdk/sheet-view`: a
capability-only public facade that is undermined by a hidden grid-renderer
handle, an untyped `Record<string, unknown>` data-source bag, `unknown` viewport
DTOs, and a hit-test mapper whose "exhaustiveness guard" silently falls through
to `{ type: 'empty' }`. The plan targets the right invariants, sequences the work
so production never breaks mid-migration, and ships with credible verification
gates.

The main reasons it is not a 9–10: the scope is very large for a single plan
(cross-folder hit-test rework + full app migration + four new DTO families +
lifecycle contracts), the new public DTO shapes are illustrative ("for example")
rather than pinned, and there is no effort sizing to help a reader judge whether
the parallel slices are weeks or months of work.

## Evidence check (claims verified against source)

- `__mogInternalGridRenderer` is present in both `mog/views/sheet-view/src/sheet-view.ts`
  and `apps/spreadsheet/src/systems/renderer/execution/renderer-execution.ts`. ✅
- `public-types.ts:1267` `export type SheetViewDataSources = Record<string, unknown>;` ✅
- `public-types.ts:1271-1273` `SheetViewportConfig`, `SheetOverlayViewportConfig`
  as open `{ ... [key: string]: unknown }`, and `SheetViewportLayout = unknown`. ✅
- `capabilities/render-state.ts:66-68` maps missing `selection.activeCell` to
  `{ row: 0, col: 0 }` — exactly the behavior the plan flags for review. ✅
- `capabilities/type-mappers.ts:159-162` default returns `{ type: 'empty' }` with
  a comment *claiming* it is an exhaustiveness guard, but it is not a `never`
  check — the plan's most important correctness call-out is accurate. ✅
- `renderer-execution.ts` exposes `getRenderer(): GridRenderer | null` and
  `updateContext(config: Partial<RenderContextConfig>)` as the documented escape
  hatches the plan proposes to retire. ✅
- `docs/guides/sheet-view.md` and `tools/api-snapshots/@mog-sdk__sheet-view.api.txt`
  both exist, so the doc/snapshot update steps land on real targets. ✅

This level of fidelity is the plan's strongest asset: it is not speculative.

## Major strengths

- **Correct root-cause framing.** It does not just say "remove the bag"; it ties
  every public escape hatch to the concrete production consumer that forces it to
  exist (`useRenderContextConfig`, `SpreadsheetGrid.tsx`, `RenderSystem`,
  `renderer-execution`), so the migration is causally complete rather than
  cosmetic.
- **Safe sequencing.** Section 1 and the closing Sequence both insist that
  `__mogInternalGridRenderer` and `getRenderer()` are removed only *after*
  replacement capabilities exist and all app callers are migrated. The top risk
  ("removing the hidden handle before bridge/app migration breaks init") is named
  explicitly. This is the right ordering and it is stated twice.
- **Real exhaustiveness discipline.** It demands `never`-guarded maps for both
  hit-test variants and render-state keys, and calls out that the current
  `{ type: 'empty' }` fallthrough and the `{ row: 0, col: 0 }` default are not
  acceptable substitutes. This is precisely where the contract is currently weak.
- **Cross-folder honesty.** The hit-test section states plainly that fixing only
  `type-mappers.ts` would not prove the UI can ever emit the declared branches,
  and lists the full chain (`types/rendering` → `contracts` → `grid-renderer`
  coordinate/hit-test → `grid-canvas` → mapper → public). This avoids the common
  trap of mapping phantom variants.
- **Verification gates are concrete and layered:** package test/typecheck/build,
  API snapshot, targeted grid-renderer hit-test tests, targeted app tests, and a
  real-browser exercise list. The "no faking renderer state in E2E; use real
  input paths" constraint is a good guard against hollow tests.
- **Edge-case inventory is genuinely useful** (zero-size container then resize,
  DPR changes, shared-workbook second-attach, hidden-run boundaries, merged cells
  across pane splits, stale debounced refresh on sheet switch). These map to known
  failure modes in this substrate.

## Major gaps or risks

- **Scope is very large for one plan.** It bundles: hidden-handle removal, four+
  new typed DTO families, render-state exhaustive mapper, end-to-end hit-test
  reconciliation across three lower packages, viewport DTO typing, lifecycle/
  disposal contracts for every capability, object/extension behavior, and docs/
  snapshot updates. The parallelization section mitigates this, but the slices
  share one public contract and must converge, so they are not as independent as
  presented. There is no sizing or "minimum shippable slice" to de-risk landing.
- **New public DTO shapes are illustrative, not pinned.** Section 2's data-source
  groups and Section 5's viewport DTOs are given "for example" field lists. Since
  the whole point is a *contract*, leaving the exact public field set open pushes
  the hardest design decision into implementation, where it tends to drift. The
  plan would be more actionable if at least one group (e.g. `SheetCellDataSources`)
  were specified field-by-field as a worked example.
- **`getRenderer()` caller enumeration is incomplete.** The plan names
  `renderer-execution.ts` and "downstream deprecated callers" but does not produce
  the actual caller list. Removing a public getter safely requires that inventory
  up front; "after all app callers are gone" is a precondition the plan asserts
  but does not yet scope.
- **Hit-test priority change is under-specified.** The plan acknowledges the risk
  that enriching `GridRenderer.hitTest()` "before falling back to coordinate
  classification" can reorder input priority, and keeps the floating-object and
  cross-sheet guards — good — but it does not define the desired priority order of
  the *new* branches (selection border vs table resize handle vs formula range
  handle vs interactive element). That ordering is itself a contract and should be
  written down before implementation, since it is observable UI behavior.
- **`mog` must not depend on `mog-internal`** is asserted as a constraint, but the
  plan does not say how the typed data-source groups avoid re-importing internal
  renderer key names (it warns about the coupling risk without prescribing the
  boundary mechanism, e.g. a SheetView-owned enum vs structural type).

## Contract and verification assessment

Contract clarity is high at the *boundary-and-invariant* level and medium at the
*concrete-shape* level. The plan is excellent at saying what must be true (no
silent ignores, `never` guards, page-space vs viewport-space distinctness,
idempotent dispose, ordering of `connect()` before first refresh) and which
production facts must be preserved (`fetch-committed` rebuilds VPI/VMI,
`cells-patched` does not, eager population for shared workbooks). It is weaker at
fixing the literal public type signatures, which is the artifact that the API
snapshot will lock in.

Verification is the plan's best dimension. Gates are real commands against real
targets, the API snapshot is treated as a reviewed public-contract change, and
the test-coverage list is mapped one-to-one to the gaps it identified earlier
(geometry, hit-test matrix, render-state mapper, data-source key coverage,
viewport layout mappers, disposal). The explicit "every currently pushed
`RenderContextConfig` key has a typed public source or a documented internal
owner" test is exactly the right completeness assertion for Section 2. The
browser-exercise list keeps the work honest about UI-affecting changes.

One verification gap: there is no gate that proves *behavioral parity* of the
migration — i.e., that the typed data-source path produces byte-equivalent
`RenderContextConfig` to the old bag for a representative frame. A snapshot/golden
comparison of the generated internal config would catch silent field drops during
the cutover better than per-key unit tests alone.

## Concrete changes that would raise the rating

1. **Pin at least one DTO family fully.** Specify `SheetCellDataSources` (and the
   `SheetViewportLayout`) as exact TypeScript shapes, then mark the rest as
   following the same pattern. This converts the riskiest design from "implement
   and see" to "review the contract now."
2. **Produce the actual `getRenderer()` / `__mogInternalGridRenderer` caller
   inventory** (a `rg` sweep result) as an artifact of Section 1, so the removal
   precondition is measurable rather than assertional.
3. **Write down the target hit-test priority order** for all public branches,
   including the new ones, as an ordered list — this is observable behavior and
   belongs in the contract, not in implementation.
4. **Add a golden-config parity gate** for the data-source migration: render one
   representative frame's `RenderContextConfig` through both the legacy bag and
   the typed groups and assert equality, to catch dropped fields during cutover.
5. **Define a minimum shippable slice** (e.g. data-source groups + render-state
   exhaustiveness, deferring the cross-folder hit-test rework) so the plan can
   land incrementally and the highest-risk cross-package work is isolated.
6. **State the SheetView-owned-naming mechanism** that keeps typed data-source
   groups from coupling to internal renderer key names, satisfying the stated
   `mog` ↛ `mog-internal` constraint concretely.

Even without these, the plan is accurate, safely sequenced, and ready to drive
real work; the changes above would mostly de-risk its breadth and lock its public
contract earlier.
