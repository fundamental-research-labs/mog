Rating: 8/10

# Review of 099 — Shell Host Lifecycle, Setup, and Recovery Plan

Source folder: `mog/shell/src/host` (App slot lifecycle, error boundaries, host hooks)

## Summary judgment

This is a strong, unusually well-grounded plan. Almost every factual claim it makes about the current code was verified directly against the source and is accurate, not hand-waved. It correctly identifies the single most important production defect in this folder — the **mixed-kernel launch** — and builds a coherent architecture around fixing it, with explicit contracts, a state machine, generation-guard invariants, fail-closed capability semantics, retryable lazy loading, and an error/diagnostics redesign. Verification gates reference real package scripts, and the dependency/sequencing analysis against sibling plans 066/067 is honest about what blocks what.

The plan's main weakness is scope. It is effectively a near-total rewrite of the host's orchestration layer plus platform integration plus durable-persistence dependencies, decomposed into 13 implementation steps and 7 parallel agents. That breadth makes "done" hard to define and raises the risk that the most valuable fixes (kernel ownership, fail-closed capabilities, generation guards) get diluted across an ambitious surface. It also leans on plan 066's platform runtime, which does not yet exist — the plan hedges this well with "transition shape," but a reader could still over-invest in step 13.

## Verification of claims against source

I confirmed the following load-bearing claims are true in the current code:

- **Mixed kernel (the central bug).** `AppSlot.tsx` passes `appDocument.kernel` to `useAppInstanceSetup` for managed-table apps (line 174), but `createGatedApi` hard-codes `fullApi: kernel` — the parent workbook kernel (line 199). So bindings/managed tables can be resolved against the app document while the gated API the app actually receives is built from the parent kernel. The plan's "must be eliminated before adding more app setup features" (§4) is justified.
- **Fail-open capabilities.** Three separate fall-throughs auto-allow / return an ungated adapter when `capabilityContext` is absent (`AppSlot.tsx` lines 186–194, 209–219, 254–262). The plan's `strict` / `permissive-legacy` proposal (§8) maps exactly to this.
- **Module-global mutable registry.** `app-registry.ts` clears and reassigns `APP_IDS`/`APP_MANIFESTS`/`APP_LOADERS` on every `registerApps()` call. Confirmed.
- **Stale registry memoization.** `useAppManifests()` memoizes `Object.values(APP_MANIFESTS)` with `[]` deps — never updates after first render. Confirmed (§3).
- **Sticky lazy cache.** `useAppComponent` caches `React.lazy` by `appId` alone with no version/retry key and no invalidation path (`lazyComponentCache` keyed by `appId`). A failed dynamic import stays failed. Confirmed (§9).
- **Thin error path.** `ErrorBoundary` only `console.error`s with no app/session metadata; `AppCrashedState` renders a generic "App crashed" for every failure class. Confirmed (§10).
- **Silent partial bindings.** `createManagedTables` returns an empty/partial `bindings` object and only `console.error`s when `tables.create`/`columns.list` are missing (lines 181–184); dedicated-sheet creation is gated behind optional `kernel.sheets?.create` (line 171). Confirmed (§7).
- **Implicit setup flow + in-memory instances.** `useAppInstanceSetup` starts in `checking` and reads `kernel.bindings.getInstances(appId)` synchronously with no durability story. Confirmed (§5).
- **Missing async guards.** Neither `doLaunch` nor the `kernel.tables.list().then(setBindingEditorTables)` effect carries any session/attempt token. Confirmed (§2, §6).

Tooling claims also check out: `check:host-surface-disposition` and `check:ci:public-boundaries` exist in `mog/package.json` (the latter chains the former), the shell uses `jest` (so `pnpm test -- src/host` is valid), and plans `066-shell-src-platform.md` and `067-shell-src-services.md` exist in the codex-plans folder.

## Major strengths

