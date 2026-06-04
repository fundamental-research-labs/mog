Rating: 8/10

# Review of 061 — `mog/apps/spreadsheet/src/actions/handlers`

## Summary judgment

This is a strong, unusually well-grounded plan. It correctly identifies the folder's role (the single implementation site for every user command, dispatched via `HANDLER_MAP`), and its six objectives target real, verifiable defects rather than cosmetic ones. The invariant section is the best part: it enumerates the exact production-path contracts a refactor of this folder could break (`HANDLER_MAP` key stability, sync-or-async shape, single mutation pipeline, read-only allow-list, receipt semantics, `reason` union) and treats them as hard constraints. Phasing is sensible (contract/shared-seam hardening → independent dedup → mechanical decomposition), and the verification gates are concrete and mostly measurable.

The rating is held below 9 by a cluster of evidence inaccuracies — small individually, but they show the evidence was not fully checked against the tree — and by an under-specified, high-blast-radius Phase C.

## Major strengths

- **Verified core problems.** I confirmed the load-bearing claims against the source:
  - Payloads are untyped end-to-end: `contracts/src/actions/types.ts:369,379` type both handler aliases as `payload?: any`; there are ~266 `payload as …`/`payload?.` sites in the folder. No `ActionPayloadMap`/`ActionHandlerFor` exists in contracts.
  - `getSelectedSheetIds?(): string[] | Promise<string[]>` exists (`contracts/.../types.ts:211-213, "Stream H"`) but is never awaited in the folder; `getTargetSheetIds` returns `[deps.getActiveSheetId()]` unconditionally with the cited "safe default" comments in `editor.ts:86`, `structure.ts:61`, `structure-row-column.ts:18`.
  - `coordinator?: unknown` at `contracts/.../types.ts:264`; the `reason` union is exactly the five values claimed (`:338`) and does **not** contain `not_applicable`.
  - `guardBridgeMutation` is unevenly applied (present in `editor.ts`, `fill/flash-fill.ts`, `drag-drop.ts`, `total-row.ts`, `filter.ts`, `data-analysis.ts`; absent from `clipboard.ts`/`table.ts`/`charts.ts`).
  - `handler-utils.ts` is genuinely the single cast point and already holds `isProtectionRejection`/`showProtectionFeedback`, so `runMutation` is a natural extension, not a new abstraction.
- **Invariants are the right ones.** The "no decomposition may drop/rekey a `HANDLER_MAP` entry" gate, backed by a before/after key snapshot, directly defends the single highest-risk failure mode of objective 6.
- **Correct sequencing of the contract change.** Calling for the additive `ActionPayloadMap`/`ActionHandlerFor` to land first (non-breaking) before tightening `AnyActionHandler`, and explicitly ordering contracts → handlers → consumers, shows real awareness of cross-package blast radius.
- **Risk section is substantive**, not boilerplate: sync→async conversion auditing of callers that read `result.handled` without awaiting, and the warning that `isProtectionRejection` does substring matching and must keep `code === 'API_PROTECTED_SHEET'` primary, are both legitimate.

## Major gaps or risks

