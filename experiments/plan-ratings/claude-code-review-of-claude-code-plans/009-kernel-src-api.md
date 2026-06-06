Rating: 8/10

# Review — 009-kernel-src-api


## Summary judgment

This is a strong, evidence-grounded plan for a high-risk, high-fan-in folder. It correctly frames the work as *contract hygiene* (consistency, accuracy, disposability) rather than behavior change, and it sequences additive/mechanical steps ahead of the one genuinely rippling change. I spot-checked nearly every concrete claim against the tree and they hold up: there is no `sheet/` directory and no `internal/unwrap.ts` (both still referenced by `README.md`, which also says "35 modules" and "MergeOps.merge … ← sheet/"); `worksheet/operations/` has exactly 31 `.ts` modules; `unwrapResult<T>(... error?: any)` is verbatim-duplicated in `workbook/scenarios.ts:30`, `worksheet/outline.ts:23`, `worksheet/print.ts:17`; `_ensureWritable` is hand-rolled in 23 classes (plan says "14+") with real `operation`/`op` naming drift; `as any` appears exactly 16 times in production code; the TODOs in `worksheet/tables.ts:101` and `app/bindings-api.ts:11,28` exist; and both Tier-3 casts (`workbook-impl.ts:254,1197`) are present. The plan's factual foundation is unusually solid — a reviewer can trust it.

## Major strengths

- **Verifiable, file-and-line-cited evidence.** Almost every assertion is independently checkable and checks out. The plan even instructs re-verification of counts at edit time (Step 1's "verify at edit time", Step 2's "Verify no other inline copies exist"), which is the right discipline for a moving tree.
- **Explicit invariants section.** Disposal ordering, write-gate timing ("must fire *before* delegation"), overload-discrimination semantics, 1-based/0-based conventions, the unexported-`Impl` rule, and the Tier 2/3 boundary are all enumerated as things to preserve. This is exactly what protects a refactor of the behavior gateway.
- **Honest risk gradient and sequencing.** Steps 1–3 are disjoint-file, parallelizable, near-zero-risk. The one dangerous step (4) is isolated, gated behind the SDK conformance suite, and prescribed as one-module-at-a-time. Step 6 (god-file boilerplate) is correctly flagged as the most deferrable.
- **Targeted, falsifiable verification gates.** Per-step new unit tests, a zero-`as any` grep gate scoped to specific files, a disposal-order/leak assertion for Step 6, and naming the actual security-relevant suites (`document/__tests__/sdk-conformance/*`).

## Major gaps or risks

- **Step 4's blast radius is under-quantified, and the "mechanical" framing understates it.** `table-operations.ts` alone returns `Promise<OperationResult<void>>` across at least a dozen functions; `validation-operations.ts` similarly. The plan never estimates how many *callers* must change or lists the call sites. More importantly, the current README documents return-`OperationResult` as the *deliberate* internal-layer contract — flipping to throw is a real internal contract change, not a tidy-up. The objective "aligns with the public throw contract" is defensible, but the plan should own that this changes the internal layer's design, not merely its surface, and should produce the caller inventory before committing.
- **Async-throw semantics not addressed.** The operations are `async`; converting return-result to throw means rejected promises. Callers currently `unwrapResult(await op())`; after migration they `await op()` and rely on rejection propagation. The plan should state that the migration preserves the synchronous-vs-async error timing callers depend on (and that no `renderCached`/synchronous-path caller swallows a now-async rejection).
- **Cross-folder steps (5 and 8) depend on owners outside this folder with thin fallbacks.** Step 5 may need a `@mog-sdk/contracts` shape payload type plus a matching bridge change; if the contracts/bridges owners can't land it, Step 5 stalls and the `as any` goal is unmet. Step 8 binding persistence is explicitly contingent on engine `ComputeBridge` methods existing. Step 8 has a clean fallback (convert to tracked issue); Step 5 does not articulate what happens if the contract change is rejected — only "flag and coordinate."
- **Minor internal-count inconsistency.** The plan cites "~40 lazy `get` accessors" / "~30 sub-API classes" while `README.md:88` says "21 sub-API classes." Not material to the work, but Step 1 (make the README true) should reconcile this number too, and the plan should note which count is authoritative.

## Contract and verification assessment

The contract section is the plan's best feature: it pins the public/internal boundary, the `@stability` tags, disposal order, and the Tier 2/3 cast as load-bearing, and forbids touching exported symbols. Verification is appropriately layered — typecheck + conformance suites for the rippling steps, scoped grep gates for the mechanical ones, and a negative test for the Step 7 dev-assertion. Two gaps: (1) Step 4's regression coverage is described as "a regression test asserting the operation layer throws" — singular, where it should be per-migrated-module and should also assert *callers* still surface the same `KernelError`; (2) there is no gate that proves the README is now accurate (e.g. a doc-lint or a manual checklist tying each README path to an `ls`), which matters because README staleness is itself listed as the headline defect. The "no build/test commands run while authoring" note is correct and well-placed.

## Concrete changes that would raise the rating

1. **Add a Step 4 caller inventory and blast-radius estimate** before migration: enumerate every consumer of the `OperationResult`-returning modules, count them, and state the per-module migration order with its own conformance gate. Reframe Step 4 as an internal-contract change (with the README's current "returns OperationResult" statement as the thing being deliberately reversed), not a mechanical edit.
2. **Address async-throw semantics explicitly** — state that rejected-promise timing must match prior `unwrapResult(await …)` behavior and that no synchronous/`renderCached` path is affected.
3. **Give Step 5 a fallback** equivalent to Step 8's: if the contracts/bridges owners reject or defer the payload type, define the locally-narrowed type in `api/` with a one-line rationale (matching the `comments.ts:158` carve-out) rather than leaving the `as any`.
4. **Add a README-accuracy gate** (Step 1): a checklist or doc-lint mapping each documented path/count to a tree fact, plus reconcile the 21-vs-~30 sub-API count.
5. **Quantify the `_ensureWritable` target honestly** — the real count is 23, not "14+"; using the true number sharpens the Step 3 scope and its completion check.
