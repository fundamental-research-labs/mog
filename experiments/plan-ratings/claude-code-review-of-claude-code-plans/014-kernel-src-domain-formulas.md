Rating: 8/10

# Review — Plan 014: Harden the formula-facing kernel domain (`mog/kernel/src/domain/formulas`)


## Summary judgment

This is a strong, evidence-grounded production-path plan. I verified every concrete defect it claims against the actual source, and they all hold:

- **`RectRange` drop in `create`** — `named-ranges.ts:445-504` builds `wireRefs` for `Cell/Range/FullRow/FullCol/RowRange/ColRange` and falls through with `return ref` for anything else; `RectRange` is genuinely absent, while `mapRustNamedRange` (`:90-103`) does handle it. A `RectRange`-backed defined name is shipped to Rust in camelCase instead of snake_case wire shape — a real silent serialization bug, not a hypothetical.
- **`importNames` fire-and-forget** — `:655` is `void ctx.computeBridge.setNamedRange(...)`, never awaited, never error-aggregated, and the `def` at `:649-653` omits the `raw_expression` fallback that `create` sets at `:517`. The returned `imported` count is optimistic. Confirmed.
- **Scope-ambiguous delete** — `removeByScope` (`:616`) deletes via `removeNamedRange(name.name)` while `remove` (`:597`) deletes via `removeNamedRangeById(existing.id)`. Confirmed inconsistency.
- **Dead `evaluateValue`** — `:327-334` always returns `undefined` and is the sole reason `IKernelContext` is imported (`:38`); `formatValueForDisplay`/`formatSingleValue` have no in-module producer. Confirmed.
- **N+1 `getAll` fan-out** — `validate`, `getByName`, `getById`, `resolve`, `getByScope`, `exists`, `count`, and `createFromSelection` all call `getAll()`. Confirmed.
- **Pervasive `any`** at the bridge boundary (`rust`, `ref`, `rawFormula`). Confirmed.
- **Always-0 structured-ref stubs** — all five exports return `0`; `tables/operations.ts:137-140,199` and `tables/core.ts:393` consume those zeros into `console.log("[tables] Updated N formulas…")` lines that can therefore never report a real count. Confirmed.

The plan's framing (storage-as-`IdentityFormula`, Rust as the single source of truth, events owned by `MutationResultHandler`) matches the module headers and code. It correctly distinguishes preserve-invariants from improvements, and it correctly identifies the single highest-risk unknown.

## Major strengths

- **The highest-risk item is identified and gated.** The plan's Phase 0 demands confirming whether `getAllNamedRangesWire`/`getVisibleNamedRanges` return raw snake_case wire or transport-normalized camelCase *before* swapping in the canonical converter. I confirmed this is a genuine, load-bearing contradiction: `mapRustNamedRange` reads camelCase (`ref.Range.startId`, `ref.Cell.rowAbsolute`), while the canonical `wireRefToContractRef` in `compute-wire-converters.ts:46-78` reads snake_case (`wire.Range.start_id`, `wire.Cell.row_absolute`). Both cannot be right for the same payload. Refactoring blindly would break all named-range reads — the plan is right to gate on this and label it the top risk.
- **Centralization fixes the bug at the root, not the symptom.** Routing both directions through `wireToIdentityFormula`/`identityFormulaToWire` makes the variant set a single enforced surface, so `RectRange`-style drift can't recur. Notably, `identityFormulaToWire` is *already imported and used* by `getRefersToA1` (`:271`) and `importNames` (`:652`) — only `create` rolls its own — so the canonical path is proven in-module and the change is low-novelty.
- **Honest scoping.** It explicitly flags the two cross-folder edits (Phase 3 touches `api/*/names.ts`; Phase 5 touches `tables/{core,operations}.ts` and needs a Rust change to surface real counts) rather than pretending the work is folder-local.
- **Concrete, regression-oriented verification gates** — a parametric all-variants contract→wire→contract test, a `RectRange` regression test, an `importNames` persisted-count test, a `removeByScope` by-id test, and an atomic-rename single-mutation guard. These map directly onto the defects.
- **Subtle issues caught.** Phase 6 flags that `createFromSelection`'s `bottomRow` branch (`:953-957`) reuses the exact `dataStartRow/dataEndRow` bounds of the `topRow` branch (`:946-948`), creating duplicate-key churn — a real latent issue I confirmed.

