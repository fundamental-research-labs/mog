# 099 — Harden the Shell App-Host: Race-Safe App-Slot Lifecycle, Observable Error Boundaries, and Explicit Host Hooks

## Source folder and scope

**Folder:** `mog/shell/src/host`

**In scope (the host layer that mounts apps into the shell):**

- `ShellHost.tsx` — top-level layout; owns sidebar/header chrome and renders the single `AppSlot`.
- `AppSlot.tsx` — the heart of the host: a launch state machine that gates capabilities, drives setup, wires the error boundary + Suspense, and renders the active app.
- `ErrorBoundary.tsx` — the only crash-isolation primitive for apps.
- `AppCrashedState.tsx`, `AppLoading.tsx`, `AppLoader.tsx` — terminal/loading UI states.
- `AppSetupDialog.tsx`, `AppBindingEditor.tsx`, `ColumnMapper.tsx`, `TablePicker.tsx` — first-run data-binding flow.
- `app-setup.ts` — `ensureAppTables` (deprecated), `createManagedTables`, `resolveBindings`.
- `app-registry.ts` — mutable runtime registry (`APP_IDS`, `APP_MANIFESTS`, `APP_LOADERS`, `registerApps`).
- `index.ts` — the folder's public export surface.
- `hooks/` — `useAppComponent`, `useAppManifests`, `useAppDocument`, `useAppInstanceSetup`, and `app-document-lifecycle.ts` (the §6.1 unload-flush registration).

**Out of scope (consumed, not modified here):** the capability system (`@mog-sdk/contracts/capabilities`, `createCapabilityGatedApi`, `createUngatedAdapter`), `launchApp` in `../app-launcher`, `@mog-sdk/kernel` `DocumentFactory`, the `../services/lifecycle-state` registry, and individual apps under `../apps`. This plan only touches their call-sites in `host/`.

## Current role of this folder in Mog

`host/` is the boundary between the Mog shell and the apps it runs. `ShellHost` lays out chrome and delegates the content area to exactly one `AppSlot`, keyed on `ShellStore.activeAppId`. `AppSlot` is responsible for the entire per-app lifecycle:

1. Look up the manifest from the mutable `APP_MANIFESTS` registry.
2. For apps with `managedTables`, spin up a dedicated per-app document (`useAppDocument`) and run the binding/setup state machine (`useAppInstanceSetup` → `AppSetupDialog` / `AppBindingEditor`).
3. Resolve capabilities and build a capability-gated kernel API via `launchApp` (or fall back to an ungated adapter).
4. Lazy-load the app component (`useAppComponent`) inside `Suspense`, wrapped in `ErrorBoundary` for crash isolation, keyed on `appId` to force a clean remount per app.
5. Render terminal states: `NoAppSelected`, `PermissionDenied`, `AppCrashedState`, `AppLoading`.

`app-document-lifecycle.ts` additionally installs the process-wide `visibilitychange`/`pagehide`/`beforeunload` flush hooks that protect unsaved document state, fanning `flushSync()` across every active doc via the `lifecycle-state` registry.

This is high-blast-radius code: a bug here can crash the whole shell, silently grant an app full ungated kernel access, leak documents into IndexedDB, or lose unflushed edits on tab close.

## Improvement objectives

1. **Make the launch lifecycle race-safe and cancellable.** `AppSlot.doLaunch` is async and writes `setLaunchState` after an `await launchApp(...)`, but nothing guards against `appId` changing (or the component unmounting) mid-flight. A stale success/error from a prior app can land on the current slot.
2. **Make the error boundary observable and correctly resettable.** Today `componentDidCatch` only `console.error`s; `errorInfo` is discarded; there is no host-level `onError`/`onReset` hook; and "Retry" resets boundary state without forcing a remount, so a deterministic crash loops instantly.
3. **Fail closed (or explicitly) on missing capability context.** The current default silently substitutes a *fully ungated* kernel when no capability context is present, behind only a `console.warn`. Absence of policy must not equal full trust.
4. **Make setup / managed-table creation atomic and fail-loud.** `createManagedTables` swallows missing-API errors (returns `{}` + `console.error`), has no rollback if it fails partway through creating N tables, and estimates table height with a hardcoded constant that can overlap real data.
5. **Fix document-lifecycle leaks in `useAppDocument`.** Calling `createFreshDocument()` twice orphans the first handle in the module cache (the ref is overwritten, the old doc is never disposed); every "Start Fresh" permanently accretes a new `app-{id}-{ts}` document in IndexedDB with no eviction.
6. **Structure logging and gate dev-only overhead.** Remove the per-render `console.log`s in `AppSlot`/`AppLoader`, and stop wrapping every app in a `React.Profiler` that calls into `window.__OS_DEVTOOLS__` unconditionally in production.
7. **Define an explicit host-hook contract for embedders.** Expose first-class lifecycle callbacks (`onAppLaunch`/`onAppReady`/`onAppError`/`onAppCrash`/`onPermissionDenied`) on `ShellHostProps`/`AppSlotProps` instead of leaving observability to `console`.
8. **Retire the deprecated public API.** `ensureAppTables` is `@deprecated` (with a documented overlap bug) yet still exported from `index.ts`; migrate remaining callers and remove it from the production surface.

