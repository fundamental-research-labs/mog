# 099 - Shell Host Lifecycle, Setup, and Recovery Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/shell/src/host`

Queue item: 99, `mog/shell/src/host`, app slot lifecycle, error boundaries, and host hooks.

This plan targets the public Mog shell host folder and the production paths that depend on it:

- `mog/shell/src/host/ShellHost.tsx`: shell chrome layout, active app slot placement, sidebar/file explorer integration, portal container provider, and app-slot prop forwarding.
- `mog/shell/src/host/AppSlot.tsx`: current app launch coordinator for manifest lookup, managed-table setup, capability consent, gated API creation, launch state, Suspense, and render error isolation.
- `mog/shell/src/host/AppLoader.tsx`, `AppLoading.tsx`, `AppCrashedState.tsx`, and `ErrorBoundary.tsx`: app component lazy loading and runtime fallback surfaces.
- `mog/shell/src/host/hooks/*`: app manifest/component hooks, app document lifecycle hooks, and app instance setup hooks.
- `mog/shell/src/host/app-registry.ts` and `index.ts`: current mutable app registration surface and host barrel exports.
- `mog/shell/src/host/app-setup.ts`, `AppSetupDialog.tsx`, `AppBindingEditor.tsx`, `ColumnMapper.tsx`, and `TablePicker.tsx`: managed table creation, existing-data binding, binding validation, and first-run setup UI.
- Production callers in `runtime/spreadsheet-app/src/app-attachment.tsx`, app switchers in `shell/src/apps`, and adjacent lifecycle services in `shell/src/platform`, `shell/src/services`, and `kernel` where they define contracts the host must consume.

This plan does not edit production code. It deliberately complements plan 066 for `shell/src/platform` and plan 067 for `shell/src/services`: `shell/src/platform` should own package/app lifecycle authority, `shell/src/services` should own shell document/project services, and `shell/src/host` should become the React host boundary that renders a verified platform-launched app session.

## Current role of this folder in Mog

`ShellHost` is the top-level React layout for the shell. It reads `activeAppId` from the shell store, renders header/chrome/sidebar/file explorer, and delegates app rendering to `AppSlot`. It does not own a platform app instance, runtime handle, or close/suspend lifecycle.

`AppSlot` is currently the real production coordinator. It reads `APP_MANIFESTS`, decides whether an app needs managed-table setup, asks `useAppDocument` for a per-app document, asks `useAppInstanceSetup` to resolve or create bindings, calls `launchApp()` for capability consent and gated API creation, manages launch/error/denied/loading state, and renders `AppLoader` inside `Suspense` and `ErrorBoundary`.

The current host registry is module-global and mutable. `registerApps()` replaces `APP_IDS`, `APP_MANIFESTS`, and `APP_LOADERS`; `useAppManifests()` memoizes `Object.values(APP_MANIFESTS)` once; `useAppComponent()` caches `React.lazy(loader)` only by `appId`. This path is separate from `shell/src/platform`'s package/app registry and app instance manager.

The setup path is split across `AppSlot`, `useAppDocument`, `useAppInstanceSetup`, and `app-setup.ts`. Fresh-start setup is intended to create isolated app data in an app-specific document, while existing-data setup is intended to bind tables from the current workbook. Today those modes are not represented as distinct runtime contracts. `AppSlot` can resolve bindings against one kernel and then construct the gated runtime API from another.

The error path is mostly UI fallback. `ErrorBoundary` logs to `console.error` and exposes a local `reset`; `AppCrashedState` shows a generic crash view. There is no typed error domain, no app/session metadata in boundary reporting, no lazy-loader cache invalidation on retry, and no distinction between setup retry, launch retry, document retry, and render-boundary reset.

Existing tests under this folder are narrow. There is focused coverage for the extracted `app-document-lifecycle.ts` unload hook registration, but no direct production-path tests for `AppSlot`, setup state transitions, stale async launch guards, registry updates, lazy-load failures, denied permission retry, or render crash recovery.

## Improvement objectives

