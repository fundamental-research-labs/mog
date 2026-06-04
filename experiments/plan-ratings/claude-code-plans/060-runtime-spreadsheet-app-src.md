# Plan 060 — Harden `mog/runtime/spreadsheet-app/src` (packaged spreadsheet app runtime)

## Source folder and scope

- **Folder:** `mog/runtime/spreadsheet-app/src`
- **Package:** `@mog-sdk/spreadsheet-app` (`mog/runtime/spreadsheet-app`, version `0.8.0`, public, `"type": "module"`, React 19 peer). Build pipeline: `tsup` (JS) + `build-types.mjs` (`.d.ts`) + `vite` (CSS) + `finalize-assets.mjs` + `check-boundary.mjs --require-dist`. Test gate runs `generate-workbook-facade-matrix.mjs --check` and `check-boundary.mjs`.
- **Files in scope (19 source files, ~8,050 LOC):**
  - `index.tsx` — public barrel: re-exports `createSpreadsheetRuntime`, `MogSpreadsheetApp`, `mountSpreadsheetApp`, and ~80 public types from `public-types`.
  - `runtime.ts` (1,422 LOC) — `SpreadsheetRuntimeController` + `RuntimeWorkbookSession`: open/dispose, epoch/session bookkeeping, dirty/save state machine, authorization, attachment controller, app-bridge registration.
  - `app-attachment.tsx` (957 LOC) — `MogSpreadsheetAppImpl` React component + `mountSpreadsheetApp` imperative mount; attach/detach lifecycle, theme resolution, slots, feature-gate merge, event wiring.
  - `workbook-facade-capability-matrix.ts` (3,572 LOC) — **generated** capability matrix (`WORKBOOK_FACADE_CAPABILITY_MATRIX`, `WORKBOOK_SUB_API_INTERFACES`, `SpreadsheetFacadeMatrixEntry`) mapping every Workbook/Worksheet API method → `{decision, capability, reason, returns}`.
  - `workbook-facade.ts` (347 LOC) — the security gate: a `Proxy` over the raw workbook that enforces the matrix and re-wraps returned sub-API objects.
  - `dirty-events.ts` (169 LOC) — hand-maintained `WORKBOOK_MUTATION_EVENT_TYPES` Set (~200 strings) + `isWorkbookMutationEvent` classifier that decides whether an event marks the workbook dirty.
  - `public-types.ts` (746 LOC) — the public contract surface (capabilities, policy, save/dirty/attachment state, errors, options).
  - `runtime-types.ts`, `shell-documents.ts`, `feature-gates.ts`, `decorations.ts`, `public-error.ts`, `deferred.ts`, `actor-session.ts`, `attachment-runtime.ts`, `bytes.ts`, `errors.tsx`, `styles.css` — supporting modules.
  - `__tests__/` — `dirty-events.test.ts`, `chart-export.test.ts`, `runtime-owned-workbook-session-lifecycle.test.ts` (node:test).
- **Charter (must be preserved):** this is the **trusted embed surface** for hosting the Mog spreadsheet inside another product. Its two jobs are (a) a stable public API (`index.tsx` exports), and (b) a **capability/authorization boundary** between an untrusted host/agent and the full workbook API. Both the method gate (facade) and the dirty/save state machine are correctness- and security-critical and are partly locked by `check-boundary.mjs` + node:test suites.

## Current role of this folder in Mog

`@mog-sdk/spreadsheet-app` is the packaged, embeddable runtime that wraps the internal `@mog/app-spreadsheet`, `@mog/shell`, and `@mog-sdk/contracts` machinery into a host-facing API. It serves three distinct consumers:

1. **Headless / programmatic** — `createSpreadsheetRuntime(...)` → `openWorkbook(...)` → a `SpreadsheetWorkbookSession` that can be driven entirely without UI (read cells, write cells, export XLSX, capture screenshots, request saves). This is the surface agents and automation use.
2. **Embedded UI** — `MogSpreadsheetApp` (React) / `mountSpreadsheetApp` (imperative) attach a full ribbon/grid UI to a session, with host-controlled chrome, theming, feature gates, command ownership, and edit-model policy.
3. **Authorization boundary** — every operation flows through (a) the host `authority` (`resolveActor`/`authorize`) and (b) the `workbook-facade` Proxy, which consults the capability matrix and the per-actor policy snapshot before forwarding to the real workbook. Unmapped methods **fail closed** (throw `AuthorizationDenied`).

