# Plan 068 — Harden the sheet-view substrate and capability surface (`mog/views/sheet-view/src`)

## Source folder and scope

- **Folder:** `mog/views/sheet-view/src` (package `@mog-sdk/sheet-view`, version `0.8.0`).
- **In scope (production path):**
  - `index.ts` — public barrel (factories + type/interface re-exports).
  - `sheet-view.ts` — the `SheetView` class (1789 lines), the imperative substrate.
  - `capability-interfaces.ts` — the `ISheetView*` capability contracts + `SheetViewHandle`.
  - `public-types.ts` — the owned public type surface (~123 exported types).
  - `viewport-chrome.ts`, `viewport-wiring.ts` — built-in chrome + viewport event plumbing.
  - `capabilities/*.ts` — 14 capability implementations + `type-mappers.ts` + barrel.
- **Out of scope:** `@mog/canvas-engine`, `@mog/grid-renderer`, `@mog/grid-canvas`, `@mog-sdk/contracts` (consumed only via their published contracts), and the consuming apps (`mog/apps/spreadsheet`, `mog/artifacts/public-packages/mog-sdk__embed`). Changes there are coordination notes, not edits owned by this plan.
- **Build/packaging files** (`package.json`, `tsup.config.ts`, `api-extractor.json`, `tsconfig*`) are touched only where the plan explicitly calls for enabling the API report; the bulk of work is in `src/`.

## Current role of this folder in Mog

`@mog-sdk/sheet-view` is the **non-React, imperative rendering substrate** for every Mog sheet surface. It owns the canvas + grid layer stack, accepts a `Workbook` via `attach()`, drives viewport-based rendering, and exposes interaction primitives (hit-test, coordinate conversion, scroll observation, overlays, decorations, custom canvas layers).

It is consumed in two distinct modes, both of which the package explicitly promises to support:

- **Simple consumer** — `mog/artifacts/public-packages/mog-sdk__embed` calls `createSheetView()`, lets the substrate wire its own wheel/click handling (`scrollable: true`), and subscribes to a few events.
- **Advanced consumer** — `mog/apps/spreadsheet` disables internal scroll wiring, layers its own input/scroll policy on top, pushes interactive state via `renderState`/`updateContext`, and reads geometry/hit-test/objects/interactive-element capabilities. It additionally reaches into the `@internal` `engine`, `coordinateSystem`, and `gridRenderer` fields (e.g. `sheetView.gridRenderer` facade for `invalidateAll()` / current-sheet-id, `coordinateSystem` for snap-to-cell physics, `engine` for hit-test provider registration).

The package's defining discipline (stated in the `public-types.ts` header) is **type ownership**: no `@mog/*` or `@mog-sdk/contracts` type may leak through the public surface; internal renderer types are mapped to/from owned public types at the capability boundary (`capabilities/type-mappers.ts`). This is the substrate's core invariant and the reason the package can be a stable SDK boundary.

The architecture is sound — a clean capability-facade pattern with per-capability `*Internals` dependency-injection seams. This plan is **hardening and finishing**, not redesign: it closes correctness gaps, removes dead public surface, makes the substrate's implicit invariants explicit and enforced, and de-risks the monolithic lifecycle code.

## Improvement objectives

1. **Eliminate dead/unfulfilled public surface.** The skin validation contract is declared but never produced (see below). Either wire it or remove it — a published type that can never occur is a liability.
2. **Make implicit substrate invariants explicit and enforced**, especially "do not cache `positionIndex`/`mergeIndex` across `switchSheet()`" and "restore scroll position yourself after `switchSheet()`".
3. **Unify error/lifecycle semantics** across public methods (currently a mix of throw / return-null / silent no-op with no documented rule).
4. **De-risk lifecycle code**: the 282-line constructor with no rollback on partial failure, and the `dispose()` ordering hazard (renderer disposed *after* capability impls that may still reference it).
5. **Lock the public API surface** with an API report so the stability commitment this package implicitly makes (v0.8.0, two external consumers) is mechanically checked.
6. **Resolve the `@internal`-but-public tension** for `engine`/`coordinateSystem`/`gridRenderer`/`positionIndex`/`mergeIndex`: provide capability-based replacements for the operations the spreadsheet app actually uses, so these can move toward a documented, intentional escape hatch instead of an undocumented one.

