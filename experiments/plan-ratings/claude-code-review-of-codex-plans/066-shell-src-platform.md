Rating: 8/10

# Review of 066 — Shell Platform Abstraction and Lifecycle Conformance


## Summary judgment

This is a strong, evidence-grounded plan. Its central thesis — that `shell/src/platform` is a well-built but unwired "test-only scaffold" that does not actually govern the production app launch path — is accurate and verifiable against the source. The plan correctly identifies the real production seam (`createShell()` → `AppSlot`/`launchApp()` → mutable global registry) and proposes the right architectural move: a per-shell `ShellPlatformRuntime` owned by bootstrap, with the hardcoded trust set and global app registry retired in favor of the platform's existing trust/isolation/registry services. The contracts-and-invariants section is unusually disciplined and would survive as a conformance spec on its own.

The deductions are for an optimistic parallelization story that hides genuine sequential dependencies, the lack of phasing/milestones for what is effectively a re-platforming, and an under-specified treatment of the single highest-risk integration (the spreadsheet `AppProps` → `AppHostContext` adapter).

## Verification of the plan's claims against source

Every load-bearing factual claim I checked is true:

- `app-instance-manager.ts:131-138` — `launchInstance()` is pure bookkeeping with the literal comment "same-realm-first-party only, so we just mark as running. In future versions, this would set up iframe/worker sandboxes, resolve resource bindings, and initialize host services." This is exactly the gap the plan targets.
- `create-shell.ts` initializes `IPlatform`, project service, etc., but instantiates no `PackageRegistryService`/`AppRegistryService`/`AppInstanceManager`. Confirmed.
- `app-launcher/launch-app.ts:123` — `export const TRUSTED_FIRST_PARTY_APPS = new Set([...])` is the hardcoded launch authority. Confirmed.
- `host/app-registry.ts:18-44` — mutable module globals `APP_IDS`, `APP_MANIFESTS`, `APP_LOADERS` cleared/reassigned in place. Confirmed.
- `host/AppSlot.tsx:26,265` — `AppSlot` imports and calls `launchApp()` directly, owning consent/capabilities. Confirmed.
- Contract drift is real and precise: `platform/types.ts:5-9` says it mirrors `@mog-sdk/types-app-platform` "until the canonical contracts package … exists. Once that package exists, this file becomes a re-export shim." That package now exists (`types/app-platform/src` with `@mog-sdk/types-app-platform` and `./manifest`, `./package`, `./lifecycle`, … subpath exports). The `entry.export` divergence is exact: the type is optional (`types.ts:74 readonly export?: string`) but `manifest-validator.ts:71-72` rejects a missing `entry.export` as required.

Grounding this thoroughly is what justifies the high rating — the plan is not speculative.

## Major strengths

- **Correct production seam.** It names the precise files that bypass the platform and proposes replacing them rather than shimming around them (explicit non-goal: no `launchApp()` compatibility path). This avoids the classic failure mode of building a second parallel lifecycle.
- **Invariant-first.** The "contracts and invariants" section (per-shell isolation, fail-closed enumeration, lease privacy, contribution determinism / no entry-code import, boundary integrity, exactly-once disposal) reads as testable acceptance criteria, not prose.
- **Fail-closed runtime-host policy is the right call.** Distinguishing structural manifest validity from current host executability — register all valid `runtimeHost` modes, but block `enabled`/`running`/`active` for worker/iframe/server/remote until bridges exist — is the correct production stance and is reinforced by an explicit regression test (worker-sandbox must not be silently stored as same-realm).
- **Verification gates are concrete and scoped** (package-level `pnpm test -- src/platform`, typecheck at shell + types/app-platform + repo root, spreadsheet impact, and a UI path exercised through real input rather than test-state mutation).
- **Disposal/edge-case coverage** (partial-startup cleanup → `crashed`, double-close idempotency, shell-dispose-during-launch, React unmount during launch) targets exactly the bugs this kind of lifecycle rewrite produces.

## Major gaps or risks