The runtime tracks an **epoch** per `workbookId` (incremented on each open) to invalidate stale handles, a **session** keyed by `workbookSessionId`, and a **dirty/save state machine** (`clean → dirty → saving → saved|error|stale`) driven by classifying workbook event-bus events as mutations.

### Evidence-backed problems found

1. **The dirty/save classifier can silently drift → data loss (highest severity).** `dirty-events.ts` hand-maintains `WORKBOOK_MUTATION_EVENT_TYPES` as a literal `Set<string>` of ~200 event-type strings (`'cell:changed'`, `'table:updated'`, `'drawing:strokeAdded'`, …). The runtime calls `isWorkbookMutationEvent` on every event-bus event to decide whether to bump `changeSequence`/`dirtyEpoch` and emit `dirty`. There is **no drift guard**: `check-boundary.mjs` and `generate-workbook-facade-matrix.mjs` make no reference to mutation events (verified by grep — `mutation`/`dirty` appear in neither script), and `dirty-events.test.ts` only spot-checks ~6 positive and ~17 negative strings. Canonical event types live elsewhere (`mog/types/events/src/cell-events.ts` and siblings). **Consequence:** when the kernel adds a new mutating event type (a routine occurrence — the list already spans cells, tables, charts, pivots, drawings, diagrams, sparklines, slicers, scenarios, canvas objects, ranges), that event is *not* in the Set, the edit does *not* mark the workbook dirty, and the session looks **clean** — so `requestSave` is never triggered and the user's edit is **silently dropped on close/detach**. This is the single most important production risk in the folder and, unlike the facade matrix, it is unprotected.

2. **Capability-facade return-wrapping is heuristic and can fail *open*.** The method gate itself is sound and fail-closed: `createCapabilityFacade` (workbook-facade.ts:243-335) denies unmapped functions (`…is missing a workbook facade capability-matrix decision`, lines 301-315) and denies raw-internals (`context`, `eventBus`, `mirror`, `uiStore`, line 30). **But** whether a *returned* object (e.g. `workbook.sheets`, `worksheet.charts`, a `Range`) is itself re-proxied depends on two soft signals: the matrix entry's `returns: string[]` field, and the runtime structural sniff `looksLikeFacadeTarget` (lines 179-207), which guesses an interface if the object has **≥2 function properties** whose names appear in that interface's matrix. If `returns` is missing/wrong for a method, or the sniff fails to identify (or mis-identifies) the interface, `wrapFacadeReturn` (lines 209-241) falls through to `return value` (line 231, when `expected.length === 0`) and hands back a **raw, ungated** workbook object — exposing every method on it, including denied ones, to an untrusted actor. Because `returns` is derived by parsing signatures in the codegen heuristic, this is a real escape path on the very boundary the package exists to enforce, and it is not covered by a reachability test.

3. **`runtime.ts` has concurrency/lifecycle hazards that can leak handles or act on disposed records.**
   - **Concurrent-open record leak:** `openWorkbook` dedups *in-flight* opens via `openingWorkbooks`, but the "already open" guard reads `records.get(...)` *before* the record is stored. Two near-simultaneous opens for the same `workbookSessionId` can both pass the guard, both complete, and the second overwrites the first in `records` — the first record's `handle`/document is never disposed (orphaned document + event-bus subscription).
   - **Dispose-during-open race:** after the `await loadDocumentForSource(...)` boundary the controller re-checks `state !== 'ready'`, but a `dispose()` initiated between guard and store can leave a freshly-created record outside the disposal sweep.
   - **Detach re-entrancy:** `attachWorkbookSession`'s nested `detach()` guards on a closure `detached` flag, but is async and can be entered twice, double-invoking `unregisterBridge?.()`.
   - **Scattered listener management + ABA:** dirty/save/attachment/disposed listeners are four ad-hoc `Set`s with hand-rolled unsubscribe; `registerAppBridge` uses an identity check (`if (record.unsubscribeAppBridge === cleanup)`) to avoid clobbering — a classic ABA workaround indicating the lifecycle needs a real owner.
   - **Type lie:** records are created with `facade: null as unknown as SpreadsheetWorkbookFacade` (≈ line 1011) and patched immediately after; any read before the patch returns `null` typed as a facade.