## Production-path contracts and invariants to preserve or strengthen

These are load-bearing and **must not regress**:

- **Type-ownership invariant.** No `@mog/*` / `@mog-sdk/contracts` type may appear in any export from `index.ts`. `type-mappers.ts` remains the only translation boundary. Strengthen by making the API report fail CI if a foreign type appears in the rollup.
- **Factory signatures.** `createSheetView(config, callbacks?)`, `createSheetViewDataSourceFromWorkbook(workbook)`, `createResolvedSheetViewSkinForScheme(scheme)` keep their signatures and return types.
- **`SheetViewHandle` shape.** All capability properties (`geometry`, `hitTest`, `render`, `objects`, `interactiveElements`, `viewport`, `renderState`, `dataSources`, `locale`, `events`, `focus`, `commands`, `skin`, `overlays`, `decorations`, `layers`) and their method signatures remain. New methods may be *added*; none removed or narrowed.
- **Hit-result / event / command discriminated unions** stay open for extension — consumers `switch` with a `default` branch, so adding variants is safe; renaming or removing discriminants is not.
- **`@internal` escape-hatch fields** (`engine`, `coordinateSystem`, `gridRenderer`, `positionIndex`, `mergeIndex`) must keep working until capability-based replacements are shipped *and* the spreadsheet app has migrated. No removal in this plan — only additive replacements + clearer contract.
- **Per-sheet vs stable lifetime contract.** `engine` and `coordinateSystem` are stable across `switchSheet()`; `positionIndex`/`mergeIndex` are per-sheet and accessed via getters that must not be cached. Strengthen: enforce, don't just document.
- **`attach()` ordering contract.** The fetch-committed event must route through `ViewportWiring` after `connect()`; double-`attach()` throws; `switchSheet()` before `attach()` throws. Preserve exactly.
- **Event-subscriber isolation.** Listener exceptions are swallowed so one bad subscriber can't break the render/event loop (`events.ts`, `skin.ts` `_emit`). Preserve.

## Concrete implementation plan

### Phase 1 — Remove dead public surface: skin validation (correctness, low risk)

**Evidence.** `SheetViewSkinCapability.getResolved()` (`capabilities/skin.ts:425-431`) hardcodes `validationErrors: []`; `_status` only ever becomes `'idle'` or `'ready'` (`skin.ts:407,414`), never `'error'`. The `SheetViewSkinValidationError` type (`public-types.ts:766`), the `validationErrors` array on the resolved type (`public-types.ts:800`), and the `{ type: 'error'; error: SheetViewSkinValidationError }` event variant (`public-types.ts:808`) are all reachable from `index.ts:97` but **can never be produced**. A consumer writing `if (event.type === 'error')` has dead code that looks live.

Choose **one** direction (decision is a real fork; see Risks). The plan's recommended direction is **(A) implement** because skin color/number inputs are externally supplied and silent fallback hides consumer mistakes:

- **(A) Implement validation (recommended).** Add a `validateSheetViewSkin(skin): SheetViewSkinValidationError[]` pure function in `skin.ts` that checks the cases the resolver currently swallows: malformed color strings (the resolver in `skin.ts` only checks theme-token membership against `CHROME_TOKEN_KEYS`, then falls back), out-of-range opacities/widths, and unknown `kind` discriminants. `set()` runs it, stores the result, sets `_status = 'error'` when non-empty (still resolving with fallbacks so rendering never breaks), populates `getResolved().validationErrors`, and emits the `'error'` event. This turns three dead types into a working diagnostic channel without changing the happy path.
- **(B) Remove.** If product direction is "skins are trusted, never validated," delete the three types from `public-types.ts`, the `index.ts:97` export, the `'error'` event variant, and the `validationErrors` field; simplify `getResolved()` to drop the field. This is a breaking type change requiring a minor/major bump and a note to the two consumers.