## Production-path contracts and invariants to preserve or strengthen

These are the behavioral contracts the rest of the shell and the apps rely on. The plan must preserve them and, where noted, strengthen them.

- **I1 — Single-slot isolation.** Exactly one app renders at a time; changing `activeAppId` fully tears down the previous app's React subtree and state. (Preserve the `key={appId}` remount.)
- **I2 — No cross-app state bleed via async.** A launch result, setup result, or table list MUST only mutate the slot it was started for. (Strengthen: today this is violated by un-guarded async `setState`.)
- **I3 — Crash isolation.** An exception thrown anywhere inside the active app's render/commit is caught by `ErrorBoundary` and converted to `AppCrashedState`; the shell chrome stays interactive. (Preserve; strengthen with reporting + remount-on-retry.)
- **I4 — Capability gating is the default.** An app receives a capability-gated API unless it is explicitly a legacy/first-party app *and* policy permits ungated access. (Strengthen: ungated must be opt-in, not the silent fallback.)
- **I5 — Setup atomicity.** After setup reaches `ready`, the resolved bindings point at tables that actually exist with the expected columns; a setup that cannot guarantee this MUST surface an error state, never a `ready` with empty/partial bindings. (Strengthen.)
- **I6 — Document-handle conservation.** Every `DocumentHandle` created by `useAppDocument` is eventually `dispose()`d exactly once; no handle is dropped from the cache without disposal. (Strengthen.)
- **I7 — Unload-flush is total and never throws.** The §6.1 hooks fan `flushSync()` across *all* registered active-doc sources; `flushSync()` contract violations are caught and logged, not propagated; the "leave site?" prompt fires only when a doc still has `pendingUpdatesCount > 0 || hasFlushFailed`. (Preserve exactly — this protects unsaved data and is already correctly built.)
- **I8 — Registry is the single source of app truth.** `APP_MANIFESTS`/`APP_LOADERS`/`APP_IDS` are populated only via `registerApps()`, and `registerApps()` fully replaces prior contents atomically. (Preserve; strengthen the read-side casts.)
- **I9 — Loading continuity.** A caller-supplied `loadingFallback` is used for both the launch-gate and the Suspense boundary so there is one continuous loading visual. (Preserve.)

## Concrete implementation plan

### Phase 1 — Race-safe, cancellable launch lifecycle (objectives 1 & 2; invariants I2, I3)

1. **Introduce a launch generation token in `AppSlot`.** Add a `useRef<number>` "generation" counter incremented whenever `appId` changes (or on unmount). Capture the current generation at the top of `doLaunch`; before every `setLaunchState(...)` inside the async body (success/denied/error branches and the `catch`), bail if the captured generation no longer matches the live ref. Do the same in the `useEffect` that calls `kernel.tables.list().then(setBindingEditorTables)` so a stale table list can't populate the binding editor of a different app. This closes I2 without changing the happy-path behavior.
2. **Audit and tighten the launch `useEffect` dependencies.** The effect currently depends on the whole `setupResult.state` object and on `doLaunch` (which is itself rebuilt when `kernel`/`capabilityContext`/`showConsentDialog`/`createGatedApi` change). Narrow the trigger to `setupResult.state.status` (+ the specific `managedTableIds`/`bindings` it reads) so identity churn in unrelated fields can't re-fire a launch. Keep `doLaunch` stable by ensuring its `useCallback` deps are minimal.
3. **Reset error-boundary state on retry by remount, not by clearing state.** `ErrorBoundary.reset` currently just sets `error: null`, re-rendering the same (still-broken) children — a deterministic crash re-throws synchronously. Change the host so retry bumps a `resetKey` that is folded into the boundary's `key` (e.g. `key={`${appId}:${resetTick}`}`), forcing a true remount of the Suspense+AppLoader subtree. Keep `appId` in the key to preserve I1.
4. **Capture and surface `errorInfo`.** Extend `ErrorBoundaryProps` with an optional `onError?(error, errorInfo)` and store `errorInfo` in state; pass it through to the `fallback` signature `(error, reset, errorInfo?)`. `AppCrashedState` can then show the component stack in dev alongside the existing error stack.