4. **`app-attachment.tsx` fragments attachment state and races attach/detach.** The impl component (lines 309-871) carries **18 refs** plus 3 `useState`, tracks status in **three** places (`statusRef`, `state.status`, `environment.getStatus()`), and runs a single multi-phase effect (lines 663-732) that resets state, claims the workbook, `await`s `attach()`, then wires bridges. Detach (`detachCurrent`, 387-449) can run concurrently with a pending attach; the `cancelled` flag is checked only after the await. Module-level `WORKBOOK_VIEW_STATE`/`ACTIVE_WORKBOOK_ATTACHMENTS` `WeakMap`s keyed by session are **never cleared on detach**, so view state (and the single-attachment claim) can be stale across remounts of the same session. `restoreViewState` is fire-and-forget with no cancellation. The package already depends on `xstate`/`@xstate/react`, yet this lifecycle is hand-coded.

5. **The capability matrix is generated but its classification is name-heuristic and its capability strings are untyped.** Per the codegen (`scripts/generate-workbook-facade-matrix.mjs`): a method is `write` if its name starts with one of ~21 prefixes (`add*`, `set*`, `insert*`, `delete*`, `refresh*`, `update*`, …), else `read`, with an 11-entry hardcoded deny list and a handful of special-cases (`toXlsx`→export, `captureScreenshot`→screenshot, `undoGroup`/`batch`→undo-group). This misclassifies any read whose name happens to start with a write prefix (or vice-versa), and the capability values (`'workbook:write'`, etc.) are **magic strings** not statically tied to the `SpreadsheetCapability` union in `public-types.ts` — codegen can emit a capability the type system would reject. The 3,572-line artifact is also editable by hand (no "generated — do not edit" guard inside the file) even though codegen will overwrite it.

6. **Defense-in-depth: the app-internal capability registry is fully permissive.** `shell-documents.ts`'s `createPermissiveCapabilityRegistry` returns `hasCapability() => true` unconditionally, and the runtime boots the shell registry permissively (`createPermissiveShellCapabilityRegistry({ audit: false })`). This is intentional — the *real* gate is the host `authority` + the facade matrix — but it means there is exactly **one** enforcement layer in front of the workbook (the facade Proxy), which makes finding #2 (return-wrapping fail-open) higher-stakes: there is no second net.

7. **Error/auth code paths are duplicated and partly swallow exceptions.** Multiple bespoke error factories (`createRuntimeDisposedError`, `createWorkbookAlreadyOpenError`, `createStaleActorError`) and repeated stale/disposed checks (`record.status !== 'disposed'` open-coded at ≥5 sites) reimplement the same shape; `policySnapshot`/`authorize` catch authority exceptions and record them as plain `'denied'`, masking authority faults from observability. `applyExplicitSaveResult` bypasses `markSavedForRecord` for non-`saved` statuses, so the two save-completion paths can diverge.

8. **Accessibility and React-correctness gaps in the embed UI.** The root uses `tabIndex={-1}` with manual `document.activeElement.blur()` (global side effect) and a `window.dispatchEvent(new Event('resize'))` nudge; loading/error states (lines ~805, ~865) render plain text with no `role`/ARIA live region; the top-level `ErrorBoundary` wraps only the ready UI, not attach/mount; several `useMemo`/`useCallback` dependency arrays omit captured values (`viewHandle`, `notifyError`), risking stale closures; `settingsUiColorScheme` is not reset on detach/reattach with a different theme.

## Improvement objectives