- **Diagnosis precedes prescription.** The "Current role" section is an accurate audit, not a summary, and each improvement objective traces back to a real defect.
- **Invariants are first-class.** The "contracts and invariants" section gives testable properties (single runtime kernel, session identity, setup-before-render, retry-domain separation) that double as acceptance criteria.
- **Generation-guard discipline.** Requiring every async op to capture `{sessionId, attemptId}` and dispatch only on match, with cleanup on the stale path, is the correct fix and is stated as a cross-cutting rule rather than a per-call patch.
- **Behavior-change risks are owned.** Fail-closed-by-default is flagged as a breaking change for embeddings, with an explicit opt-in escape hatch and a migration note.
- **Verification is layered and realistic** — focused host tests, helper unit tests, boundary/typecheck gates, and E2E-through-real-input — and explicitly forbids reaching states by poking internal APIs.

## Major gaps or risks

- **Scope/landability.** 13 steps × 7 agents is a program, not a PR. There is no explicit "minimum landable slice." The kernel-ownership fix (§4) and generation guards (§2) are independently shippable and far higher value than registry-versioning (§3) or platform integration (§13); the plan would be stronger if it named that ordering as mandatory vs. optional.
- **Platform coupling.** Steps 3 and 13 depend on plan 066's runtime. If 066 slips, an implementer following step order could build a host registry adapter that is then discarded. The "same shape so the swap is mechanical" guidance mitigates but does not eliminate this.
- **Contract under-specification.** Step 1 enumerates type *names* (`HostRuntimeTarget`, `HostError` union, `HostRetryAction`) but no field-level signatures or target file path. For a plan this detailed elsewhere, the core vocabulary is left more abstract than the steps that consume it.
- **Durable persistence is a hard external dependency, soft-stated.** "Existing-data across reloads" cannot work until kernel/contracts provide durable `AppInstance` storage. The plan flags this as a risk and a dependency but still threads existing-mode work through agents B/C; it should gate existing-mode setup behind that dependency more firmly.
- **Setup vs. launch state-machine overlap.** Step 2 defines a controller state machine and Step 5 defines a setup state machine with overlapping states (`creating-fresh-document`, `creating-managed-tables` appear in both). The relationship (nested? delegated? single machine?) is not pinned down and could produce two competing sources of truth — the exact failure mode the plan is trying to eliminate.
- **Minor:** the plan doesn't mention the heavy `console.log` instrumentation in `AppSlot` (render logging, success logging) that the diagnostics rework should fold into the observability hook.

## Contract and verification assessment

Contracts: strong at the invariant level, slightly thin at the type level. The "single runtime kernel" and "session identity" invariants are precise enough to write failing tests against today. The `HostError` taxonomy is the right idea and directly enables the "stop showing everything as 'App crashed'" UX goal. The gap is that the session-transaction object that would *enforce* "manifest, kernel, bindings, gated API, and component all belong to one launch" is described behaviorally but not given a concrete shape.

Verification: above bar for a planning doc. Gates are real, runnable (by the implementer, not this worker), and matched to the changes. The explicit requirement that stale-completion and deadlock tests drive state through real user-event paths is exactly right for catching the bugs this plan targets. One omission: no gate asserts the *fail-closed* default itself (e.g., a test that a managed app with no capability registry renders `capability-unavailable` rather than the app), which is the highest-risk behavior change.

## Concrete changes that would raise the rating

1. **Add a "minimum landable slice" section** naming §4 (kernel ownership) + §2 (generation guards) + the §8 fail-closed default as the must-ship core, with §3/§9/§13 as follow-ups. This addresses the scope risk directly.
2. **Specify the core contract at field level** in Step 1: concrete TypeScript signatures for `HostRuntimeTarget`, `HostLaunchSuccess`, `HostError`, and a single `LaunchTransaction` object that physically carries `{sessionId, attemptId, sourceKernel, runtimeKernel, bindings, managedTableIds, gatedApi}` so "same kernel" is enforced by construction, not convention.
3. **Reconcile the two state machines** (§2 controller vs. §5 setup) into an explicit nesting/delegation relationship to avoid dual sources of truth.
4. **Add a verification gate for the fail-closed behavior** and for the kernel-identity invariant (a test asserting setup kernel === gated-API kernel === bindings kernel for both fresh and existing modes).
5. **Hard-gate existing-data setup behind durable persistence**: state that existing-mode cross-session detection is out of scope until the kernel/contracts persistence dependency lands, rather than building more UI on `getInstances()`.
6. **Fold the existing `console.log`/`console.error` instrumentation** into the §10 observability hook so the diagnostics story is complete and noisy logs aren't left in the production render path.
