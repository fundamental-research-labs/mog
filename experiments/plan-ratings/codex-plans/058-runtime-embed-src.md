# 058 - Runtime Embed Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/runtime/embed/src`

Queue item: 58

Scope: the public `@mog-sdk/embed` source tree that owns the same-page browser embed package, including root registration, React, web component, config, bundled client, SheetView renderer orchestration, same-page host adapters, reserved iframe protocol plumbing, reserved publish helpers, and the workspace-private `./internal/views-host` friend surface.

Files and integration points inspected:

- `runtime/embed/src/index.ts`
- `runtime/embed/src/config.ts`
- `runtime/embed/src/types.ts`
- `runtime/embed/src/react/index.tsx`
- `runtime/embed/src/mog-sheet-element.ts`
- `runtime/embed/src/web-component/index.ts`
- `runtime/embed/src/client/index.ts`
- `runtime/embed/src/renderer/index.ts`
- `runtime/embed/src/renderer/formula-bar.ts`
- `runtime/embed/src/renderer/sheet-tabs.ts`
- `runtime/embed/src/host-adapters/same-page-host.ts`
- `runtime/embed/src/host-adapters/effective-state-gates.ts`
- `runtime/embed/src/host-adapters/react-same-page-host.ts`
- `runtime/embed/src/host-adapters/web-component-same-page-host.ts`
- `runtime/embed/src/host-adapters/iframe-child-host.ts`
- `runtime/embed/src/host-adapters/iframe-parent-client-placeholder.ts`
- `runtime/embed/src/iframe/*`
- `runtime/embed/src/publish/*`
- `runtime/embed/src/internal/views-host.ts`
- `runtime/embed/src/shared/*`
- `runtime/embed/src/__tests__/*`
- `runtime/embed/package.json`
- `runtime/embed/EXPOSURE.md`
- `runtime/embed/tsup.config.ts`
- `runtime/embed/api-extractor*.json`
- `runtime/embed/scripts/rollup-public-types.mjs`
- `tools/package-inventory.jsonc`
- `tools/api-snapshots/@mog-sdk__embed.api.txt`
- Public docs: `docs/guides/embed-react.md`, `docs/guides/embed-web-component.md`, `docs/guides/iframe-embed.md`, `docs/reference/README.md`, security/trust model docs

Scope this plan does not cover:

- Replacing `@mog-sdk/sheet-view`, the kernel workbook factory, or the browser WASM package.
- Moving full spreadsheet application chrome into `@mog-sdk/embed`; full app embedding remains owned by `@mog-sdk/spreadsheet-app`.
- Publishing `@mog-sdk/embed/iframe` or `@mog-sdk/embed/publish` before the production child/runtime distribution and security gates exist.
- Adding compatibility shims for raw `src`, raw URL, raw bytes, provider config, storage credentials, bearer tokens, or callback-name source resolution.
- Changing private `mog-internal` planning or eval files outside this plan.

## Current role of this folder in Mog

`runtime/embed/src` is the public browser embed facade for Mog's lower-level sheet/view embed. It ships as `@mog-sdk/embed` with public-experimental root, `./react`, `./web-component`, and `./config` entrypoints. The package gives host pages a way to render a workbook-backed sheet in the host origin while preserving a hard rule: public config contains only opaque source refs and requested policy; trusted host code resolves authorized workbook bytes and effective state through `MogEmbedHostPolicy`.

Observed responsibilities:

- `config.ts` defines the semantic embed config, effective state, host policy, lifecycle/event types, and config validator. It already rejects raw `source.url`, `source.path`, and several direct authority fields.
- `index.ts` registers `<mog-sheet>` as the root side effect and exports config types, validators, `MogSheetElement`, `EmbedRendererOptions`, event/status types, and `SDK_VERSION`.
- `react/index.tsx` implements `<MogSheet />`, its ref handle, React callbacks, renderer/client lifecycle, save/export gates, sheet switching, range navigation, dirty tracking, scroll/zoom callbacks, and effective-state callbacks.
- `mog-sheet-element.ts` implements the custom element surface with DOM attributes/properties, `ready`, status, effective state, save/export, sheet/range/resize/focus/dispose methods, shadow DOM loading/error UI, config/hostPolicy boot, and DOM events.
- `host-adapters/same-page-host.ts` is the common source/effective-state adapter for React and web component embeds. It validates config, calls host policy `resolveSource`, constructs `MogClient`, overlays dirty/save state onto host-resolved effective state, and centralizes save/export effective-state gates.
- `client/index.ts` is a bundle-private production client over `createWorkbook()` from `@mog-sdk/kernel`. It accepts only host-authorized bytes, exposes narrow workbook/worksheet handles internally, manages loading/ready/error/disposed status, and emits typed events.
- `renderer/index.ts` is a thin embed-specific orchestrator over `@mog-sdk/sheet-view`. It owns formula bar and sheet tabs, delegates grid/canvas/viewport/hit-test/rendering to SheetView, and emits embed events for sheet changes, cell selection, scroll, and zoom.
- `iframe/*` defines reserved source-internal postMessage protocol, parent client, and child host primitives with exact-origin and source validation. Public docs explicitly state there is no public iframe package export, emitted iframe bundle, child page, or customer-facing isolation guarantee.
- `publish/*` contains reserved read-only publish view types/helpers. It is not exported from `package.json` today, but several source comments still mark it public-experimental.
- `internal/views-host.ts` is a workspace-private friend export for dev/eval views-host integration. Package inventory says it should be stripped from public packed artifacts even though it exists in the workspace package export map.
- Tests cover config validation, effective-state gates, iframe protocol/client/host units, resolution logic, package-boundary source checks, publish type/mount behavior, event emitter, and column naming. Coverage is mostly unit/source-level; there is no production browser fixture that imports the built package and renders the React/custom-element paths through the public package entrypoints.

## Improvement objectives

1. Make the same-page embed lifecycle a single production controller used by React and the web component, instead of maintaining parallel boot, event, sheet, dirty, save/export, and teardown logic in two UI wrappers.

2. Strengthen the public host-policy contract so config validation, source materialization, effective-state validation, dirty/save transitions, and capability-denied behavior are deterministic and identical across root, React, and web component entrypoints.

3. Make public declarations and package artifacts first-class contracts for every public subpath: root, `./react`, `./web-component`, and `./config`. Declaration rollups should not expose private field names, bundled client details, renderer internals, kernel types, or workspace-only type packages.

4. Keep iframe and publish code explicitly reserved until each has a real production path. Reserved code may be hardened and tested, but it must not look public by naming, stability tags, exports, docs, emitted bundles, or API snapshots.

5. Add external-consumer and browser-level verification that proves the shipped package can be installed, imported, typed, and rendered from outside the pnpm workspace through real public entrypoints.

6. Preserve the architecture boundary: `@mog-sdk/embed` is a runtime facade over kernel/sheet-view implementation, not an app/shell chrome package and not a trust boundary for hostile same-page content.

7. Reduce platform and package-boundary drift by making ID generation, DOM globals, WASM asset copying, and workspace-private friend exports explicit in package gates instead of relying on comments and allowlist entries.

8. Keep current public-experimental ergonomics where they are intentional, but remove misleading deprecated/legacy paths and inconsistent event shapes before promotion to stable.

## Production-path contracts and invariants to preserve or strengthen

Public entrypoints and exports:

- `@mog-sdk/embed` root remains the side-effect registration path for `<mog-sheet>` and exports only public-experimental config/types/validators, `MogSheetElement`, renderer option types, event/status types, and `SDK_VERSION`.
- `@mog-sdk/embed/react` remains the React path for `MogSheet`, `MogSheetProps`, `MogSheetHandle`, typed callbacks, config types, and validators.
- `@mog-sdk/embed/web-component` remains the narrower custom-element path for `MogSheetElement`, config types, event types, and validators.
- `@mog-sdk/embed/config` remains config-only at runtime: validators are allowed runtime values; workbook/client/renderer/source materialization helpers are not.
- `./client`, `./iframe`, `./publish`, `./host-adapters/*`, and renderer internals must not become package exports without a deliberate exposure change and full public gates.
- `./internal/views-host` remains workspace-private friend surface only and must be stripped from public packed artifacts per package inventory.