### Phase 2 — Observable error boundary and host hooks (objectives 2 & 7; invariant I3)

5. **Add a host-hook contract.** Extend `AppSlotProps` (and thread through `ShellHostProps`) with optional callbacks:
   - `onAppLaunch?(appId)` — fired when a launch begins.
   - `onAppReady?(appId)` — fired when state transitions to `success`.
   - `onPermissionDenied?(appId, deniedCapabilities)` — fired on the `denied` branch.
   - `onAppError?(appId, error)` — fired on launch/setup failure.
   - `onAppCrash?(appId, error, errorInfo)` — fired from the `ErrorBoundary` `componentDidCatch` path.

   These replace ad-hoc `console.*` as the observability seam; the shell's existing telemetry can subscribe. All callbacks are optional and side-effect-only, so embedders that ignore them see no behavior change.
6. **Wire `ErrorBoundary.componentDidCatch` to `onAppCrash`** via the new `onError` prop, keeping the `console.error` only as a dev fallback. This makes app crashes reportable to ops instead of vanishing into the console.

### Phase 3 — Fail-closed capability gating (objective 3; invariant I4)

7. **Make the ungated fallback explicit.** Today, both `createGatedApi` and `doLaunch` fall back to `createUngatedAdapter(kernel)` whenever `capabilityContext` is absent or a manifest lacks `capabilities`, behind a `console.warn`. Replace the silent default with an explicit, prop-driven policy on `AppSlotProps`: `allowUngatedFallback?: boolean` (default `false`). When a launch would require the ungated fallback and the flag is not set, transition to a dedicated terminal state (`status: 'error'` with a clear "capability policy unavailable" message routed through `onAppError`) instead of silently handing the app the full kernel.
8. **Preserve the legitimate legacy path.** First-party legacy apps that genuinely run ungated must set `allowUngatedFallback` at the embedding site (e.g. dev-app / first-party shell). Document this in the prop's JSDoc and in `index.ts`. This converts an implicit security posture into an auditable one without breaking real first-party usage.

### Phase 4 — Atomic, fail-loud setup and managed-table creation (objective 4; invariant I5)

9. **Throw instead of returning empty bindings.** In `createManagedTables`, the `!tablesAPI?.create || !columnsAPI?.list` branch currently logs and returns `{}`; `createTablesInFreshDocument` then proceeds to `createInstance` + `completeSetup` with empty bindings and lands in `ready`. Change `createManagedTables` to throw a typed error on missing APIs and on any per-table creation failure, and let `useAppInstanceSetup`'s existing `try/catch` route it to `status: 'error'`. This enforces I5.
10. **Make multi-table creation rollback-aware.** When creating N managed tables on a freshly created sheet, a failure on table k leaves a partial sheet. Wrap the loop so that on failure the partially created sheet/tables are torn down (or the whole fresh document is discarded — see Phase 5), and the error is surfaced. Capture created table IDs as we go to enable cleanup.
11. **Derive table placement from schema, not a constant.** `DEFAULT_DATA_ROWS = 10` can under-reserve space and overlap user data. Compute reserved rows from the schema (or accept an explicit per-table row hint in the manifest schema) so sequential placement can't collide. Keep `TABLE_GAP_ROWS` as a separation buffer.

### Phase 5 — Document-handle conservation in `useAppDocument` (objective 5; invariant I6)

12. **Dispose the prior handle before replacing it.** `createFreshDocument` overwrites `currentDocumentIdRef.current` with the new doc ID; if it was already set, dispose the previous cached handle first so it isn't orphaned. Guard against the in-flight case where the component unmounts after `getCachedOrCreateDocument` resolves but before `setHandle` — track the latest requested ID and dispose any handle that resolves after the ref has moved on (mirrors the Phase 1 generation pattern).
13. **Add a deterministic eviction policy.** "Old documents persist in IndexedDB" is an unbounded storage leak across repeated "Start Fresh". Add an explicit retention policy for app-scoped fresh documents (e.g. dispose+delete the previous fresh document for the same `appId` when a new one is created, since the prior one is unreachable from the UI once superseded). This is a product decision — see Risks — but the leak must be addressed rather than documented away.
14. **Keep the §6.1 lifecycle registration untouched.** `app-document-lifecycle.ts` and `registerLifecycleHooks(getActiveDocs)` correctly implement I7. The only change here is ensuring `getActiveDocs()` continues to reflect the cache after the new disposal logic — i.e. disposed docs are removed from `documentCache` so they're not flushed post-disposal.