Either way the end state has **no declared-but-impossible public surface**.

### Phase 2 — Make implicit invariants explicit and enforced (correctness/robustness)

- **`positionIndex`/`mergeIndex` no-cache contract.** Today this is comment-only (`sheet-view.ts:~901-914`). The getters already exist; on `switchSheet()` the underlying index identity may change. Add a dev-mode guard: stamp each returned index with the current sheet id (a `Symbol`-keyed brand or `WeakMap` from index → owning sheet id) and, in the getter, when `process.env.NODE_ENV !== 'production'`, warn if a previously-handed-out index is read after a sheet switch invalidated it. This converts a silent correctness trap into a loud one without changing release behavior.
- **`switchSheet()` scroll-restore contract.** `switchSheet()` resets `_scrollPositions` to origin and relies on the consumer calling `setScrollPosition()` immediately after. Make this explicit: document the contract on the `commands.switchSheet` / `ISheetViewCommands` interface JSDoc, and consider returning (or emitting via `events`) a `scroll-position-reset`-style signal so advanced consumers have a defined hook rather than relying on call-ordering folklore. (The existing `onScrollPositionReset` callback deliberately does *not* fire for `switchSheet()` to avoid feedback loops — preserve that; this is a separate, explicit affordance.)
- **No-op `switchSheet()` to the same sheet** currently returns silently with no signal. Document it; if any consumer relies on a side effect, surface it intentionally.

### Phase 3 — Unify error and lifecycle semantics (consistency)

Establish and apply one documented rule set across `sheet-view.ts`:

- **Programmer errors throw** (already: `attach` double-call, `switchSheet` before attach, post-dispose via `_ensureNotDisposed`). Audit every public method and ensure each either calls `_ensureNotDisposed()` or has a *documented* reason to be a silent post-dispose no-op (`updateContext`, `resize`, `_emit`, `_executeViewportRefresh` currently return silently — pick one policy and apply it). Recommendation: lifecycle/imperative-command methods throw post-dispose; idempotent observer/refresh internals no-op. Document the split in the class docstring.
- **"Not visible / not ready" returns `null`** (geometry/objects/hit-test) — keep, but disambiguate the two overloaded meanings the analysis flagged: e.g. `getCellPageRect()` returns `null` both for "renderer not ready" and "cell off-screen." Where a consumer would retry differently, split the signal (a `ready` flag or a dedicated `isReady()` capability probe). Do **not** change `null`-for-off-screen — that is the established, correct contract.
- **Swallowed `try/catch`** in `_getActiveViewportReader()` (`sheet-view.ts:~1528`) hides workbook errors. Narrow it to the expected "sheet not found" case; let unexpected errors propagate or route to a diagnostics channel rather than becoming a blanket `null`.

### Phase 4 — De-risk lifecycle code (robustness)

- **Constructor partial-failure safety.** The 282-line constructor (`sheet-view.ts:398-679`) instantiates 14 capability impls with no rollback; if impl N throws, impls 1..N-1 (and the engine/renderer/observers) leak. Extract capability construction into a private `_buildCapabilities()` step wrapped so that a throw triggers cleanup of everything already created (reuse the `dispose()` teardown path, guarded to run on partially-initialized state). This does not change the public surface; it makes construction transactional.
- **`dispose()` ordering hazard.** `dispose()` (`sheet-view.ts:836-892`) disposes capability impls (`overlays`, `canvasLayers`, `decorations`, `skin`) and *then* the renderer (`_renderer.dispose()` at ~883). Any impl that touches the renderer during its own disposal, or schedules async work, runs against a live-then-dead renderer. Audit the four disposable impls for renderer access during teardown; reorder so the renderer outlives anything that references it, or have impls null their renderer reference first. Add an explicit "disposed" barrier so late async callbacks are dropped, not executed against a torn-down engine.
- **Optional decomposition** (only if it lands cleanly without behavior change): split `sheet-view.ts` lifecycle (`attach`/`switchSheet`/`dispose`/`suspend`/`resume`) and the layout pipeline (`_recomputeLayout` ~100 lines, signature helpers, `_installInternalScrollAndClick` ~94 lines) into focused private modules. This is a readability/maintainability win, not a contract change; keep it behind the same public class. Treat as lowest priority — do not let it block Phases 1–3.