1. **Eliminate the dirty-classifier drift class entirely.** Derive (or drift-guard) `WORKBOOK_MUTATION_EVENT_TYPES` from the canonical event-type source so a newly-added mutating event cannot silently fail to dirty the workbook. Make "a mutating event that does not dirty" a build-time failure, mirroring how the facade matrix is protected.
2. **Make the capability boundary fail-closed on *returns*, not just on methods.** Drive return-object wrapping from the same generated source of truth as method decisions (declared return interfaces), replace the structural `looksLikeFacadeTarget` heuristic with declared-type wrapping, and ensure any unrecognized object-shaped return is wrapped-or-denied rather than passed through raw.
3. **Replace ad-hoc lifecycle bookkeeping in `runtime.ts` with a correct, single-owner model.** A per-`workbookSessionId` open lock that closes the concurrent-open leak; a disposed/stale guard that is race-free across the load `await`; a single subscription/cleanup owner per record (removing the ABA identity check); and removal of the `facade: null as unknown` type lie via deferred initialization.
4. **Model the embed attachment as an explicit state machine.** Use the already-present `xstate` to make attach/detach states (`idle → claiming → attaching → attached → detaching`) explicit and cancellable, collapse the triplicate status tracking to one source, clear `WeakMap` view-state/claim on detach, and make `restoreViewState` cancellable.
5. **Strengthen the matrix generator.** Validate emitted capability strings against the `SpreadsheetCapability` union; prefer explicit per-method metadata from the api-spec over name-prefix heuristics for ambiguous methods; add a generated-file header + (optional) pre-commit `--check`.
6. **Consolidate error/auth plumbing.** One error factory, one `assertRecordUsable`-style guard everywhere, surface authority exceptions distinctly from policy `denied`, and route all save completions through one function.
7. **Bring the embed UI to a11y + React-correctness baseline.** ARIA live regions for loading/error, an error boundary that also catches attach/mount failures, corrected hook dependency arrays, color-scheme reset on reattach, and removal of the global focus/resize side effects in favor of scoped equivalents.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (do not regress):**
- **Public API surface.** Every name exported from `index.tsx` (the ~80 types + `createSpreadsheetRuntime`, `MogSpreadsheetApp`, `mountSpreadsheetApp`) stays exported with compatible shapes; `check-boundary.mjs` (which guards the built `.d.ts`/dist surface and forbidden leaks) must stay green.
- **Fail-closed method gate.** Unmapped/denied methods, and the raw-internals denylist (`context`, `ctx`, `eventBus`, `mirror`, `uiStore`), must continue to throw `AuthorizationDenied`. The `Reflect.get(target, prop, currentTarget)` receiver fix (so getters run with `this === realObject`) must be preserved.
- **Epoch & stale-handle semantics.** Reopening the same `workbookId` yields a new epoch; old facades reject with `disposed`/`stale`. Two distinct `workbookSessionId`s for the same semantic `workbookId` remain independently addressable and `getWorkbookSessionByWorkbookId` stays ambiguity-safe (returns `null`). (All asserted by `runtime-owned-workbook-session-lifecycle.test.ts`.)
- **Headless lifecycle.** A session is usable headlessly, detach returns it to `headless` (not disposed), and `dispose()` disposes every open session. Read-only ops (read cell/formula, precedents/dependents, `captureScreenshot`, inspection) must **not** dirty a clean workbook.
- **Save/dirty state machine semantics.** `requestSave` emits `saving` then returns to `clean` on a `saved` result; stale saves throw with `StaleEpoch`; `markSaved` reconciles by `saveRequestId`.
- **Chart-export round-trip** (`chart-export.test.ts`): created charts survive `exportXlsx` → re-import.
- **No new heavy deps / React 19 peer.** Reuse existing `xstate`/`zustand`; do not add runtime dependencies.

**Strengthen (turn into enforced invariants):**
- *Dirtiness completeness:* "every kernel mutation event dirties the workbook" becomes a build-checked invariant, not a hand-list.
- *Return-wrapping totality:* "every object returned across the facade is gated" becomes type-driven and test-covered.
- *Open atomicity:* "at most one record per `workbookSessionId`, every created record is tracked and disposable" becomes lock-enforced.
- *Capability validity:* "every matrix capability is a member of `SpreadsheetCapability`" becomes codegen-validated.

## Concrete implementation plan