1. Make `shell/src/host` a React rendering boundary over one canonical app session lifecycle, not the authority for package registry, capability policy, setup persistence, and runtime identity.
2. Replace ad hoc `AppSlot` state with a typed app-slot controller that is keyed by app ID, session ID, attempt ID, manifest version, loader version, setup mode, runtime kernel, bindings, and capability result.
3. Guarantee that manifest, setup document, runtime kernel, bindings, managed table IDs, gated API, lazy component, and render subtree all belong to the same active launch transaction.
4. Split fresh-start and existing-data setup into explicit modes with separate kernel contracts: fresh uses the app document kernel end to end; existing uses the parent workbook kernel end to end.
5. Move manifest-aware binding validation out of UI components and into a shared production helper that validates logical tables, required columns, type compatibility, duplicate mappings, stale IDs, and app-instance completeness before declaring setup ready.
6. Make async lifecycle operations generation-guarded and idempotent: document creation, binding resolution, table listing, consent, launch, dynamic import, retry, cancel, app switch, unmount, and shell dispose must not publish stale state.
7. Make capability mode explicit. Production app launch should fail closed without a capability authority unless the embedding shell intentionally opts into a permissive legacy mode.
8. Make app loading retryable in reality. A failed dynamic import must be clearable by retry through a loader cache key or invalidation path, not only by resetting a React error boundary.
9. Improve app crash isolation and diagnostics without leaking raw internals in production UI: error domain, app ID, session ID, attempt ID, component stack, phase, sanitized user message, dev-only details, and host observability hooks.
10. Preserve existing `ShellHost`, `AppSlot`, and root `@mog/shell` compatibility while narrowing `@mog/shell/host` internals rather than broadening them as a public app author surface.

## Production-path contracts and invariants to preserve or strengthen

- Shell chrome isolation: an app setup failure, load failure, render crash, or async launch rejection must not unmount `ShellHost`, file explorer, title bar, settings entrypoint, or the outer spreadsheet attachment boundary.
- Session identity: only the latest active app session may publish state. A stale consent result, stale binding resolution, stale document creation, stale table list, or stale dynamic import from a prior app/session must be ignored and disposed if it created resources.
- Single runtime kernel: for any rendered app, `bindings`, `managedTableIds`, `DocumentHandle`, `IAppKernelAPI`, `IGatedAppKernelAPI`, and app component props must all reference the same intended document/workbook.
- Fresh-start semantics: "Start fresh" creates isolated app data and launches the app against that isolated app document. It must not list or resolve parent workbook tables after the user chose fresh mode.
- Existing-data semantics: "Use existing data" binds tables from the current workbook and launches the app against the parent workbook. It must not resolve existing workbook IDs through a fresh app document.
- Setup-before-render: apps with `manifest.managedTables` must not render until setup is either not required or is complete with validated `ResolvedBindings`.
- Binding validity: setup readiness requires all manifest-required tables/columns to resolve by stable IDs and match the manifest enough for the app to rely on the binding contract. Missing tables, stale IDs, duplicate logical mappings, incompatible required types, and invalid relation targets remain setup errors.
- Capability gating: app components receive only the gated runtime API for their session. Missing capability registry is either a typed fail-closed launch denial or an explicit host-configured permissive mode.
- Registry truth: user-visible app lists, manifest lookup, component loader lookup, and active app launch must read from the same registry snapshot or subscribed platform runtime. Module globals may remain only as a registration adapter during migration.
- Lazy component identity: `React.lazy` components remain referentially stable for a valid loader version, but loader failures can be retried by changing a retry key or invalidating the failed cache entry.
- Retry domains: setup retry, document retry, launch/consent retry, lazy-load retry, and render-crash reset are separate actions with separate effects. A render-boundary reset must not silently bypass setup or reuse stale bindings.
- Cancellation and idempotency: double-clicks on setup actions, repeated retry clicks, app switch during setup, unmount during launch, and shell dispose during document creation must be deterministic and must not leak document handles.
- Lifecycle hook registration: `app-document-lifecycle.ts` must keep idempotent listener install and multi-source active document registration so app documents and shell documents both participate in unload flushing.
- Loading UX: custom `loadingFallback` remains a continuous visual across launch and Suspense loading. Host changes should not reintroduce sequential spinner/skeleton flicker.
- Public boundary: app/plugin packages should not import host internals through a new `@mog/shell/host` subpath unless that is intentionally designed as a public contract. Root exports should stay coherent, especially around `AppLoader` type vs component naming.

## Concrete implementation plan

### 1. Define the host app-session contract

Add a small host lifecycle contract module under `shell/src/host`, or consume the equivalent from the platform runtime if plan 066 lands first. The contract should make the production state explicit:

