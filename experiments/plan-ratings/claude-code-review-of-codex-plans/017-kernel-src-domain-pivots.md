Rating: 7/10

# Review of `017-kernel-src-domain-pivots.md`

Plan reviewed: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/017-kernel-src-domain-pivots.md`
Source folder: `mog/kernel/src/domain/pivots`

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about the current code checks out against the tree, which is the single biggest differentiator between a useful plan and a plausible-sounding one. It correctly diagnoses that `domain/pivots` is today a one-file style helper (`style-normalization.ts` + its test) while the real pivot domain logic is scattered across the worksheet API (`pivots.ts`, 2633 lines), the bridge (`pivot-bridge.ts`, 1540 lines), the event bridge, and the type packages. The proposed remedy — promote `domain/pivots` into the canonical, pure, testable domain layer while keeping Rust/Yrs as the source of persisted truth — is the right architectural direction and is stated with unusual precision about what is *out* of scope.

The plan loses points for scale-without-sequencing and for one genuinely risky line item (a hand-rolled calculated-field parser) that it flags but does not contain. It is a near-rewrite of the pivot surface dressed as a single workstream, and it lacks a behavior-equivalence strategy to prove the refactor is safe.

## Major strengths

- **Verifiable, accurate diagnosis.** Spot-checks confirm the claims:
  - Divergent placement identity is real: `makePlacementId(area, fieldId, position)` at `kernel/src/api/worksheet/pivots.ts:83` vs `createStablePlacementId(...)` / `getBridgePlacementId(...)` at `kernel/src/bridges/pivot-bridge.ts:140,147`.
  - Inline `{ reason, refreshPolicy }` objects are repeated ~20 times across both files; `sourceRangeChanged` really is `dirtyOnly` (`pivots.ts:1670`) while everything else is `refreshAndMaterialize`.
  - `PivotUpdateOptions`/`PivotUpdateReason`/`PivotRefreshPolicy` exist in `types/events/src/pivot-events.ts:16-37`.
  - Pseudo-revisions via `Date.now()` are confirmed (`pivot-bridge.ts:688,697`; `pivots.ts:1138,2355,2375`).
  - The regex-only calculated-field scan is confirmed: `new RegExp(\`\\b${escaped}\\b\`)` at `pivots.ts:1518`.
  - The invariant test exists at `kernel/__tests__/invariants/pivot-update-contracts.test.ts`.
  - Branded types it proposes to centralize (`PlacementId`, `CalculatedFieldId`, `PivotMemberKey`, `PivotTupleKey`) genuinely exist at `types/data/src/data/pivot.ts:17-20`, and the event bridge does fan multiple `pivotBridge.refresh()` calls (`pivot-event-bridge.ts:144,163,194,223,251`), substantiating the duplicate-materialization concern.
- **Crisp invariant section.** The "contracts and invariants to preserve or strengthen" list is the best part of the plan: atomic source-change failure, dense zero-based positions, stable-ID preservation, `sourceSheetId` authoritative over `sourceSheetName`, compute-as-pure-read vs refresh-as-materialization. These are precise enough to test against.
- **Honest scope discipline.** The non-goals (no TS persisted store, no Rust logic migration, no public API renames, `compute/api/src/sheet/pivots.rs` is not the shipped CRUD path) prevent the most common ways this kind of refactor metastasizes.
- **Test plan maps to invariants.** The unit-test enumeration largely mirrors the invariants, and edge cases (same field placed multiple times in Values, duplicate headers, legacy configs missing `placementId`/`sourceSheetId`) are concrete.

## Major gaps or risks

- **Scale vs sequencing.** This touches ~5,400 lines across kernel + two type packages and introduces ~9 new modules. The 10-step "concrete plan" is an inventory, not an ordered dependency graph. There is a real build-order dependency the plan leaves implicit: `ids.ts` must land before `placements.ts`, which must land before `config-transitions.ts` and `receipts.ts`. The parallelization split (Agents A–E) papers over this — Agent B (placements) depends on Agent B's own ids work, and Agent C (reconciliation) consumes `config-transitions` owned by... no one cleanly (it's split between C and the placement work). Without an explicit "land ids + placements first, then everything else" gate, the parallel agents will collide on shared signatures.
- **The calculated-field parser is the riskiest item and is under-contained.** Step 5 proposes replacing the `\b...\b` regex with "a deterministic reference extractor aligned with the Rust calculated-field grammar," then concedes the Rust grammar may not be reachable through compute and falls back to "a small tokenizer." A second, hand-written parser that must stay in lockstep with the Rust grammar is exactly the kind of divergence that causes silent correctness drift later. The plan flags this as a risk but does not define the acceptance contract: which grammar productions, which corpus of formulas must round-trip identically, and what happens on parse failure (fail-closed atomic error vs. fall back to regex). As written this could be deferred or under-built and still claim "done."
- **No behavior-equivalence strategy.** The plan is effectively a "no behavior change" refactor, but offers no mechanism to prove equivalence — no characterization/golden tests captured against the *current* implementation before the move. "Update existing tests" is listed, but editing tests during a refactor is precisely how behavior silently shifts. A snapshot of current receipts/refresh-policy outputs taken before the change, asserted unchanged after, would de-risk the whole effort.
- **Receipt revision fix is only half a fix.** Step 7 says "prefer real revision values from compute when available" and otherwise "make the missing data explicit in one place." That centralizes the smell but does not resolve it; the `Date.now()`/`0` revisions remain semantically meaningless. The plan should state whether exposing real revisions from compute is in-scope or explicitly deferred, because "explicit in one place" can quietly become a permanent placeholder.
- **Naming churn understated.** The plan renames `pivotStyleIdForCompute` → `normalizePivotStyleIdForCompute` (the current export is `pivotStyleIdForCompute` / `publicPivotStyleId`, confirmed in `style-normalization.ts`). Any rename touches all callers and the existing test; the plan says "make `style-normalization.ts` a compatibility export or replace it with re-exports" but does not commit to one, leaving an ambiguity that affects import-update blast radius.
- **Event-ownership decision deferred to implementation.** Step 8 asks the implementer to "audit whether both `setupObservers()` and `PivotEventBridge` can refresh the same event" and pick one owner. The evidence already shows both paths call `refresh()`; the plan could have made the ownership call now rather than leaving a load-bearing design decision to discovery time.