### Phase 5 — Lock the public API surface (stability infrastructure)

`api-extractor.json` currently has `dtsRollup` on but `apiReport` **off** — there is no checked `.api.md`, so any of the ~70 exported symbols can drift silently despite two external consumers on v0.8.0. Enable `apiReport`, commit the generated `<package>.api.md`, and treat a diff as a deliberate, reviewed event. Add the type-ownership check (Phase-1 invariant) as part of the same gate: the rollup must contain no `@mog/*` / `@mog-sdk/contracts` type names. *(This edits `api-extractor.json` and adds a report file — the only packaging touch this plan authorizes, and it is the mechanism that protects every other phase.)*

### Phase 6 — Intentionalize the `@internal` escape hatches (layering)

For each currently-`@internal` field the spreadsheet app reads, add a first-class capability method that covers the *specific* use, then re-document the field as a deliberate low-level escape hatch (not a "should not exist" leak):

- `gridRenderer.invalidateAll()` / `getCurrentSheetId()` → already largely covered by `render` capability (`ISheetViewRender`); confirm coverage and point the app at it.
- `coordinateSystem` snap-to-cell math → expose the specific conversions the app needs through `geometry` (several already exist: `toViewportPoint`, `fromViewportPoint`); enumerate the gaps and add owned-type methods.
- `engine` hit-test-provider registration → if the app registers providers, define an owned capability for it; otherwise document `engine` as the sanctioned extension point with a stability caveat.

No field is removed in this plan; the goal is that by the end, every `@internal` field is either replaced-and-deprecated-with-migration-note or explicitly blessed as an escape hatch — never an ambiguous "internal but you must use it."

## Tests and verification gates

> Per constraints, this plan does not run build/test/typecheck commands. The following are the gates the implementing change must pass; the `__tests__/` suite already covers most capability behaviors and is the right home for new cases.

- **Skin validation (Phase 1).** New unit tests in `__tests__/skin.test.ts`: invalid color → `getResolved().validationErrors` non-empty, `status === 'error'`, `'error'` event emitted, **and** rendering still falls back (no throw). If direction (B) chosen instead, a type-level test/compile check that the removed symbols are gone.
- **Invariant guards (Phase 2).** Tests in `sheet-view-data-sources.test.ts` (or a new lifecycle test) asserting: index handed out before `switchSheet()` triggers the dev-mode warning when read after; `switchSheet()` resets scroll and the documented restore signal fires.
- **Error semantics (Phase 3).** Tests asserting each public method's post-dispose behavior matches the documented policy (throw vs no-op), and that `_getActiveViewportReader()` propagates unexpected errors but returns `null` for genuine "sheet not found."
- **Lifecycle robustness (Phase 4).** A test where a capability constructor throws and asserts no engine/observer/DOM leak (transactional construction); a test that disposes with active overlays/decorations/layers and asserts no renderer access after `_renderer.dispose()` (spy on the renderer).
- **API report (Phase 5).** `api-extractor --local` produces no diff against the committed `.api.md`; CI fails on drift. A negative check that the rollup contains no `@mog/*`/`@mog-sdk/contracts` identifiers.
- **Regression gates (whole package).** Existing `jest` suite (`canvas-layers`, `commands`, `decorations`, `events`, `objects`, `overlays`, `skin`, `viewport-chrome`, `viewport-wiring`, `sheet-view-data-sources`) must stay green. Type rollup (`tsup` + `tsc`) builds clean.
- **Downstream gates.** `mog/apps/spreadsheet` and `mog/artifacts/public-packages/mog-sdk__embed` typecheck and their app-eval / api-eval suites pass — these are the real consumers and the ultimate check that no contract regressed.

## Risks, edge cases, and non-goals

**Risks / edge cases**