Source and trust:

- Public config must carry opaque `MogEmbedSourceRef` values only. It must not accept raw workbook URLs, file paths, inline bytes, provider configs, storage credentials, bearer/refresh tokens, WebSocket endpoints, callback names, CRDT/Yrs state, or direct storage addresses.
- `MogEmbedHostPolicy.resolveSource(config)` is the only same-page source materialization hook. The resolved bytes are internal to the session and must not be surfaced through public handles.
- Caller-requested mode/capabilities/save/collaboration fields are requests only. Effective mode, granted/denied capabilities, save policy, collaboration mode, dirty flag, and save state come from the trusted host policy plus session-owned dirty/save overlays.
- Callback presence is never an authorization grant. Save requires effective `save` plus `host-callback` or `autosave`; live collaboration requires `autosave`. Export requires effective `export` plus non-`none` save policy.
- Same-page embeds run in the host origin and must not be documented or coded as an isolation boundary for hostile workbook content.

Lifecycle and event behavior:

- React and web component wrappers must produce the same lifecycle transitions: initializing/loading, ready, error, disposed.
- Ready must mean the workbook was created, the requested initial sheet was selected, the renderer was attached, initial sheet tabs were populated, and the initial effective state was emitted.
- Errors from config validation, source resolution, workbook creation, renderer attachment, effective-state resolution, save/export callbacks, and iframe protocol validation must be surfaced through the same error contract for the relevant wrapper.
- `MogEmbedEventMap` should correspond to real emitted events/callbacks. If it includes `lifecycleChange`, `effectiveStateChange`, `sheetChange`, `selectionChange`, `dirtyChange`, `saveStateChange`, `capabilityDenied`, and `error`, both public wrappers need equivalent callback/DOM-event coverage or the type contract should be adjusted.
- Sheet-change events should carry the same full detail across wrappers: index, name, and sheetId. The current web component-only `{ index }` shape should not remain the only DOM event detail.
- Disposal must unsubscribe all client/renderer/window listeners, cancel or generation-guard async boot work, dispose renderer and workbook resources once, and make later public method calls no-op or fail predictably.

Renderer and client:

- `MogClient` keeps accepting only `ArrayBuffer | Uint8Array` source bytes that have already passed through host policy.
- Public handles must not expose workbook, worksheet, provider, viewport region, renderer, kernel, or SheetView handles.
- `EmbedRenderOrchestrator` remains the only embed-owned chrome around `@mog-sdk/sheet-view`: formula bar, sheet tabs, renderer event projection, range navigation, and public-debug methods for the internal views-host friend surface.
- SheetView continues to own canvas, grid layers, viewport math, VPI/VMI, hit testing, scrolling, zoom, resize observer behavior, and render loop.
- Range navigation should parse public range strings consistently and should not silently implement only a subset if public docs advertise broader range handling.

Package boundaries:

- `runtime/embed` must not import spreadsheet app or shell chrome from embed core. Product composition belongs behind host adapters or in `@mog-sdk/spreadsheet-app`.
- Public package inventory forbids `@mog/*`, `@mog-sdk/spreadsheet-contracts`, and `@mog/types-*` leaks from `@mog-sdk/embed`.
- Bundled implementation dependencies such as `@mog-sdk/kernel`, `@mog-sdk/sheet-view`, and `@mog-sdk/types-host` must not leak into public declarations or packed manifest dependencies unless intentionally public and covered by package gates.
- Browser bundles must continue externalizing optional React peers and `@mog-sdk/wasm` while bundling workspace implementation code needed for the browser facade.

Reserved iframe and publish:

- Iframe source may stay as reserved protocol evaluation code, but it must remain out of package exports, emitted bundles, public API snapshots, and public integration docs.
- A future iframe promotion requires exact-origin validation, expected-source validation, nonce/instance correlation, structured payload schemas, effective-state command authorization in the trusted child, a shipped child runtime page/bundle, CSP/sandbox/referrer policy, and browser E2E coverage.
- Publish source may stay reserved, but stability annotations, exposure docs, package-boundary tests, and build entries must agree that it is not public today.