> All edits are inside `mog/runtime/spreadsheet-app/src` plus this package's own `scripts/` and `__tests__/`, **except** the cross-package coordination in step 1 (consuming the canonical event-type vocabulary from `mog/types/events`) and step 5 (api-spec metadata in `runtime/sdk`), which are *requests* coordinated with those owners — see Parallelization.

1. **Close the dirty-classifier drift (priority 1).**
   - Identify the canonical mutation-event vocabulary in `mog/types/events/src` (and any contracts re-export). Two acceptable implementations, in preference order:
     - **(a) Derive:** export, from the canonical event-types package, the set/union of *mutating* event type names (tagging events as mutation-vs-read at their definition site if not already), and build `WORKBOOK_MUTATION_EVENT_TYPES` from it — so the list cannot drift because there is one source.
     - **(b) Drift-guard:** if (a) is too invasive cross-package for one change, keep the local Set but add a generator/`--check` (mirroring `generate-workbook-facade-matrix.mjs`) that fails the build when the canonical event union contains a *mutating* type absent from the Set, with an explicit allowlist for genuinely non-dirtying events (export/recalc/selection/scroll/render/diagnostics — the negatives already enumerated in the test).
   - Either way, add an exhaustiveness test that enumerates the canonical mutating types and asserts each one returns `true` from `isWorkbookMutationEvent`, and that each known non-mutating type returns `false`.
2. **Make facade return-wrapping fail-closed and declared-type-driven.**
   - Have the matrix generator emit, for every method, the *declared* return interface(s) (it already parses signatures for `returns`); treat `returns` as authoritative and required for object-returning methods.
   - In `workbook-facade.ts`, replace the structural `looksLikeFacadeTarget`/`detectFacadeInterface` guesswork with wrapping driven by the declared `returns`: if a method declares a facade interface return, wrap as that interface; if a method returns an object that is *not* a declared, matrix-known interface, **deny or wrap-as-opaque** rather than returning it raw (close the `expected.length === 0 → return value` passthrough at line 231 for object values reachable from the workbook root).
   - Keep the structural sniff only as a defense-in-depth *fallback that denies on ambiguity*, never as a fail-open path.
   - Add tests (step "Tests") that walk the matrix and assert every interface named in any `returns` is itself a key in `WORKBOOK_FACADE_CAPABILITY_MATRIX` (no dangling return target), and that calling a method whose return is a sub-API yields a proxied (gated) object, not the raw one.
3. **Fix `runtime.ts` lifecycle/concurrency.**
   - **Open lock:** key an in-flight promise by `workbookSessionId` and make the "already open" check + record insertion atomic within that lock so two opens cannot both pass; on completion, register the record before releasing. Ensure a record created while `dispose()` is running is itself disposed (re-check state under the lock after the load `await`, and dispose-and-throw if disposing).
   - **Single subscription owner:** introduce a small per-record `DisposableBag` (or reuse `CallableDisposable`) that owns the event-bus subscription, app-bridge subscriptions, and listener sets; `markRecordDisposed` drains it once. Remove the `unsubscribeAppBridge === cleanup` ABA check by giving each bridge registration its own disposable that the bag tracks.
   - **Detach idempotency:** replace the closure `detached` boolean with a cached detach promise (call-once), so concurrent detaches share one run.
   - **Remove the type lie:** construct the record so `facade` is assigned in the same expression (e.g. build the record object, then `record.facade = createWorkbookFacade(record)` before it is observable), or type `facade` as initialized-after via a dedicated init step — no `null as unknown as`.
4. **State-machine the embed attachment (`app-attachment.tsx`).**
   - Define an `xstate` machine for the attach lifecycle (`idle → claiming → attaching → attached → detaching → idle`, plus `error`) with explicit cancellation on `workbook`/`runtime` change and on unmount; drive the component from `useMachine` so status has **one** source of truth (delete `statusRef`/`state.status` duplication; `getStatus()` reads the machine).
   - Clear `WORKBOOK_VIEW_STATE` and release `ACTIVE_WORKBOOK_ATTACHMENTS` on detach/unmount; make `restoreViewState` abortable (carry an `AbortSignal`/cancellation token through the machine context).
   - Collapse the 18 refs to the few that genuinely must escape React's render cycle; pass `props` explicitly instead of the `propsRef.current = props`-every-render pattern where the machine context can hold them.