- **Objective 4's premise is partly false.** The plan asserts the divergent local copy "lives in the app and is re-exported publicly" via `actions/exports.ts`. There is no `actions/exports.ts` in the tree. The public re-export is in `actions/index.ts:41-43`, and it already re-exports the **canonical** `ActionContracts.ActionHandler/ActionResult` — not the local `types.ts`. The local `types.ts` is indeed stale dead code (it still references `not_applicable` at lines 76/80/103/188/192 and types `ActionHandler` with `payload?: unknown`), so retiring it is reasonable, but the stated mechanism and urgency ("stale public type surface for other consumers") are not supported. An implementer following this verbatim would go looking for a file that does not exist.
- **`getTargetSheetIds` is quadruplicated, not triplicated.** Besides the three cited copies there is a fourth — `formatting/shared.ts:48` exports `getTargetSheetIds`, consumed by `formatting/borders.ts` and `formatting/cell-format-dialogs.ts`. The plan's dedup target (move to `handler-utils.ts`) is right, but it both undercounts the copies and misses that a shared-within-formatting version already exists, which changes the migration surface (those formatting handlers must also be repointed and converted to async). Missing this is a real completeness gap for objective 2.
- **The "265 casts across 10 files" framing is misleading.** It is ~266 sites across ~32 files, and the bulk sits in `charts.ts` (~50), `object.ts` (~36), `diagram.ts` (~27), `ui/dialog-handlers.ts` (~22), `table.ts` (~19) — not the `formulas.ts`/`structure.ts`/`editor.ts` files the evidence and migration ordering foreground (those have 3/6/4). The proposed "start small then large" ordering is still fine, but the cost is concentrated in exactly the god-files objective 6 wants to split, so objectives 1 and 6 are more entangled than the plan's "Phase C depends only on A landing" framing admits.
- **Phase C is large and under-specified.** Splitting `editor.ts` (2,090 lines), `charts.ts`, `object.ts`, `table.ts`, `clipboard.ts` "along the concern seams already present as comment banners" is asserted, not demonstrated — no banner inventory, no proposed per-file export lists. This is the riskiest, lowest-leverage objective; bundling five 1.5–2k-line file splits plus nine new test files into one plan dilutes focus. The key-snapshot gate mitigates breakage but not the review burden.
- **`ActionPayloadMap` coverage is asserted but its source of truth is undefined.** The plan says it must cover every `ActionType` and be compile-enforced, but does not say how the per-action shapes are derived (the casts are ad-hoc and sometimes contradictory across call sites). Reconciling 266 hand-rolled shapes into one authoritative map is the actual hard work of objective 1 and is hand-waved as "replace casts with typing."

## Contract and verification assessment

The contract analysis is accurate where it matters most (payload `any`, `coordinator unknown`, async `getSelectedSheetIds`, `reason` union) and the invariant list is genuinely production-aware. The verification gates are above average: type gate (map completeness + `Record<ActionType, …>`), targeted unit tests (payload-guard rejection → `wrong_context`, multi-sheet write fan-out, protection feedback, PartialArrayWrite no-op, receipt propagation), regression gates against named existing `__tests__`, and a no-behavior-change snapshot for Phase C. These are checkable acceptance criteria, not vibes.

Weaknesses: (a) no gate proves the new `CoordinatorCapabilities` interface matches the *real* coordinator's method set — the plan flags this risk in prose but provides no verification step, so a typed seam could compile while diverging from the implementation; (b) the consumer sweep (keyboard/ribbon/agent) named as the hard cross-folder coupling has no gate confirming all call sites were migrated; (c) "app-eval scenarios … must pass unchanged" is stated but no specific scenario IDs are pinned.

## Concrete changes that would raise the rating

1. **Fix objective 4's evidence:** drop the nonexistent `actions/exports.ts`, state that `index.ts:41-43` already re-exports canonical types, and reframe the work as deleting stale dead code in `types.ts` (with the `not_applicable` cleanup) rather than fixing a public re-export.
2. **Correct the `getTargetSheetIds` count to four** and add `formatting/shared.ts` (plus `borders.ts`/`cell-format-dialogs.ts` consumers) to objective 2's migration list, noting they become async.
3. **Re-anchor objective 1's evidence** on the real cast hotspots (`charts`/`object`/`diagram`/`ui`/`table`) and acknowledge the entanglement with objective 6, since the heaviest payload work lives in the files slated for decomposition.
4. **Split Phase C out** (or at minimum sequence the five file decompositions individually with a per-file banner inventory and exported-name list) so the plan isn't one mega-change; treat decomposition as a separate, optional follow-on to the high-value seams in Phase A.
5. **Add a verification step for objective 5** that asserts `CoordinatorCapabilities` is structurally satisfied by the concrete coordinator (e.g. a type-level `satisfies` check or a test), and a gate confirming the keyboard/ribbon/agent consumer sweep is complete.
6. **Define the `ActionPayloadMap` derivation method** — e.g. extract shapes from existing casts, reconcile conflicts per `ActionType`, and decide the policy for actions whose payloads are currently inconsistent.
