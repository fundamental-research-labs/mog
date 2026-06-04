Rating: 9/10

# Review of Plan 077 — Harden the canvas-objects contract package (`mog/types/objects/src`)

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every concrete claim it makes is verifiable in the source, and the ones I checked are accurate. It correctly identifies a real, high-impact problem class (exported-name collisions and structural-type duplication in the canonical contract package) rather than inventing busywork, sequences the work so the package stays resolvable at every commit, respects the package's dependency ceiling, and proposes machine-enforced guards plus type-level verification gates rather than vague "make it better" goals. The risk section is honest and the non-goals are explicit. The only meaningful deductions are an oversimplified consolidation assumption for one type (`GradientStop`) and the sheer scope of a six-phase plan presented as a single unit.

## Verification of the plan's factual claims

I confirmed the following against `mog/types/objects/src` (read-only):

- **`DrawingObject` collision is real and incompatible.** `objects/drawing-object.ts:39` (`export interface DrawingObject` — the resolved rendering primitive with `children?: DrawingObject[]`) and `ink/types.ts:464` (`export interface DrawingObject extends FloatingObjectBase`, the ink union member). Both are reachable via subpaths (`./objects/drawing-object`, `./ink/types`). Claim holds.
- **`GradientStop` is defined three times:** `objects/drawing-object.ts:73`, `objects/floating-objects.ts:133`, `text-effects/types.ts:250`. Claim holds — see the nuance below.
- **Effect-type duplication:** `GlowEffect`/`ReflectionEffect`/`BevelEffect`/`Transform3DEffect` exist in both `diagrams/types.ts` (419/433/450/477) and `text-effects/effects.ts` (278/362/482/561). Claim holds.
- **Runtime side effect:** `floating-object-types.ts:130-131` is exactly `const _typeCheck: CanvasObjectType = '' as FloatingObjectKind; void _typeCheck;` — a JS-emitting statement in a pure-type module. Claim holds.
- **Anchor/container migration debt:** `floating-object-types.ts` carries `sheetId: SheetId` with the comment "`sheetId` will be removed in a future phase" and the dual `position`/`anchor` aliasing. Claim holds.
- **Stale root `index.ts`:** header says `diagram/` (folder is `diagrams/`), omits `floating-object-manager`/`floating-objects-view`/`scene-graph-reader`, and carries the obsolete `types-formatting` NOTE. Confirmed.
- **`diagram` vs `diagrams` shim split:** this package's `exports` uses `./diagrams/*`; `mog/contracts` `package.json` uses `./diagram/*`. Confirmed real.
- **Dependency ceiling:** `package.json` deps are exactly `@mog/types-core` + `@mog/types-viewport`. Confirmed.

This level of corroboration is the plan's biggest strength — it is not speculative.

## Major strengths

- **Correct prioritization.** Phase 1 (the `DrawingObject` rename) is genuinely the highest-risk item and is correctly sequenced first, with the consolidation work (Phase 2) explicitly placed after it so moves don't fight the rename.
- **Contract-preservation discipline.** The "production-path contracts and invariants" section is excellent: it names the exact invariants that must survive (`FloatingObjectKind ⊆ CanvasObjectType`, `FloatingObjectSnapshot = FloatingObject` full union, the layering rule, wire/OOXML parity comments as contracts, `IObjectMutator` intent semantics). It explicitly forbids narrowing the snapshot union and explains *why* (Rust round-trip), showing real understanding of the kernel→projection→renderer rule.
- **Guards over good intentions.** Replacing the prose layering comment with an `import/no-cycle`/dependency-cruiser rule, and adding a duplicate-export-name script, turns one-time fixes into regression barriers. The "deliberately introduce a bad import to confirm the guard bites" gate is a nice touch.
- **Strong, concrete verification gates.** `tsc -b`, contracts rollup (correctly invoking the declaration-rollup ordering gotcha), downstream consumer typecheck, `tsd` assignability assertions to catch silent field loss, no-runtime-emit check, wire-parity spot-check, and app-eval/api-eval smoke. These map cleanly onto the stated risks.
- **Honest non-goals and staged deprecation.** No runtime/kernel behavior change, no new object kinds, deprecations are transitional only (not the end state). The `sheetId`/`anchor` work is staged annotate→migrate→delete with the target being removal, not a permanent shim.