5. **Strengthen the matrix generator (`scripts/generate-workbook-facade-matrix.mjs`).**
   - Import/duplicate the `SpreadsheetCapability` union and assert every emitted `capability` is a member; fail generation otherwise.
   - For methods whose read/write nature is not reliably inferable from the name, read an explicit classification from api-spec metadata (coordinate with `runtime/sdk` to add a per-method `effect: 'read' | 'write' | 'export' | …` annotation) rather than the prefix heuristic; keep the prefix heuristic only as the default for annotated-absent methods and log/deny on ambiguity.
   - Emit a `// GENERATED — do not edit; run scripts/generate-workbook-facade-matrix.mjs` header and keep `pnpm test`'s `--check` as the drift gate (optionally wire it into pre-commit).
6. **Consolidate error/auth/save plumbing.**
   - One `createSpreadsheetError(kind, message, {recoverable, …})` factory used by all sites; one shared `assertRecordUsable` (already exists in `workbook-facade.ts` — reuse it in `runtime.ts`).
   - In `policySnapshot`/`authorize`, distinguish an authority **exception** (surface as a runtime error / log) from a policy **`denied`** decision.
   - Route every save completion (saved/failed/stale) through `markSavedForRecord`/one emitter so `applyExplicitSaveResult` cannot diverge.
7. **A11y + React correctness in the embed UI.**
   - Wrap loading/error UI with `role="status"`/`role="alert"` (live regions); extend the error boundary to cover attach/mount; fix `useMemo`/`useCallback` dependency arrays (`viewHandle`, `notifyError`, color-scheme); reset `settingsUiColorScheme` on reattach; replace the global `document.activeElement.blur()` and `window.dispatchEvent('resize')` with container-scoped focus management / a `ResizeObserver`-driven relayout.

## Tests and verification gates

> This *planning* task runs no build/test/typecheck. The gates below are what the **implementing** change must add and pass.

1. **Existing node:test suites stay green:** `dirty-events.test.ts`, `chart-export.test.ts`, `runtime-owned-workbook-session-lifecycle.test.ts` (epoch/stale, headless, detach→headless, dispose-all, read-only-stays-clean, duplicate-semantic-id).
2. **Dirty completeness (new):** a test enumerating the canonical mutating event types (from the source chosen in step 1) and asserting `isWorkbookMutationEvent` returns `true` for each; plus the build-time `--check`/generator that fails when a canonical mutating type is missing from the Set.
3. **Facade return totality (new):**
   - Static: every interface referenced in any matrix `returns` array is a top-level key of `WORKBOOK_FACADE_CAPABILITY_MATRIX` (no dangling return target).
   - Behavioral: calling a method that returns a sub-API (`workbook.sheets`, `worksheet.charts`, a `Range`) yields a **proxied** object that still enforces deny on a denied method, and a denied method on a returned object throws `AuthorizationDenied` (no raw passthrough).
   - Negative: an unmapped method name and a raw-internals property (`eventBus`, etc.) throw `AuthorizationDenied`.