- `AppHostSessionId`, `AppLaunchAttemptId`, and `AppLoaderVersion` identifiers.
- `HostSetupMode = 'none' | 'fresh-document' | 'existing-workbook'`.
- `HostRuntimeTarget` containing `appId`, `manifest`, `sourceKernel`, `runtimeKernel`, optional `documentHandle`, `setupMode`, `bindings`, and `managedTableIds`.
- `HostLaunchSuccess` containing the target plus the gated API and loader descriptor.
- `HostError` union for `manifest-not-found`, `setup-required`, `setup-validation-failed`, `document-create-failed`, `binding-resolution-failed`, `capability-denied`, `capability-unavailable`, `launch-failed`, `loader-failed`, `render-crashed`, and `cancelled`.
- `HostRetryAction` union that states which domain is being retried and which state must be reset.

This contract becomes the vocabulary used by `AppSlot`, setup hooks, app loader, error fallback UI, and tests. It should not embed React-specific state in the core session result except at the final render descriptor boundary.

### 2. Replace `AppSlot`'s ad hoc state with a reducer/controller

Move `AppSlot` orchestration into a dedicated controller hook, for example `useAppSlotController()`, backed by a reducer or XState machine. Required states:

- `idle`: no active app.
- `resolving-manifest`: registry snapshot lookup is in progress.
- `setup-choice`: app requires managed tables and user must choose fresh vs existing.
- `creating-fresh-document`: app document creation is in flight.
- `creating-managed-tables`: fresh app tables are being created.
- `binding-existing`: existing workbook table/column mapping is active.
- `resolving-bindings`: stored or edited bindings are being validated and resolved.
- `requesting-capabilities`: consent/auto-grant is in flight.
- `launching`: gated runtime API and loader descriptor are being finalized.
- `running`: app can render.
- `denied`: launch denied by capability policy or user decision.
- `failed`: setup/document/launch/lazy-load failure.
- `crashed`: render subtree threw.
- `closing`: active session is being torn down after app switch/unmount/shell dispose.

Every async operation must capture `{sessionId, attemptId}` and dispatch only if those IDs still match current state. Operations that create disposable resources must attach cleanup to the stale-result path. This is the central fix for stale consent, stale document creation, stale table listing, stale binding resolution, and stale launch completion.

### 3. Establish one registry source for the host

Create a subscribed host registry adapter that can read from the platform runtime once available and can temporarily adapt `registerApps()` without remaining the authority:

- Replace direct `APP_MANIFESTS` and `APP_LOADERS` reads in `AppSlot`, `useAppManifests`, and `useAppComponent` with `useHostAppRegistry()` or a platform runtime context.
- Expose registry snapshots with a monotonic version. Include manifest, loader, enabled/disabled state, and diagnostics.
- Make `useAppManifests()` update when the registry version changes instead of memoizing `Object.values(APP_MANIFESTS)` for the component lifetime.
- Cache lazy components by `{appId, loaderVersion, retryNonce}` rather than `appId` alone.
- Keep `registerApps()` as a startup/catalog adapter for existing side-effect registration, but route its writes through the same registry service used by `ShellHost` and app switchers.
- Preserve package boundary checks: do not add broad public `@mog/shell/host` exports as a shortcut.

This step should be sequenced with plan 066. If the platform runtime is not ready, implement the host adapter with the same shape so the platform swap is mechanical.

### 4. Fix managed-table runtime ownership

Split setup into two explicit contracts.

Fresh-start mode:

- User chooses fresh mode from the setup dialog.
- Controller creates a fresh app document and constructs the app kernel from that document.
- Managed tables are created in that same app document.
- Bindings are persisted and resolved in that same app document.
- Capability gating uses that same app document kernel as `fullApi`.
- App renders with that same gated API and those bindings.
- The app document handle is part of the active session and is disposed according to the session/document ownership policy.

Existing-data mode:

- User chooses existing mode from the setup dialog.
- Table choices are loaded from the parent workbook kernel.
- Binding editor validates and persists app instance bindings in the parent workbook.
- Binding resolution uses the parent workbook kernel.
- Capability gating uses the parent workbook kernel as `fullApi`.
- App renders with that same gated API and those bindings.

The current mixed model, where `useAppInstanceSetup` may resolve against `appDocument.kernel` while `createCapabilityGatedApi()` uses the parent `kernel`, must be eliminated before adding more app setup features.

### 5. Redesign setup state and persistence