- **Skin direction is a genuine product fork.** (A) implement adds runtime cost and a new error channel consumers may not handle; (B) remove is a breaking type change. Pick before implementing; do not ship a half-state. Validation must never break rendering — always resolve with fallbacks even when reporting errors.
- **`dispose()` reordering** could change observable teardown timing for consumers that race dispose with async work. Land it with the spreadsheet app's renderer-teardown paths in view.
- **Dev-mode index guard** must be zero-cost in production (`NODE_ENV` gated) and must not change index identity semantics.
- **API-report enablement** will surface that the surface is large; the first committed `.api.md` is a baseline, not a cleanup mandate.
- **`@internal` replacements** require the spreadsheet app to migrate; until it does, fields stay. Coordinate so a deprecation note doesn't ship before the replacement is usable.

**Non-goals**

- No redesign of the capability-facade or `*Internals` pattern — it is good and stays.
- No removal of `engine`/`coordinateSystem`/`gridRenderer`/`positionIndex`/`mergeIndex` in this plan.
- No React layer, no new rendering features, no skin-DSL expansion.
- No test-only or shim fixes: every phase changes the production path (or, for Phase 5, the production packaging gate). No compatibility shims or temporary workarounds.
- No reduced-scope "just document it" outcomes where enforcement is feasible (Phase 2 enforces, not just documents).

## Parallelization notes and dependencies on other folders

- **Phases are largely independent and parallelizable:**
  - Phase 1 (skin) — isolated to `skin.ts` + `public-types.ts` + `index.ts`. Independent.
  - Phase 2 (invariants) — `sheet-view.ts` getters + `capability-interfaces.ts` JSDoc + `events`. Independent.
  - Phase 3 (error semantics) — `sheet-view.ts` + capability impls. Touches the same file as Phase 4, so sequence or coordinate edits to `sheet-view.ts`.
  - Phase 4 (lifecycle) — `sheet-view.ts` constructor/dispose. Coordinate with Phase 3 (same file).
  - Phase 5 (API report) — packaging only; do this **first** so all later phases are diffed against a baseline.
  - Phase 6 (escape hatches) — depends on Phase 5 (report shows the surface) and on consumer-app coordination; lands last.
- **Cross-folder dependencies:**
  - **`@mog-sdk/contracts`** (`mog/contracts`, `mog/types/rendering`, `mog/types/api`) — `SheetView` depends on `Workbook`, `WorkbookViewport`, `ViewportReader`, `CoordinateSystem`, `GridRenderer`, `ViewportLayout` contracts. No edits expected here; if Phase 6 needs a new owned conversion, it stays inside sheet-view's mappers (do not push view types into contracts).
  - **`@mog/grid-canvas` / `@mog/grid-renderer` / `@mog/canvas-engine`** — consumed via `createGridRenderer`, `computeViewportLayout`, the two viewport indices, and `CanvasEngineInstance`. No edits planned; Phase 4's dispose-ordering audit must understand `_renderer.dispose()` semantics (read-only).
  - **`mog/apps/spreadsheet`** and **`mog/artifacts/public-packages/mog-sdk__embed`** — the two consumers. Phases 1(B) and 6 require coordinated migrations; Phases 1(A), 2, 3, 4, 5 are internal and should be consumer-transparent (verified via their typecheck + eval suites).
- **Recommended ordering:** Phase 5 (baseline) → Phases 1, 2 in parallel → Phases 3+4 (serialized on `sheet-view.ts`) → Phase 6 (with consumer coordination).

---

*Evidence base: read-only inspection of all 21 source files in `mog/views/sheet-view/src`, the package's `package.json` / `api-extractor.json`, and import-site analysis across `mog/apps/spreadsheet`, `mog/artifacts/public-packages/mog-sdk__embed`, and `mog-website`. Key confirmations: `validationErrors` hardcoded `[]` at `capabilities/skin.ts:429` with no `'error'`-status path; `@internal` `engine`/`coordinateSystem`/`gridRenderer` fields actively read by the spreadsheet app; 282-line constructor with no rollback; `dispose()` disposes capability impls before `_renderer.dispose()`; `apiReport` disabled in `api-extractor.json`.*