- **Parallelization understates real ordering.** Agents A–F are presented as "naturally parallelizable," but B (runtime factory) depends on A's contract alignment, C (instance lifecycle/`AppSlot` replacement) depends on B's runtime and D's binding service, and F (conformance) depends on all of them. There is no milestone sequencing (e.g., "land A behind no behavior change → B wiring dormant → C cutover"). For a change that retires global registry ownership and the launch path simultaneously, the absence of a staged-cutover / feature-flag strategy is the biggest weakness. A half-applied cutover leaves two registries fighting.
- **Spreadsheet adapter is the riskiest item and the least specified.** The plan acknowledges the `AppProps` (capability-gated kernel API) vs. `AppHostContext` (product-neutral) mismatch and prescribes "a typed React app runtime adapter owned by shell," but doesn't specify its shape, where it lives, or how the spreadsheet keeps launching during the transition beyond "until the spreadsheet app fully consumes `AppHostContext`." Since spreadsheet is the only real first-party app, this adapter is on the critical path and deserves its own contract sketch.
- **Missing dependency mechanics.** `shell/package.json` does not currently depend on `@mog-sdk/types-app-platform`. Step 1 says "import/re-export from the canonical package" but never calls out adding the workspace dependency or the recall-relevant build/declaration ordering (per repo memory, contracts-style packages need a build before consumers typecheck). The repo-root typecheck gate would catch a miss, but the plan should state the wiring step.
- **Existing conformance suite will break, and the plan treats it only as additive.** `__tests__/conformance/app-lifecycle-e2e.test.ts` etc. almost certainly assert today's "mark running" shortcut. Step 10 adds production-path fixtures but doesn't flag that current conformance tests encode the very behavior being removed and must be rewritten, not just extended. This is a sequencing landmine for agent F.
- **Capability normalization is a footnote, not a step.** The risk list correctly notes manifest capabilities are strings while the kernel uses capability types/composites, but the implementation plan never assigns the "normalize/expand through the capability registry" work to a step or agent. It's the join point between the new platform and the existing security model and should be first-class.

## Contract and verification assessment

Contract clarity is the plan's best dimension. It picks a definite resolution for the `entry.export` drift (optional with explicit defaulting, matching canonical) rather than leaving it open, and it correctly designates `@mog-sdk/types-app-platform` as the single public source with shell-local types confined to implementation concerns. The boundary contract (third-party may import `@mog/shell/platform` + canonical subpaths only; first-party exemptions must be explicit bootstrap-configured IDs, not validator defaults) is precise and matches the existing `PackageBoundaryValidator` intent.

Verification gates are appropriate for a planning worker (no commands run here) and well-targeted for the implementer. Two gaps: (1) no gate asserts the *negative* — that the old `launchApp()`/global-registry path is actually gone (e.g., a grep/import-graph check or a test that `AppSlot` no longer imports `launch-app`), which matters given the explicit non-goal of keeping it; (2) the UI gate lists scenarios but no oracle for "denied launch" / "forced loader failure" beyond manual observation. A scripted app-eval-style assertion would make the cutover reg-testable.

## Concrete changes that would raise the rating

1. **Add a staged cutover plan with a flag.** Land contract alignment (A) as a no-behavior-change step; stand up `ShellPlatformRuntime` (B) dormant; cut `AppSlot`/app-switcher over (C) behind a bootstrap flag with the old path removable in a final step. Define the ordering A → {B, D} → C/E → F explicitly rather than "parallelizable."
2. **Specify the React app runtime adapter.** Give its interface (input: launch descriptor; output: renderable + capability-gated props), its home in `shell/src/platform` or `shell/src/host`, and the exact bridge that keeps spreadsheet launching during transition.
3. **Promote capability normalization to a numbered step/agent** with the registry expansion path named, since it's the security join point.
4. **State the `@mog-sdk/types-app-platform` workspace dependency add** and any declaration-build ordering in Step 1.
5. **Call out rewriting the existing conformance suite**, not just adding fixtures — list which current tests encode the soon-removed shortcut.
6. **Add negative verification gates**: an import-graph/grep assertion that `launchApp` and `APP_IDS/APP_MANIFESTS/APP_LOADERS` are no longer the live authority, plus scripted oracles for denied-launch and loader-failure.

## Notes on review scope

`mog/shell/src/platform` was treated as a public Mog source folder and inspected read-only; all internal assessment is confined to this file under `mog-internal`. No plan or production files were modified.