Replace `useAppInstanceSetup`'s implicit `checking` flow with an explicit setup state machine:

- `disabled`: no managed tables.
- `checking-existing-instance`: reading persisted app instances.
- `needs-choice`: no valid complete instance found.
- `creating-fresh-document`.
- `creating-managed-tables`.
- `loading-existing-tables`.
- `mapping-existing-tables`.
- `validating-bindings`.
- `ready`.
- `cancelled`.
- `error`.

The hook/controller should accept the chosen setup mode and runtime kernel instead of inferring the kernel from a nullable `appDocument.kernel`. It should also expose pending state so `AppSetupDialog` and `AppBindingEditor` can disable duplicate submissions.

Persist `AppInstance` records before relying on `getInstances()` for cross-session behavior. The current in-memory bindings API is not enough for "existing setup" semantics across reloads. If kernel persistence is not ready, represent that as a blocking dependency in the implementation workstream rather than building more UI around non-durable state.

### 6. Add manifest-aware binding validation

Move binding validation into a shared helper near `app-setup.ts` or a contracts-facing app binding module:

- Validate that every `manifest.managedTables` logical table has exactly one binding unless the manifest explicitly marks it optional.
- Validate required columns are mapped.
- Validate mapped table IDs and column IDs exist in the selected runtime kernel.
- Validate duplicate logical columns, duplicate actual columns where disallowed, stale IDs, missing column mappings, and missing logical tables.
- Validate type compatibility for required columns. Support explicit compatibility rules instead of exact string comparison where Mog's column type system allows safe coercions.
- Validate relation/lookup/rollup columns against relation targets when those app column kinds are present.
- Produce typed diagnostics that `AppBindingEditor`, `AppCrashedState`, and tests can assert without parsing log strings.

`AppBindingEditor` should stay a UI for collecting choices. It should not be the only place where required-column validity is enforced.

### 7. Make table creation match the declared setup contract

Audit `createManagedTables()` against the actual `IAppKernelAPI` and gated API surfaces:

- If dedicated-sheet creation is a product requirement, add a real sheet/surface contract to the app kernel path and gate it through capabilities.
- If app kernels intentionally do not expose sheets, change the setup contract and UI copy to avoid promising dedicated sheets.
- Keep table placement non-overlapping and deterministic.
- Return structured `CreateManagedTablesResult` with bindings plus diagnostics instead of silently returning partial empty bindings when required APIs are missing.
- Add rollback or explicit partial-failure diagnostics for table creation failures after some tables were created.

Do not leave optional `kernel.sheets?.create` as the only implementation of a documented "dedicated sheet" behavior.

### 8. Make capability behavior explicit and fail closed by default

Replace the current "no capability context means ungated adapter and auto-allow" default with explicit host configuration:

- `capabilityMode: 'strict' | 'permissive-legacy'`, defaulting to `strict` in production paths.
- In strict mode, missing capability registry produces `HostError('capability-unavailable')` and does not render the app.
- In permissive legacy mode, the host creates an ungated adapter but marks the launch result as permissive for diagnostics.
- Capability consent result is tied to the active session and attempt ID.
- Managed table IDs passed into `createCapabilityGatedApi()` come from the same runtime kernel and session.

This should eventually move under platform launch authority, but the React host must stop failing open implicitly in the meantime.

### 9. Make app loader failures retryable

Update `useAppComponent()` and `AppLoader` around loader versions and retry semantics:

- Store lazy components by `{appId, loaderVersion, retryNonce}`.
- Record dynamic import failures as `loader-failed` with app/session metadata.
- Expose `invalidateAppComponent(appId, loaderVersion?)` or make retry increment a controller-owned retry nonce.
- On lazy-load retry, remount the loader subtree with the new cache key and do not reuse a failed `React.lazy` object.
- Keep successful lazy component references stable to avoid repeated Suspense loops.

This makes the retry button meaningful for dynamic import failures rather than only clearing the boundary state around a permanently rejected lazy component.

### 10. Strengthen error boundary and fallback UX

Extend `ErrorBoundary` into an app-aware boundary without turning it into the launch controller:

- Props: `appId`, `sessionId`, `phase`, `onError`, `onReset`, and `fallback`.
- `componentDidCatch` should report `error`, `componentStack`, app/session IDs, and phase to shell observability or a host callback.
- `reset` should increment a boundary nonce and call `onReset` so the controller can decide whether the domain requires a render reset, loader retry, or launch retry.
- `AppCrashedState` should use shell UI primitives/design tokens, `role="alert"` for failures, and `role="status"` for loading when appropriate.
- Production UI should show sanitized user-facing messages. Dev mode can show raw error message and stack.
- Permission denied, setup validation failed, document create failed, loader failed, and render crashed should not all be presented as "App crashed".

Keep the boundary around the app render subtree, but also make setup/loading/permission fallback components robust because they are currently outside the boundary.

### 11. Make setup UI idempotent and stateful

Update setup and binding UI contracts:

- `AppSetupDialog` action handlers return `Promise<void>` or a typed result.
- Dialog buttons show pending state and reject duplicate submissions while an action is in flight.
- Cancel dispatches a controller cancellation event for the active session and disposes in-flight fresh documents when applicable.
- `AppBindingEditor` validates each step through the shared binding validator, not only local required-column presence.
- `TablePicker` and `ColumnMapper` handle empty tables, stale selected IDs, duplicate mappings, incompatible types, and required/optional state with typed diagnostics.
- Existing-data table loading has generation guards and loading/error UI rather than silently leaving an empty picker if `kernel.tables.list()` rejects.

### 12. Keep lifecycle hooks composable

Preserve the extracted `app-document-lifecycle.ts` structure:

- Registration stays idempotent for DOM listeners.
- Active document providers stay multi-source through `lifecycle-state.ts`.
- `useAppDocument` returns an unregister/dispose path for any provider it adds if the implementation moves away from one module-level cache.
- Document disposal on stale session, unmount, and shell dispose does not remove other providers' documents.

If app documents become owned by platform app instances, the active-doc provider should move with that ownership while preserving the same unload flush contract.

### 13. Integrate with platform app lifecycle

Once plan 066 provides a platform runtime, make host rendering consume it:

- `ShellHost` receives or reads a `ShellPlatformRuntime` from bootstrap/context.
- App switchers and `AppSlot` read enabled app snapshots from the runtime registry.
- `AppSlot` requests launch/suspend/close through platform app instance APIs and renders the returned React runtime descriptor.
- `AppSlot` owns only React presentation state: loading fallback, setup dialogs when the platform asks for user input, and error fallback.
- Platform owns trust, package enablement, resource leases, runtime host support, and app instance terminal states.

Until this lands, the host controller should be shaped so it can be replaced by platform authority without changing `ShellHost` props again.

## Tests and verification gates

No cargo, pnpm, npm, yarn, build, test, typecheck, or formatter command should be run by this planning worker. For the implementation workstream, use these gates before claiming done.

Focused shell host tests:

- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/host`
- Add React Testing Library tests for `AppSlot` state transitions using real React rendering and user-event clicks for setup dialogs.
- Add tests proving stale async completions are ignored after app switch, retry, cancel, and unmount.
- Add tests for fresh mode and existing mode that assert setup kernel, gated API kernel, bindings, and managed table IDs all come from the same runtime target.
- Add tests for setup deadlock prevention: a managed-table app with no existing instance reaches setup choice instead of staying in loading forever.
- Add tests for duplicate setup submission suppression and cancellation cleanup.
- Add tests for `useAppManifests`/`useAppComponent` registry version updates and lazy-load retry cache invalidation.
- Add tests for `ErrorBoundary` reporting, fallback rendering, render reset, and app switch crash-state reset.

Binding and setup helper tests:

- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/host/app-setup src/host/hooks`
- Cover missing logical tables, missing required columns, duplicate mappings, stale table/column IDs, type incompatibility, optional columns, relation-like columns, and partial table creation failures.

Platform and service integration gates:

- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm test -- src/platform src/services src/host`
- Run platform conformance tests once host reads from the platform registry/app instance runtime.
- Run lifecycle hook tests to preserve unload flushing after app document ownership changes.

Type and boundary gates:

- `cd /Users/guangyuyang/Code/mog-all/mog/shell && pnpm typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm typecheck`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm check:host-surface-disposition`
- `cd /Users/guangyuyang/Code/mog-all/mog && pnpm check:ci:public-boundaries`

Production UI verification:

- Start the relevant dev server for the spreadsheet app.
- Exercise app selection, app switch during loading, managed-table setup fresh mode, existing-data binding, permission denial/retry, loader failure/retry, render crash/retry, and close/reopen in a browser.
- Drive E2E setup through real user input paths: click app switcher items, click setup dialog buttons, use dropdowns/selects, and trigger retry buttons. Do not mutate internal state or call setup APIs directly from tests to reach the condition.