## Concrete implementation plan

1. Add a shared same-page embed session controller.
   - Introduce a bundle-private module such as `src/session/same-page-embed-session.ts`.
   - The controller should own config validation, host creation, client readiness, renderer creation/attachment, sheet tab population, event subscription, effective-state refresh, save/export gating, dirty/save overlays, sheet switching, range navigation, resize, focus, markClean, and disposal.
   - Define a narrow `SamePageEmbedSessionOptions` object: container, config, hostPolicy, initial sheet, renderer/chrome options, and optional lifecycle hooks.
   - Define a `SamePageEmbedSessionHandle` that mirrors the allowed public handle operations without exposing client, workbook, worksheet, renderer, or host policy internals.
   - Emit one typed event stream based on `MogEmbedEventMap` plus scroll/zoom renderer events. React callbacks and DOM custom events should be adapters over this stream.

2. Refactor React and web component wrappers into thin surface adapters.
   - In `react/index.tsx`, keep prop typing, callback refs, loading/error overlay rendering, and React ref wiring, but delegate all session behavior to the shared controller.
   - In `mog-sheet-element.ts`, keep custom element attributes/properties, shadow DOM shell, `ready`, and DOM event dispatch, but delegate boot/reboot, method behavior, state transitions, and teardown to the shared controller.
   - Normalize React `MogSheetHandle` and web component methods so `getStatus`, `setSheet`, `isDirty`, `markClean`, `requestSave`, `requestExport`, `getEffectiveState`, `navigateToRange`, `resize`, `focus`, and `dispose` have equivalent semantics.
   - Keep wrapper-specific UI separate: React returns JSX overlays; the web component manages scoped shadow DOM loading/error nodes.
   - Ensure callbacks can update without recreating the session, while config/hostPolicy/source changes intentionally recreate it with generation guards.

3. Formalize lifecycle and event contracts.
   - Add an internal `EmbedLifecycleController` or equivalent state machine for `initializing -> loading -> ready -> error -> disposed`.
   - Make `MogEmbedLifecycleState` actual emitted state, not only a type.
   - Add DOM events for every `MogEmbedEventMap` entry with a consistent `mog-*` naming scheme, while preserving documented existing events where they are already public-experimental.
   - Make React callbacks and DOM events receive the same detail payloads. In particular, web component `mog-sheet-change` should include `{ index, name, sheetId }`.
   - Define error normalization once: non-Error throws become `Error(String(value))`; security/config errors keep actionable messages but do not leak credentials or raw source values.

4. Strengthen config and effective-state validation systematically.
   - Keep `validateMogEmbedConfig` and `assertValidMogEmbedConfig`, but back them with a schema-style validator that enumerates all allowed top-level, source, chrome, theme, mode, save, and collaboration fields.
   - Reject the complete category of public authority leaks: raw `url`, `path`, `href`, `src`, `bytes`, `arrayBuffer`, `uint8Array`, `blob`, `filePath`, `providerConfig`, `storageCredentials`, bearer/refresh/access tokens, raw callback names, WebSocket endpoints, Yjs/CRDT state, and storage/document provider objects, wherever they appear in config.
   - Add `validateMogEmbedEffectiveState` and `assertValidMogEmbedEffectiveState` internally. Host policy output should be checked before the session uses it.
   - Copy/freeze effective state arrays at the session boundary so user mutation after resolution cannot mutate session authority.
   - Validate resolved source bytes and content type enough to reject empty/non-byte materialization early while leaving XLSX parsing correctness to `createWorkbook()`.

5. Make save/export and dirty state a first-class session submodule.
   - Move the effective-state gate helpers into a shared policy module with exhaustive tests for every save policy and collaboration mode.
   - Track `dirty` and `saveState` in the shared session, not separately in React refs and web component private fields.
   - Make `markClean()` update workbook dirtiness, session dirty state, effective state, and dirty/effective callbacks/events in one place.
   - Make `requestSave()` transition through `saving -> saved/error`, call host policy only after effective-state authorization, mark the workbook clean only after successful save, and emit save/effective/dirty changes in deterministic order.
   - Make `requestExport(format)` validate format policy and emit capability denied on blocked exports without mutating save state.