### Phase 6 — Logging, dev-only overhead, and registry typing (objectives 6 & 8; invariant I8)

15. **Remove per-render `console.log`s.** Delete the unconditional `console.log('[AppSlot] Rendering...')` and `console.log('[AppLoader] Loading app...')` and the success/legacy-path logs. Route anything genuinely useful through the Phase 2 host hooks or an `isDev()`-gated logger (the codebase already exposes `isDev` from `@mog/env`, used in `AppCrashedState`).
16. **Gate the `React.Profiler`.** Wrap the app in `React.Profiler` only when devtools are present (`window.__OS_DEVTOOLS__`) or in dev builds; in production render the app subtree directly to avoid the profiler's per-commit `onRender` overhead and the unconditional global lookup.
17. **Type the registry reads.** Replace `APP_MANIFESTS[appId] as AppManifestWithCapabilities` and `kernel as IGatedAppKernelAPI` (in `createManagedTables`) with checked narrowing helpers so contract drift surfaces at the boundary instead of as a runtime cast. `registerApps` already replaces contents atomically (I8) — add a dev-time assertion that `manifests` and `loaders` key-sets agree so a manifest without a loader (the `AppLoader` "app not found" path in the success branch) is caught at registration, not at render.
18. **Remove `ensureAppTables` from the public surface.** It is `@deprecated` with a documented A1-overlap bug. Migrate any residual callers to `createManagedTables`/`resolveBindings`, then drop its export from `index.ts` and delete the function. (Search the monorepo for importers before removal.)

### Phase 7 — Multi-instance correctness in `useAppInstanceSetup` (objective 4 follow-on; invariant I5)

19. **Address the `instances[0]` shortcut.** `useAppInstanceSetup` picks `instances[0]` with a "for now" comment, silently ignoring additional instances. Decide and implement the production contract: either (a) the host explicitly supports one instance per `appId` and rejects/cleans extras, or (b) the slot accepts an `instanceId` selector. Pick (a) unless multi-instance is a near-term product need; document the choice. The implicit `pendingFreshSetup` boolean + effect coupling should be folded into the `SetupState` machine as an explicit `creating-fresh` status so the flow is legible and testable.

## Tests and verification gates

> Per task constraints this plan does not run any build/test/typecheck commands. The following are the gates a subsequent implementation PR must pass; they describe what to add, not commands run here.

- **Unit (host hooks, jsdom):** extend the existing `hooks/__tests__/useAppDocument-lifecycle.test.ts` pattern.
  - `useAppDocument`: double `createFreshDocument()` disposes the first handle exactly once (I6); unmount-after-resolve disposes the resolved handle; disposed docs leave `documentCache` (so `getActiveDocs()` excludes them).
  - `useAppInstanceSetup`: missing-API/`createManagedTables`-throw lands in `status: 'error'`, never `ready` with empty bindings (I5); `creating-fresh` status transitions correctly.
  - `app-document-lifecycle`: keep all existing §6.1 tests green — `visibilitychange`/`pagehide` flush all docs, `flushSync` throw is swallowed, `beforeunload` prompts only when pending/failed (I7). No regression allowed.
- **Component tests (AppSlot):**
  - Race: change `appId` while a `launchApp` promise is in flight → the stale resolution does not call `setLaunchState` on the new slot (I2).
  - Capability fail-closed: no capability context + `allowUngatedFallback` unset → terminal error + `onAppError` fired, app never receives an ungated kernel (I4); with the flag set, legacy path still renders.
  - Error boundary: a child that throws renders `AppCrashedState` and fires `onAppCrash(appId, error, errorInfo)`; "Retry" remounts (a child that throws once-then-succeeds recovers; a deterministic thrower re-shows the crash state without an infinite synchronous loop) (I3).