## Risks, edge cases, and non-goals

- Risk: platform app lifecycle and current React host lifecycle overlap. The correct outcome is one authority; the host controller should be a transition shape only if the platform runtime is not ready.
- Risk: fixing the fresh/existing kernel contract may expose missing kernel APIs, especially sheet creation and durable app instance persistence. Treat those as real dependencies, not reasons to keep mixed-kernel behavior.
- Risk: current app instance records are in-memory. Existing-instance detection and cross-session setup will remain unreliable until app instance bindings are persisted in workbook/document state.
- Risk: lazy dynamic import failures are sticky under the current cache. Retrying the boundary without invalidating the lazy object can create a false sense of recovery coverage.
- Risk: failing closed on missing capability context may affect embeddings that currently rely on implicit ungated mode. The migration should require those embeddings to opt into permissive legacy mode explicitly.
- Risk: moving registry reads from module globals to a runtime service can surface HMR and side-effect registration ordering bugs. Versioned registry snapshots and explicit loading diagnostics should make these failures visible.
- Edge case: user switches apps while a consent dialog is open. The consent result must be ignored for the old session and must not grant or render the new app accidentally.
- Edge case: user cancels setup while a fresh document is being created. The created handle must be disposed or retained only if the ownership contract explicitly says cancelled draft documents are recoverable.
- Edge case: app switch after a render crash must clear crash state for the new app, while returning to the crashed app should follow the chosen product policy: preserve crashed session or retry fresh.
- Edge case: setup validation failure after partial fresh table creation needs typed diagnostics and either rollback or clear recovery instructions.
- Edge case: stale table lists in existing-data mode must be invalidated after workbook table changes.
- Edge case: custom `loadingFallback` can throw. The outer spreadsheet attachment boundary still catches top-level failures, but host-level fallbacks should be simple and robust.
- Non-goal: implementing iframe, worker, remote, or server-side app hosts in this workstream. The host should be ready to render platform-provided descriptors, but runtime-host bridges belong to `shell/src/platform`.
- Non-goal: broadening `@mog/shell/host` as a public app/plugin import path. Host internals should stay private unless a separate public API design requires otherwise.
- Non-goal: optimizing test-only paths. Performance or lifecycle work must target the production `ShellHost`/`AppSlot` path used by the app.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable, but the integration point must be one app-session contract.

- Agent A: host lifecycle contract and `AppSlot` controller, including session IDs, attempt IDs, cancellation guards, retry domains, and state reducer tests.
- Agent B: setup kernel ownership and managed-table setup, including fresh vs existing mode split, app document ownership, table creation diagnostics, and durable app-instance dependency mapping.
- Agent C: manifest-aware binding validator and setup UI integration across `AppBindingEditor`, `TablePicker`, `ColumnMapper`, and `app-setup.ts`.
- Agent D: registry adapter and lazy-loader cache versioning across `app-registry.ts`, `useAppManifests`, `useAppComponent`, app switchers, and HMR behavior.
- Agent E: error boundary, fallback UI, observability hooks, sanitized diagnostics, loader retry, and crash/reset tests.
- Agent F: platform integration work once plan 066 lands, replacing host launch authority with platform app instance launch/render descriptors.
- Agent G: production UI/E2E coverage through real app-switcher and setup-dialog input paths.

Dependencies:

- `shell/src/platform` should own package registry, enabled app snapshots, trust/isolation, runtime host support, app instance lifecycle, and resource leases. `shell/src/host` should consume that runtime rather than duplicate it.
- `shell/src/services` and document lifecycle state should continue to own shell document/project services, active-doc providers, unload flushing, and persistence diagnostics.
- `kernel` or contracts must provide durable app instance/binding persistence before existing-instance setup can be reliable across sessions.
- `types/api` or the app kernel contract must expose sheet creation if dedicated fresh-start sheets remain a product requirement.
- `runtime/spreadsheet-app` depends on `ShellHost` as the production render path; host prop compatibility and browser verification must include that attachment path.
- `apps/spreadsheet/register.ts` currently feeds the host registry via side effects. During migration it should feed the platform/host registry adapter without introducing a dependency from `shell/src/platform` back into app-specific code.