6. Normalize sheet, range, resize, and focus behavior.
   - Add a shared `setActiveSheet(indexOrName)` helper that updates the client active sheet, renderer current sheet, tab list, sheet-change event detail, and dirty/effective state.
   - Replace duplicated sheet-tab refresh logic in React and web component code with the shared helper.
   - Replace the current simple range regex with a public range parser that handles single cells, rectangular ranges, absolute refs, lowercase refs, optional whitespace, and sheet-qualified refs if the public config allows them. If sheet-qualified ranges are not supported, reject them explicitly instead of partially navigating.
   - Keep navigation read-only: selecting/ranging must not mutate workbook state or bypass renderer input paths.
   - Make resize behavior wrapper-aware: React numeric width/height and web component CSS/attribute sizing should feed the same renderer resize call without forcing unwanted inline height over host-authored CSS.

7. Harden public declarations and API snapshots for every public subpath.
   - Add API Extractor rollup entries for `web-component` and `config`, not only root and React.
   - Ensure `tools/api-snapshots/@mog-sdk__embed.api.txt` includes root, React, web-component, and config outputs from rolled-up declarations.
   - Stop leaking private field names from `MogSheetElement` declarations. Prefer ECMAScript private fields or an internal implementation split so the public declaration shows only the public DOM API plus an opaque private brand.
   - Ensure declarations do not expose `MogClient`, `EmbedRenderOrchestrator`, host adapter result types, kernel types, raw SheetView handles, workspace-private `@mog/types-*`, or friend-only views-host types through public entrypoints.
   - Keep React scroll/zoom event types either self-contained in the embed declaration rollup or deliberately imported from a public `@mog-sdk/sheet-view` type if that dependency is part of the public API decision.
   - Add declaration snapshot assertions for forbidden strings: `@mog/types-`, `@mog/`, `@mog-sdk/kernel`, `@mog-sdk/types-host`, `MogClient`, `EmbedRenderOrchestrator`, `DocumentContext`, `ComputeBridge`, `Workbook`, `Worksheet`, raw provider types, and private field names.

8. Make package artifact assembly match exposure classification.
   - Keep `package.json` exports limited to `.`, `./react`, `./web-component`, `./config`, and the workspace-private friend export in source.
   - Ensure public artifact assembly strips `./internal/views-host` from packed public manifests as package inventory requires.
   - Keep `client` as a bundle-private tsup entry only if a production public bundle needs it internally; otherwise remove emitted standalone `dist/client.*` artifacts so source-internal code is not packaged as a discoverable pseudo-entrypoint.
   - Continue not emitting iframe or publish bundles until promotion gates are satisfied.
   - Make WASM asset copying fail loudly for production builds if the package cannot run without `compute_core_wasm_bg.wasm`, while allowing an explicit dev-only mode to skip the copy when appropriate.

9. Fence and harden reserved iframe code without promoting it.
   - Update stability comments in `src/iframe/index.ts`, `src/publish/index.ts`, and related reserved files so they do not say public-experimental while package/export docs classify them reserved.
   - Add package-boundary tests that fail if `iframe`, `publish`, or `host-adapters` become public package exports or tsup public entries accidentally.
   - If iframe work continues in this folder, add nonce and instance correlation to the protocol envelope and validate it on both parent and child. The current `channelNonce` and parent `instanceId` should not remain unused placeholders in any code path that claims security.
   - Add structured payload validators per message type instead of only validating envelope type/version/id.
   - Enforce effective-state gates inside the trusted iframe child for save/export/navigation commands. Callback presence in the child is not enough.
   - Do not document iframe as usable until there is a real child runtime page/bundle, source materialization path, renderer integration, CSP/sandbox policy, and browser E2E test.

10. Decide the publish surface deliberately.
    - If publish remains reserved, align comments, exposure docs, package-boundary tests, build entries, and API snapshots around "reserved, source-internal".
    - If publish is promoted later, treat it as its own product surface with public entrypoint, declaration rollup, package export, docs, external fixture, artifact tests, and strict read-only security gates.
    - Do not leave public-experimental annotations on code that cannot be imported from the package.