## Major gaps or risks

- **Objective 4 stays undecided.** "Either remove the dead stub and route value display through a real bridge call, or remove the orphaned formatting helpers" leaves the actual decision unmade. The deciding fact — whether any Name-Manager consumer in `api/workbook/names.ts` / `api/worksheet/names.ts` reads a value column — is knowable now and should have been folded into Phase 0 so the implementer doesn't re-discover it. As written, this objective could land as either a no-op cleanup or a feature addition.
- **The "Phases 1–4 + 6 land as one PR" claim is in tension with the cross-folder dependencies.** Phase 3 is listed inside the "independent within this folder" set in one place but as a cross-folder dependency elsewhere. The single-PR boundary should be stated as Phases 1, 2, 4, 6 only, with 3 and 5 explicitly sequenced separately.
- **Flag preservation on the `create` swap is unspecified.** `create` currently sets `is_dynamic_array`/`is_volatile` explicitly (`:512-513`) from `rawFormula`, whereas `importNames` relies on `identityFormulaToWire(name.refersTo)` to carry them. When `create` is switched to `identityFormulaToWire`, the plan should assert that these two flags survive the canonical converter — otherwise dynamic-array / volatile named ranges silently regress. This belongs in Phase 1 and the test matrix.
- **Phase 5 preferred path has an unowned external dependency.** Surfacing the real rewrite count requires a Rust `MutationResult` change plus bridge plumbing — outside this folder and this worker's reach. The fallback (delete stubs + dead count logging) is the realistic near-term path; the plan should bias toward the fallback rather than presenting both as equal, since the preferred path can't be completed inside the formulas-domain PR.
- **Minor inaccuracy:** the plan lists `wireRefToContractRef`/`contractRefToWireRef` among the "canonical, tested exported converters," but the per-ref helpers are private in `compute-wire-converters.ts` (only `wireToIdentityFormula`/`identityFormulaToWire` are exported). This doesn't change the approach — centralizing on the two exported whole-formula converters is correct — but the reference list is slightly off.

## Contract and verification assessment

The contract section is the best part of the plan: it enumerates the full seven-variant `IdentityFormulaRef` set, names the atomic-rename invariant with the exact Rust mutation it relies on, preserves scope precedence and the no-throw `getRefersToA1` constant-formula fallback (verified at `:273-283`), and keeps event emission with `MutationResultHandler`. The representation-reconciliation invariant is the standout — it converts the riskiest refactor into a pre-condition rather than a leap of faith.

Verification gates are appropriate and specific, and the plan correctly notes this worker does not run builds/tests, listing the type gate and contracts declaration rollup as implementer responsibilities. Two gaps: (1) no gate verifies the camelCase-vs-snake_case Phase-0 finding with an actual round-trip against a live bridge payload (the parametric test would pass against a self-consistent mock yet still mismatch the real transport); (2) no gate for the dynamic-array/volatile flag preservation noted above.

## Concrete changes that would raise the rating

1. **Resolve Objective 4 in Phase 0.** Grep `api/workbook/names.ts` and `api/worksheet/names.ts` for any value-display consumer and state the decision (remove vs. add bridge-backed accessor) in the plan, rather than leaving an either/or.
2. **Make the Phase-0 representation finding a hard, runtime-verified gate** — e.g., assert against a captured real `getAllNamedRangesWire` payload (or a transport-layer fixture) that field casing matches what the canonical converter expects, before any converter swap.
3. **Add `is_dynamic_array`/`is_volatile` preservation** to the Phase 1 description and the test matrix when migrating `create` to `identityFormulaToWire`.
4. **Tighten the PR boundary statement** to "Phases 1, 2, 4, 6 in one PR; Phase 3 and Phase 5 sequenced separately," removing the internal contradiction about Phase 3.
5. **Bias Phase 5 to the fallback path** (delete stubs + dead count logging) as the in-scope deliverable, with the count-surfacing preferred path filed as a follow-up dependent on compute-core, since it cannot complete within this folder.
6. **Correct the converter reference list** to cite only the exported `wireToIdentityFormula`/`identityFormulaToWire`.

These are refinements, not redirections — the diagnosis is accurate, the sequencing is sound, and the single biggest risk is correctly gated. With the value-display decision resolved and the representation check made a runtime gate, this is a 9.