- **Host-hook contract test:** `onAppLaunch`/`onAppReady`/`onPermissionDenied`/`onAppError` fire in the expected order for the happy path, the denied path, and the error path.
- **Registry test:** `registerApps` with a manifest lacking a matching loader trips the new dev assertion; reads no longer rely on unchecked casts.
- **Static gates:** `pnpm --filter @mog/shell typecheck` and lint clean; a grep gate asserting no unconditional `console.log` remains in `AppSlot.tsx`/`AppLoader.tsx`. If contract types change, run `pnpm --filter @mog-sdk/contracts build` first (see [[mog-contracts-declaration-rollup]]).
- **App-eval smoke:** a shell scenario that launches a managed-tables app (Start Fresh → tables created → app renders), then forces a crash, hits Retry, and confirms recovery — exercised through the existing app-eval harness ([[app-eval-usage]]). Watch for the feature-gate/state-leak harness gotchas in [[ribbon-collapse-width-based]] and async overlay races in [[app-eval-async-overlay-race]].

## Risks, edge cases, and non-goals

**Risks / edge cases:**

- **Fail-closed capability change is behavior-breaking by design.** Any embedder relying on the silent ungated fallback will now hit a terminal error unless it sets `allowUngatedFallback`. Mitigation: set the flag at the known first-party embedding sites in the same PR and call it out in release notes. This is the intended hardening, not a regression.
- **Document eviction is a product decision.** Auto-deleting a superseded "Start Fresh" document (Phase 5, step 13) changes durability expectations — a user who did "Start Fresh" twice can no longer recover the first. The alternative (bounded LRU, or a "recent documents" surface) may be preferable; flag for product sign-off before implementing the destructive variant. The non-negotiable part is that handles are disposed (I6) and not flushed post-disposal.
- **Generation-token guarding must not deadlock the happy path.** The token check must only suppress *stale* writes; ensure the first (current-generation) launch still completes. Cover with the race test above.
- **Profiler gating must not change app layout.** The wrapper `<div className="flex flex-col flex-1 min-h-0 w-full h-full">` and the `React.Profiler` are siblings in the tree; removing the Profiler in prod must keep the wrapper and the sizing contract (I9) intact.
- **Removing `ensureAppTables`** requires a monorepo-wide importer search; if any production caller remains it must be migrated first, not just the export dropped.
- **Resize/identity gotcha awareness:** managed-table creation touches grid axis identity; be mindful of the data-dependent `SheetNotFound` class of issues recorded in [[resize-sheetnotfound-misleading]] when changing table placement (Phase 4, step 11).

**Non-goals:**

- No redesign of the capability/`launchApp` machinery itself (owned by `app-launcher` / contracts) — only its call-site policy in `host/`.
- No changes to the §6.1 unload-flush semantics in `app-document-lifecycle.ts` beyond keeping the cache consistent (I7 is already correct).
- No restyle/i18n pass of the terminal-state UIs (`AppCrashedState`, `PermissionDenied`) — tracked separately; this plan only adds the dev-mode `errorInfo` surface.
- No new app-binding UX (the `AppBindingEditor`/`ColumnMapper`/`TablePicker` wizard stays as-is functionally).
- No test-only or shim fixes: every change above is a production-path change.

## Parallelization notes and dependencies on other folders

- **Phases 1, 2, 6 are independent** and can land in parallel — they touch `AppSlot.tsx`, `ErrorBoundary.tsx`, `AppLoader.tsx`, and `index.ts` with little overlap. Phase 2's `onAppCrash` depends on Phase 1's `errorInfo` capture (step 4), so order those within the same PR.
- **Phase 3 (fail-closed)** is self-contained in `AppSlot.tsx` but requires a coordinated change at first-party embedding sites *outside* this folder (dev-app / shell entrypoints) to set `allowUngatedFallback`. Sequence: add the prop (default false) and embedder flags in one PR.
- **Phases 4 & 7** are coupled (both in `useAppInstanceSetup` / `app-setup.ts`) and should land together; they depend on the `@mog-sdk/contracts/apps` and `@mog-sdk/contracts/capabilities` types — if the managed-table schema gains a row-hint field (step 11) that is a cross-folder contracts change requiring the declaration rollup ([[mog-contracts-declaration-rollup]]).
- **Phase 5** is isolated to `useAppDocument.ts`/`app-document-lifecycle.ts` but interacts with `@mog-sdk/kernel` `DocumentFactory`/`DocumentHandle` disposal semantics and the `../services/lifecycle-state` registry — verify the disposal change keeps `iterateActiveDocsForFlush()` consistent.
- **Phase 6 step 18 (remove `ensureAppTables`)** depends on a monorepo importer search spanning apps and dev tooling; do this last so the other phases aren't blocked on the migration.
- No dependency on the pre-existing dirty paths in `mog-internal` (api-eval/app-eval scenarios, fixtures, launch script); this plan neither reads from nor modifies them.