11. Add real public-consumer fixtures and browser verification.
    - Add an external TypeScript fixture that installs/uses the packed `@mog-sdk/embed` candidate outside the workspace and imports:
      - `@mog-sdk/embed`
      - `@mog-sdk/embed/react`
      - `@mog-sdk/embed/web-component`
      - `@mog-sdk/embed/config`
    - Positive fixture checks should type `MogEmbedConfig`, `MogEmbedHostPolicy`, `MogSheetProps`, `MogSheetHandle`, `MogSheetElement`, validators, and event details.
    - Negative fixture checks should prove `@mog-sdk/embed/client`, `@mog-sdk/embed/iframe`, `@mog-sdk/embed/publish`, `@mog-sdk/embed/host-adapters/*`, and `@mog-sdk/embed/internal/views-host` are not externally importable from the public artifact.
    - Add a Vite/browser fixture that loads `runtime/embed/public/showcase.xlsx` or a generated sample workbook through a host policy and renders both React and custom-element paths through public package imports.
    - Exercise real DOM input paths where applicable: clicking sheet tabs, selecting cells, resizing the container, calling public methods from a host ref/element, and verifying emitted callbacks/events.
    - Verify raw `<mog-sheet src="...">` and raw config URL/path/bytes are rejected through the actual browser entrypoints.

12. Update docs after implementation, not before.
    - Keep React and web-component guides centered on opaque source refs and hostPolicy-owned source/effective-state resolution.
    - Document the exact event names and details exposed by `<mog-sheet>`.
    - Document which range syntax is supported by `navigateToRange()` and `config.range`.
    - Keep iframe docs saying "reserved" unless the promotion gates are fully satisfied.
    - Update `EXPOSURE.md` and API reference only after the implementation and package artifact gates prove the surface.

## Tests and verification gates

Unit and package-local gates:

- `pnpm --filter @mog-sdk/embed test`
- `pnpm --filter @mog-sdk/embed typecheck`
- `pnpm --filter @mog-sdk/embed build`

Add or expand these package tests:

- Shared same-page session controller lifecycle: successful ready, source resolution error, workbook creation error, effective-state error, config update reboot, disposal during async boot, duplicate disposal, listener cleanup.
- React adapter tests over the shared controller: callback parity, ref handle methods, no teardown on callback identity changes, intentional teardown on config/hostPolicy changes, loading/error overlay transitions.
- Web component tests over the shared controller: `config`/`hostPolicy` boot order, `ready` promise reset on reboot, raw `src` rejection, full DOM event payloads, attribute-to-config behavior, CSS sizing fallback, disconnected cleanup.
- Config validator table tests for the full category of forbidden public authority fields and allowed public fields.
- Effective-state validator and gate tests for all mode/save/collaboration/capability combinations.
- Package-boundary tests for public exports, reserved subpaths, friend export stripping, no internal symbol leaks, and no forbidden declaration strings.
- Iframe reserved tests for nonce/instance validation, message payload schemas, exact-origin/source rejection, effective-state command denial, request timeouts, and no public export/build entry.

Public artifact and external-consumer gates:

- `pnpm build:public-artifacts`
- `pnpm check:declaration-rollups`
- `pnpm check:api-snapshots`
- `pnpm check:external-fixtures -- --skip-build`
- `pnpm check:publish-readiness:fast`
- `pnpm check:private-leaks`
- `pnpm check:platform-dependencies`
- `pnpm validate:packages`

Browser/UI gates after the production fixture exists:

- Start the embed browser fixture/dev server and exercise React plus web component paths in a browser.
- Use Playwright or the repo-standard browser harness to verify:
  - public package imports load in a real browser,
  - workbook bytes are resolved only through hostPolicy,
  - a canvas/sheet view renders nonblank content,
  - sheet tabs change the active sheet through real clicks,
  - cell selection emits selection events through real pointer input,
  - resize updates the rendered viewport,
  - save/export grants and denials follow effective state,
  - raw `src` and raw authority config fail closed.

Final TypeScript gate for implementation work:

- `pnpm typecheck`