## Contract and verification assessment

Contract clarity is the plan's strength: branded-ID helpers, dense positions, atomic reconciliation, dirty-only vs materialize policy, and `sourceSheetId` authority are all stated as testable invariants and they match the types/code that exist. The proposed `update-policy.ts` map (transition → reason → policy → effects) plus extending the existing invariant test to forbid hard-coded reason/policy objects is a genuinely good enforcement mechanism and directly attacks the duplication confirmed in the source.

Verification gates are adequate but generic: run the named kernel test files, `pnpm typecheck`, dev-server exercise of the pivot workflows, and conditional Rust gates. What is missing is a *proof-of-equivalence* gate (golden receipts/policy snapshots captured pre-refactor) and a measurable acceptance criterion for the calculated-field extractor (a fixed formula corpus that must extract identical references to the current regex, plus the intended *improvements* over it). As written, "all tests pass" can be satisfied while behavior has shifted, because the same workstream edits the tests.

## Concrete changes that would raise the rating

1. **Add an explicit landing order and a dependency DAG** for the 9 modules, and rewrite the Agent A–E split so each agent's inputs are modules that are already landed (e.g., gate placements/config-transitions/receipts behind ids + a frozen domain `index.ts` signature). This alone is worth a point.
2. **Contain the calculated-field parser.** Define the exact grammar subset, a fixed formula corpus for tests, the fail-closed behavior on parse error, and an explicit decision on Rust-parser reuse vs. TS tokenizer — with a fallback that is *at least as safe* as today's regex, never less.
3. **Add a behavior-equivalence gate**: capture characterization snapshots (placement transitions, receipts, refresh-policy decisions, reconciliation outputs) against the current implementation before any move, and assert byte-identical output after — separate from the editable unit tests.
4. **Decide the event-materialization owner now** (`PivotEventBridge` for production refresh, `setupObservers` for UI notification, or vice-versa) based on the existing dual-refresh evidence, instead of deferring to an implementation-time audit.
5. **Commit to one style-module migration shape** (re-export shim vs. full caller update) and enumerate the affected import sites, since `WorkbookPivotTableStylesImpl` and `WorksheetPivotsImpl.setStyle()` are the only two production callers and are easy to list exhaustively.
6. **State the receipt-revision scope explicitly**: either include exposing real compute revisions, or mark it a tracked follow-up with a single typed "revision-unavailable" sentinel rather than a centralized placeholder.

Net: an accurate, well-bounded, contract-rich plan whose main weaknesses are sequencing rigor and containment of its one high-risk subtask. With an ordered DAG, an equivalence gate, and a fenced calc-field parser spec, this would be an 8–9.