4. **Concurrency (new):** `Promise.all([openWorkbook(sameSessionId), openWorkbook(sameSessionId)])` either resolves to the same session or rejects the loser with `AlreadyOpen` — and never leaves an orphaned/undisposed record (assert `records`/document handle count). A `dispose()` interleaved with an in-flight `openWorkbook` disposes the new record. Concurrent `detach()` calls run the underlying detach once.
5. **Attachment machine (new, app-eval or jsdom):** attach→detach→reattach of the same session does not leak view state or the single-attachment claim; rapid `workbook` prop swap cancels the in-flight attach without wiring the stale bridge.
6. **A11y (app-eval):** loading and error states expose live-region roles; keyboard focus enters the grid without the global blur hack.
7. **Matrix generator validity (new):** generator fails if an emitted `capability` is outside the `SpreadsheetCapability` union; `generate-workbook-facade-matrix.mjs --check` passes (no drift).
8. **Build/boundary gates:** `pnpm --filter @mog-sdk/spreadsheet-app typecheck` clean; full `build` (including `check-boundary.mjs --require-dist`) green; `tools/eslint-plugin-mog` clean on changed files. No new forbidden-symbol leaks in the built `.d.ts`.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Cross-package coupling for dirty-events (step 1a).** Deriving the mutation set from `mog/types/events` couples this package to that vocabulary; mitigate by exporting a purpose-built "mutating event names" set there (owned by that package) rather than reaching into internals, and fall back to the local-Set-with-drift-guard (1b) if the cross-package change can't land in lockstep. Either path removes the silent-drift class; (1b) is the safe minimum.
- **Tightening return-wrapping could break a host that relied on a raw passthrough.** Because the boundary is meant to be closed, any such reliance is a latent security bug; still, sweep the in-repo consumers (`@mog/app-spreadsheet`, shell, embed demos) and the `returns` coverage before flipping the passthrough to deny, and stage behind the matrix-driven path so the denial set is reviewable.
- **xstate rewrite of attachment is the largest behavioral change.** Keep the public `SpreadsheetAppAttachmentHandle`/`mountSpreadsheetApp` contract and the lifecycle/detach tests as the invariant; land the machine behind the same external behavior and verify against the existing detach→headless test plus new race tests before removing the old refs.
- **Generated file is huge (3,572 LOC).** Regenerating after the capability-validation change will produce a large diff; this is expected and gated by `--check`. Do not hand-edit.
- **api-spec metadata (step 5) depends on `runtime/sdk`.** If the per-method `effect` annotation can't be added there yet, keep the prefix heuristic as default but add the capability-union validation (which is local) regardless.

**Non-goals (explicitly out of scope):**
- Reduced-scope, test-only, or shim fixes; e.g. "just add the missing event strings to the Set by hand" without a drift guard is explicitly rejected — it re-creates the same class of bug on the next kernel change.
- Changing the public type surface in `public-types.ts` beyond additive, compatible refinements.
- Replacing the permissive app-internal capability registry with a real enforcing one (finding #6 is context, not a task here) — the host `authority` + facade remain the contract; we only make the facade's *return* path as strong as its *method* path.
- Editing kernel/shell/app-spreadsheet internals beyond the coordinated event-vocabulary export and api-spec annotation requests.
- Performance tuning of the grid/render path (owned by canvas/app packages).

## Parallelization notes and dependencies on other folders

- **Coordinate — `mog/types/events/src` (canonical event vocabulary).** Step 1a needs a "mutating event names" export there; if that package's plan is changing event definitions concurrently, agree the export shape first. The drift-guard fallback (1b) keeps this plan independently landable.
- **Coordinate — `runtime/sdk` `api-spec.json` + `generate-workbook-facade-matrix.mjs` (source of truth for the matrix).** Step 2 (return interfaces) and step 5 (per-method `effect` metadata) consume/extend the spec; the capability-union validation is local and needs no coordination.
- **Verify-against — `@mog/shell` (`ShellBootstrapResult`, `documentManager`, `store`, capability registry) and `@mog/app-spreadsheet` (`/register`, `/services` chart exporter).** The runtime depends on their lifecycle/event-bus contracts; changes to record disposal and event subscription must match `documentManager.{create,load,dispose}Document` semantics. No edits to those packages required.
- **Verify-against — `@mog-sdk/contracts` (`Workbook`/`Worksheet` API, capability types).** The facade matrix and `public-types` capabilities ride on these; the `SpreadsheetCapability` union used for codegen validation lives in `public-types.ts` (local) but must stay aligned with contract capability vocabulary.
- **Independent of:** kernel domain internals, canvas/render, file-io, and other runtime app packages — none of those need to change for this plan, so steps 2–4, 6, 7 can proceed in parallel with their folders' plans. Within this folder, the seven steps are largely independent and parallelizable except: step 5 (generator) should land before/with step 2 (which consumes the strengthened `returns`), and step 4 (attachment machine) should land after step 3 (runtime lifecycle) since the embed attaches through the controller.