Because this plan covers a public TypeScript browser package, implementation should not claim done with only typecheck or source-level tests. The packed artifact and browser path must be exercised.

## Risks, edge cases, and non-goals

- Risk: extracting a shared session controller can accidentally change wrapper timing. Guard with lifecycle event ordering tests and browser fixture assertions for both React and custom element paths.
- Risk: current web component and React behavior are not fully identical. The refactor should choose one documented contract and update both wrappers, not preserve inconsistent event payloads as compatibility debt.
- Risk: declaration rollups can pass inside the monorepo while packed consumers still see private symbols or missing peer/runtime dependencies. Guard with packed external fixtures and API snapshots.
- Risk: `MogSheetElement` public declarations currently expose private implementation member names. Hiding those internals must not remove public DOM methods/properties or custom element registration behavior.
- Risk: iframe code contains security-looking fields such as `channelNonce` and `instanceId` that are not yet complete production enforcement. Do not promote or document iframe until nonce/source/origin/effective-state enforcement is real and browser-tested.
- Risk: removing or stripping `dist/client.*` could break an internal build artifact assumption. Audit tsup output and public artifact assembly before removing emitted bundle-private files.
- Risk: WASM assets are required for browser package execution. Build scripts should make missing required assets explicit so a packed package cannot look publish-ready while failing at runtime.
- Risk: stronger config validation may reject host-owned metadata currently tolerated by public-experimental users. Because this project has no external compatibility burden, prefer a correct authority-safe schema over preserving accidental accepted fields.
- Edge case: config and hostPolicy may be assigned in either order on a custom element; boot should happen exactly once when both are present.
- Edge case: a component may disconnect during async source resolution or workbook creation; the session must dispose the late-created host/client and avoid firing ready.
- Edge case: host policy may return mutable arrays or later mutate state; the session should snapshot effective state.
- Edge case: `requestSave()` may be called before ready, after disposal, while already saving, or after hostPolicy throws. Each path needs deterministic behavior.
- Edge case: range navigation should handle invalid range syntax explicitly and should not scroll to a misleading partial match.
- Non-goal: no direct source URL fetching helper, legacy `src` compatibility, callback-name resolver, or inline byte public prop.
- Non-goal: no full spreadsheet app toolbar/chrome in this package.
- Non-goal: no iframe public export or iframe isolation claim as part of the same-page embed cleanup.
- Non-goal: no test-only renderer/client path. Verification must cover the production package entrypoints and renderer/client path.

## Parallelization notes and dependencies on other folders, if any

This work can be split across independent agents once the shared session contract is agreed:

- Agent A: shared same-page session controller, lifecycle/event types, save/export/dirty state, and unit tests under `runtime/embed/src`.
- Agent B: React adapter refactor and React-focused tests.
- Agent C: web component adapter refactor, DOM events, sizing behavior, and custom-element tests.
- Agent D: declaration rollups, API snapshots, package artifact stripping, public/private external fixtures, and package-boundary tests.
- Agent E: reserved iframe hardening and classification cleanup, staying out of public exports.
- Agent F: browser fixture/dev-server path that renders React and web component embeds through public package imports.
- Agent G: docs updates after implementation gates pass.

Dependencies and boundaries:

- `runtime/embed/src/client` depends on the public kernel workbook creation path and browser WASM runtime; it must keep public workbook/source access narrow.
- `runtime/embed/src/renderer` depends on `@mog-sdk/sheet-view` for production rendering and should not reimplement canvas/grid/viewport behavior.
- `runtime/embed` must not depend on `apps/spreadsheet`, `shell`, `mog-internal`, `@mog/*`, legacy spreadsheet contracts, or private type shards in public declarations.
- `@mog-sdk/spreadsheet-app` owns full app embedding; if a requirement needs full toolbar/chrome/editing workflows, coordinate there rather than expanding `@mog-sdk/embed`.
- External fixture and package-readiness work depends on `tools/package-inventory.jsonc`, `tools/api-snapshots`, declaration rollup tooling, and public artifact assembly.
- Browser verification depends on the WASM npm artifact under `compute/wasm/npm` being available during package build.