## Major gaps or risks

- **`GradientStop` is mischaracterized as a superset pick.** The plan lists `GradientStop` among "pick the superset definition" consolidations and describes the variants as `{offset,color}` vs `{offset,color,opacity?}`. But `text-effects/types.ts:250` uses a **different field name and scale**: `position` (documented 0–100 percentage) rather than `offset` (0.0–1.0). There is no clean superset — consolidation requires a rename + scale-normalization decision, or an explicit adapter, not a `Pick`/`extends`. This is exactly the "silent field loss / semantic drift" hazard the plan warns about elsewhere, but it under-applies its own caution to this case. The `tsd` assignability gate would *catch* the breakage but the plan's prose implies an easier merge than exists. Worth calling out `GradientStop` specifically as needing a semantic-reconciliation sub-step.
- **Scope is large for one unit.** Six phases spanning collision renames, structural consolidation, a migration-debt removal, guard tooling, doc hygiene, and a cross-package `ImportObjectStatus` investigation is a lot to land coherently. The plan does make phases independently shippable and sequences them, which mitigates this, but a reader should expect this to be several PRs, not one. The plan could state that explicitly.
- **Phase 6 is open-ended.** The `ImportObjectStatus` consolidation is framed as "investigate, then act" with the action gated on findings. That's appropriate for an investigation, but it means the plan can't fully commit to an outcome here; it should be flagged as the lowest-confidence phase and safely deferrable.
- **Blast-radius enumeration is asserted, not measured.** The plan says `DrawingObject`/`GradientStop` are "widely imported" and leans on downstream typecheck to catch fallout, but it doesn't include an actual importer inventory. Given the empty root barrel limits bare-root importers, the real risk is subpath importers of `./objects/drawing-object` and `./ink/types`; a quick grep-based importer count would let the implementer size Phase 1 before starting.

## Contract and verification assessment

The contract reasoning is the best part of this plan. It treats the wire/OOXML parity comments as binding contracts, preserves branded-id and `Map<>`-vs-`Record<>` intentional divergences, and keeps the snapshot union whole. The verification gates are specific and executable by the implementer (the plan correctly does not run them itself). The `tsd` assignability assertions are the right tool to defend against the consolidation field-loss risk, and the no-runtime-emit and no-cycle gates close the loop on Phases 4. The one weakness is that the gates would *detect* the `GradientStop` semantic mismatch as a failure rather than the plan pre-resolving it in the design — a smoother plan would specify the canonical `GradientStop` shape (field name + scale) up front.

## Concrete changes that would raise the rating

1. **Resolve `GradientStop` in the design, not at gate-time.** Specify the canonical field (`offset` 0–1 vs `position` 0–100), how the text-effects percentage scale is reconciled (rename + documented converter, or a distinct `TextGradientStop` variant), and that this is *not* a simple `Pick`/`extends`. Apply the same scrutiny to any other duplicate whose field names — not just field sets — differ.
2. **Add a measured importer inventory for Phase 1.** A grep of `./objects/drawing-object` and `./ink/types` subpath importers (and bare `DrawingObject` imports) to size the rename and confirm the "empty root barrel limits blast radius" assumption before committing.
3. **State the PR decomposition explicitly.** Note which phases land together vs separately, and mark Phase 6 as deferrable/lowest-confidence so it doesn't block the high-value Phases 1.
4. **Pin the `diagram`/`diagrams` decision.** The plan offers "rename folder vs document the split" — pick one as the recommended path (documenting the intentional split is the lower-churn choice it already hints at) so the implementer isn't left to re-litigate it.
5. **Clarify the Phase 1 deprecated-alias guidance.** Step 3 offers a `@deprecated DrawingObject = ResolvedDrawing` alias "if external consumers demand it" — but an alias for `ResolvedDrawing` collides again with the ink `DrawingObject` under the same name, which is the very problem being removed. Note that this alias can only live behind a subpath that doesn't also re-export the ink type, or drop it entirely (the plan already prefers a clean rename since all consumers are in-repo).

Overall: a precise, well-researched, low-fluff plan that an implementer could execute with confidence. The deductions are for one oversimplified consolidation case and the scope/decomposition framing, not for soundness.
