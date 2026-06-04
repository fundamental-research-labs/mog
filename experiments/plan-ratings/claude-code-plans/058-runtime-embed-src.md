# Plan 058 — Harden and complete `mog/runtime/embed/src` (public embed runtime: web component, React, iframe, publish)

## Source folder and scope

- **Folder:** `mog/runtime/embed/src`
- **Package:** `@mog-sdk/embed` (`mog/runtime/embed`), browser-targeted, bundled with `tsup` (`platform: 'browser'`, `noExternal: [/^@mog\//, /^@mog-sdk\/(?!wasm)/]`). Only runtime `dependency` is `@mog-sdk/wasm`; `@mog-sdk/kernel`, `@mog-sdk/sheet-view`, `@mog-sdk/types-host`, `@mog-sdk/contracts` are **devDependencies** that get bundled in.
- **Public subpaths (from `package.json` `exports`, asserted by `__tests__/package-boundary.test.ts`):** `.` (root), `./react`, `./web-component`, `./config`, `./internal/views-host` (classified workspace-internal friend). `./client`, `./iframe`, `./publish`, `./full-app` are deliberately **not** in `package.exports`; `client` is a bundle-private tsup entry only.
- **Files in scope:**
  - **Entry barrels:** `index.ts`, `web-component/index.ts`, `react/index.tsx` (barrel + component), `config.ts`, `publish/index.ts`, `iframe/index.ts`, `internal/views-host.ts`, `types.ts`.
  - **Web component:** `mog-sheet-element.ts` (562 lines — the `<mog-sheet>` custom element).
  - **Shared config model + validation:** `config.ts` (330 lines).
  - **Trust resolution:** `resolution.ts` (`resolveEffectiveState`, `TrustContext`, mode/save/collab narrowing).
  - **Host adapters:** `host-adapters/same-page-host.ts`, `react-same-page-host.ts`, `web-component-same-page-host.ts`, `effective-state-gates.ts`, `iframe-child-host.ts`, `iframe-parent-client-placeholder.ts`.
  - **Bundled client:** `client/index.ts` (`MogClient` over `createWorkbook()` from `@mog-sdk/kernel`).
  - **Renderer chrome:** `renderer/index.ts` (`EmbedRenderOrchestrator` over `@mog-sdk/sheet-view`), `renderer/formula-bar.ts`, `renderer/sheet-tabs.ts`.
  - **Iframe transport:** `iframe/protocol.ts`, `iframe/parent-client.ts` (`MogIframeClient`), `iframe/child-host.ts` (`MogIframeHost`).
  - **Publish product:** `publish/types.ts`, `publish/mount.ts` (`createPublishView`), `publish/react.tsx` (`MogPublishedSheet`).
  - **Shared utils:** `shared/event-emitter.ts`, `shared/column-name.ts`.
  - **Tests (reference only, not to be edited as the deliverable):** `__tests__/*` (publish, event-emitter, iframe-parent-client, same-page-host, package-boundary, resolution, column-name, config, iframe-protocol, iframe-child-host).
- **Charter (must be preserved):** This is the *public exposure boundary* of Mog. Per the in-file remarks, every public-subpath symbol is `public-experimental`; kernel/workbook/viewport/renderer internals must **never** leak through `.`, `./react`, `./web-component`, or `./config`. Raw source URLs/paths/bytes are **not** accepted on public props — callers pass an opaque `source.ref` plus a trusted `hostPolicy` that resolves bytes and effective state. Origin validation for iframe transport must use the browser's authoritative `MessageEvent.origin`, never a payload-claimed origin, and `postMessage` target must never be `'*'`.

## Current role of this folder in Mog

`@mog-sdk/embed` is the third-party-facing embedding SDK. It exposes the same *semantic config model* (`MogEmbedConfig`) across four delivery vehicles:

1. **HTML/CDN (`<mog-sheet>`)** — the `MogSheetElement` custom element (auto-registered on import), driven by `config` + `hostPolicy` DOM properties and `no-*` opt-out attributes.
2. **React (`@mog-sdk/embed/react`)** — `MogSheet` forwardRef component with an imperative `MogSheetHandle`.
3. **Iframe (`@mog-sdk/embed/iframe`, not yet shipped)** — a versioned `postMessage` protocol with an untrusted parent client (`MogIframeClient`) and a trusted child host (`MogIframeHost` / `createIframeChildHost`).
4. **Publish (`@mog-sdk/embed/publish`, not yet shipped)** — a read-only, redacted "published sheet" product (`createPublishView` / `MogPublishedSheet`).

The same-page products (web component, React) share a common pipeline: `createSamePageEmbedHost(config, hostPolicy)` → `MogClient` (boots a full `createWorkbook()` from host-authorized XLSX bytes) → `EmbedRenderOrchestrator` (thin chrome — formula bar + sheet tabs — over `@mog-sdk/sheet-view`, which owns the canvas/grid/viewport substrate). Caller-supplied `requestedMode`/`requestedCapabilities`/`requestedSavePolicy`/`requestedCollaboration` are **requests**; the *effective* grant is resolved by the trusted side (`hostPolicy.resolveEffectiveState` same-page, `resolveEffectiveState(config, trust)` iframe-child/publish) and surfaced back read-only via `MogEmbedEffectiveState` + events.

`internal/views-host.ts` is a workspace-private friend surface (`mountEmbedDevHost`) used by `@mog/views-host` for dev/eval, exposing debug accessors over the same client+renderer; it is stripped from packed public manifests.

### Evidence-backed problems found

1. **The iframe trusted path is scaffolding that is never composed end-to-end.** `iframe/child-host.ts` (`MogIframeHost`) negotiates the handshake and dispatches messages, but its `_dispatch` handlers for `sheetSelect`, `rangeSelect`, `scrollTo`, and `focusRequest` are **empty no-op `case`s** (lines 178–186), and `_handleSourceRequest` calls `onSourceRequest(ref)` and **discards the returned bytes** (line 256–259) — it never constructs a `MogClient` or attaches a renderer. Separately, `host-adapters/iframe-child-host.ts` builds a `TrustedDocumentHostContext` entirely through `as unknown as` casts with `kernel: null`, `view: undefined`, and TODO(02b)/TODO(06) placeholders (lines 159–172), so it is not a real trusted context and is wired to nothing. A repo search confirms `MogIframeHost`/`MogIframeClient`/`createIframeChildHost` are referenced only by the `iframe` barrel, each other, and their tests — **not** by `mog-sheet-element.ts` or `react/index.tsx`. The result: a full versioned protocol and origin-validation layer exists, but no production composition actually renders a workbook inside a child frame. The cross-origin embedding story (the security-strongest delivery vehicle) is non-functional.

2. **`MogIframeClient.connect()` leaks listeners and double-routes messages.** `connect()` (parent-client.ts:75–133) calls `_startListening()` (which installs the persistent `_listener` that routes correlated responses and dispatches events) **and** adds a second local `onMessage` listener for the handshake — both attached to `window` simultaneously. A `ready` frame during connect is therefore observed by both. On the 30s timeout path (line 82–84) it rejects **without** removing `onMessage` or calling `_stopListening()` — a permanent `window` `message` listener leak per failed connect. The `versionMismatch` reject path removes `onMessage` but leaves the persistent `_listener` attached, and no path calls `dispose()`. This is a real correctness + resource-leak defect on the public transport surface.

3. **Same-page "modes" and "capabilities" are advisory only — there is no enforcement and no edit pathway.** `MogClient._boot` always calls `createWorkbook(xlsxBytes)` (client/index.ts:195) producing a **fully read-write** workbook. The renderer is display-only: `EmbedRenderOrchestrator`'s only input handler is `onCellClick`, which merely updates the formula bar (renderer/index.ts:291–313) — there is no keyboard/typing/commit/paste path. So `requestedMode` values `comment`/`review`/`protected-edit`/`full-edit`, the entire `requestedCapabilities` array, `requestSave`/`requestExport`, and `dirtyChange`/`saveStateChange` are an API-complete shell with **no functional behavior** and **no kernel-level gate** behind them. The public contract advertises an editing/saving/collaboration surface the runtime cannot honor.

4. **Dirty/save state handling diverges between the two same-page products.** The React path polls `clientRef.current?.workbook?.isDirty` (`emitDirtyChange`, react/index.tsx:222–237) and calls `workbook.markClean()` on successful save (line 293). The web component **never** reads `workbook.isDirty` at all — `_setDirty` is only ever called from inside `requestSave` (mog-sheet-element.ts:206), and it **never calls `markClean()`** on the underlying workbook. So identical configs produce different dirty/effective-state event streams depending on vehicle, and the web component's workbook stays "dirty" in the kernel after a successful host save.

5. **`focus()` is dead code in both adapters.** `EmbedRenderOrchestrator` exposes no `focus()` method (verified — grep finds none), yet both `MogSheetElement.focus()` (mog-sheet-element.ts:193) and the React handle (react/index.tsx:267) call `(this._renderer as any)?.focus?.()`. Focus never reaches the canvas/grid; the `as any` cast hides the gap from the type system.

6. **`navigateToRange` silently mishandles ranges and over-wide columns.** `EmbedRenderOrchestrator.navigateToRange` (renderer/index.ts:145–153) matches only `/^([A-Z]+)(\d+)/i` and scrolls to the **single anchor cell**, dropping any `:`-range. The public docs for `MogSheetHandle.navigateToRange` and `MogSheetElement.navigateToRange` advertise `"B2:D10"` support; callers get top-left scroll with no range selection. The A1 column decode also has no overflow guard.

7. **The publish product is an unimplemented placeholder.** `publish/mount.ts` (`createPublishView`) renders a loading `div`, transitions to `ready` via `queueMicrotask`, and returns a handle whose `setSheet` is a no-op, `getSheetNames` returns `[]`, and which **renders no sheet content at all** (lines 173–240; the file's own header says "the actual Rust-side redaction pipeline and artifact loading are not yet available"). The rich `PublishSecurityPolicy` (formula redaction, comment/named-range/revision stripping) is described in types but enforced nowhere. The publish surface is shipped as a contract with no behavior.

8. **`config.ts` forbidden-key defense is an obfuscated denylist, not an allowlist.** `FORBIDDEN_CONFIG_KEYS` is built by string concatenation (`'provider' + 'Config'`, etc., lines 155–163) to dodge a lint/scan, and `rejectForbiddenKeysDeep` only rejects that fixed set of known-bad keys. Any *other* unexpected key (`providerConfigV2`, `wsEndpointUrl`, an arbitrary `token`-bearing field) passes validation and flows into the config object. For the package whose charter is "no raw host/storage authority crosses the public boundary," a closed allowlist of the known `MogEmbedConfig` keys is the correct posture. Separately, `capabilityGrantRef` and `requestedCapabilities` are type-validated but never consulted by `createSamePageEmbedHost`'s effective-state resolution.

9. **`MogClient` is structurally coupled to the kernel by hand-maintained `as unknown as` casts.** `createWorkbook()`'s result is cast to a local `InternalWorkbook` interface (client/index.ts:26–38, 195) that re-declares `activeSheet`, `viewport`, `isDirty`, `getSheetNames`, `sheets.setActive`, etc. This shadow interface drifts independently of the real `@mog-sdk/kernel` API; a kernel rename compiles fine here and fails only at runtime. `EmbedRenderOrchestrator.attach` does the same probing for `activeSheet?.sheetId` (renderer/index.ts:110–113), and `internal/views-host.ts` re-implements a third copy of structural workbook/worksheet probing (`InternalWorkbookForViewsHost`, `readSheetId`, `normalizeLayout`).

10. **Near-identical boot/wiring orchestration is duplicated across the web component and React, and has already drifted.** `mog-sheet-element._boot` (mog-sheet-element.ts:375–447) and the React main effect (react/index.tsx:333–486) each independently: create the renderer, await the same-page host, attach on `ready`, refresh sheet tabs, resolve effective state, wire `cellSelect`/`sheetChange`/`scroll`/`zoom`, and gate save/export. The dirty-handling and `markClean` divergence in finding 4 is a direct symptom. Roughly ~300 lines of safety-relevant logic are maintained twice.

11. **`crypto.randomUUID()` has no fallback.** Used in `iframe/protocol.ts` `createMessage` and in `host-adapters/iframe-child-host.ts`. `randomUUID` is only defined in secure contexts; an embed protocol frame served over plain `http` (or an older WebView) throws on message creation. The transport should degrade gracefully.

12. **`internal/views-host.ts` re-derives renderer/client debug surface instead of reusing the orchestrator.** It hand-rolls `EmbedDevRendererDebugHandle`/`EmbedDevClientDebugHandle` over the same orchestrator methods and adds bespoke `any`-typed `normalizeLayout`/`readSheetId` probing. The dev/eval friend surface should be a thin typed projection of orchestrator methods, not a parallel implementation.

## Improvement objectives

1. **Make the iframe trusted-child path a real, shippable production vehicle** (or, if it is to remain deferred, gate it explicitly) — compose handshake → source resolution → `MogClient` → `EmbedRenderOrchestrator` inside the child frame, and honor parent navigation requests. No half-built `TrustedDocumentHostContext` casts left as live code.
2. **Fix the `MogIframeClient` connect lifecycle** so there is one listener, no leak on timeout/mismatch, and clean teardown on every reject path.
3. **Resolve the "advisory vs enforced" contract honesty gap**: either wire a real edit/enforcement pathway (mode + capability gates that actually constrain the kernel/renderer) or make the public contract honestly read-only-with-roadmap, so no public type advertises behavior the runtime cannot enforce.
4. **Unify the same-page boot/effective-state/dirty/save pipeline** into one shared "embed session controller" consumed by both the web component and React, eliminating drift (finding 4) by construction.
5. **Harden `config.ts` validation** to a closed allowlist of known keys, removing the obfuscated denylist, and define how `requestedCapabilities`/`capabilityGrantRef` participate in resolution.
6. **Decouple `MogClient`/renderer/views-host from the kernel** behind one typed internal workbook contract rather than three hand-maintained `as unknown as` shadows.
7. **Implement (or explicitly gate) the publish product** so `createPublishView` either renders a redacted artifact or fails closed instead of pretending to be ready.
8. **Fix `navigateToRange`, `focus()`, and `crypto.randomUUID()`** as correctness items that affect real public API behavior.

## Production-path contracts and invariants to preserve or strengthen

- **Public-surface leak invariant (strengthen).** `__tests__/package-boundary.test.ts` already asserts the root/react/web-component/config barrels do not export `MogClient`, `EmbedRenderOrchestrator`, `resolveEffectiveState`, `TrustContext`, workbook/worksheet/viewport types, or provider/render-cache internals, and that `package.exports` is exactly `{ ., ./config, ./internal/views-host, ./react, ./web-component }`. Every change below must keep these green and must not add a new public subpath without an explicit boundary-test update.
- **Opaque-source invariant (preserve).** Public props accept only `MogEmbedSourceRef.ref` (an issued handle) + a `hostPolicy`; raw URLs/paths/bytes are rejected. `src` on React is `never`; `<mog-sheet src>` errors. The bundled client only accepts `sourceBytes` already resolved by the trusted policy (`client` test asserts no `fetch(` and no `string` source).
- **Origin/`postMessage` invariant (preserve and extend to the new composition).** Validation uses `MessageEvent.origin` against an explicit allowlist (never payload-claimed), `expectedSource` is checked, and `postMessage` target is an exact origin (the parent client constructor throws on `'*'`). The completed iframe path (objective 1) must route through `validateMessageEvent`/`validateOrigin` exactly as the existing transport does.
- **Effective-state-is-trusted invariant (preserve).** Caller `requested*` fields are never echoed back as effective; effective state is produced only by `hostPolicy.resolveEffectiveState` (same-page) or `resolveEffectiveState(config, trust)` (iframe-child/publish). The React boundary test explicitly forbids `capabilities: config?.requestedCapabilities` style synthesis — keep it.
- **Save/export gating invariant (preserve).** `canRequestSaveFromEffectiveState`/`canRequestExportFromEffectiveState` are the single gate; the boundary test forbids inlining `if (!hostPolicy.requestSave)` checks in the vehicles. The unified controller (objective 4) must continue to gate through these helpers.
- **Publish read-only invariant (preserve and finally enforce).** `MogPublishEffectiveState` is structurally frozen to read-only (`mode: 'readonly'`, `canMutate: false`, `dirty: false`, etc.). Implementation (objective 7) must install the kernel/redaction gates the types promise, not just hide chrome.
- **Resolution monotonicity (preserve).** `narrowMode`/`narrowSave`/`narrowCollab` never *raise* a request above the trust ceiling; the per-boundary `defaultMaxMode` (`publish`→`readonly`, `iframe-child`→`protected-edit`, `same-origin-trusted`→`full-edit`) is the cap. Any new boundary must define its ceiling here.

## Concrete implementation plan

**Phase A — Transport correctness (low risk, high value).**
1. Rewrite `MogIframeClient.connect()` so the persistent `_listener` is the *only* `window` listener: fold handshake handling into `_dispatch`/a connect-state machine, resolve/reject the connect promise from there, and ensure the timeout, `versionMismatch`, and disposed paths all `_stopListening()` (or `dispose()`) and clear pending state. Add a `__tests__` case (reference) for "timeout leaves no listener" and "double-ready does not double-resolve."
2. Add a `safeRandomId()` helper in `iframe/protocol.ts` that uses `crypto.randomUUID()` when available and falls back to a `crypto.getRandomValues`-seeded id otherwise; route `createMessage` and the adapter hostId through it.

**Phase B — Decouple the kernel boundary.**
3. Introduce one internal typed contract (e.g. `client/internal-workbook.ts`) for the workbook/worksheet/viewport shape `MogClient` needs, imported from the kernel's own published types where possible rather than re-declared. Replace the three `as unknown as` shadows (`client/index.ts`, `renderer/index.ts` `attach`, `internal/views-host.ts`) with this single contract. Keep it bundle-private (not exported through any public subpath).

**Phase C — Unify the same-page session controller (depends on B).**
4. Extract a `host-adapters/embed-session.ts` controller that owns: renderer creation from resolved options, host attach, `ready`/`error` wiring, sheet-tab refresh, effective-state resolution, dirty polling (`workbook.isDirty` + `markClean`), and save/export through `effective-state-gates`. Re-implement `MogSheetElement._boot` and the React main effect as thin DOM/React shells over this controller. This fixes finding 4 by removing the second copy. Preserve every event name/shape currently emitted (`mog-*` CustomEvents for the element; `on*` callbacks for React) so the public surface is byte-compatible.
5. Fix `focus()` by adding a real `focus()` to `EmbedRenderOrchestrator` that forwards to the SheetView focus target, and drop the `as any` in both vehicles.
6. Fix `navigateToRange` to parse full `A1:B2` ranges (and bare `A1`), guard column overflow, and scroll-to + select the range via SheetView's range API; align both public docs with the implemented behavior.

**Phase D — Contract honesty for modes/capabilities (decision-gated).**
7. Decide (see AskUserQuestion-style decision in Risks) between **(D1)** wiring a real edit/enforcement pathway — a kernel-backed mutation gate keyed off `effectiveState.mode`/`capabilities`, plus the renderer edit-input path — or **(D2)** narrowing the *public* contract to the read-only reality (mark edit modes/capabilities/save/export `@stability` reserved or remove from the shipped surface) while keeping the resolution machinery for the iframe/publish trusted sides. Whichever is chosen, no public type may advertise unenforced behavior.

**Phase E — Iframe child composition (depends on A, B, C).**
8. Implement the trusted child entry that: starts `MogIframeHost`, on validated `sourceRef` resolves bytes via the host's `onSourceRequest`, constructs a `MogClient` from those bytes, mounts an `EmbedRenderOrchestrator` (reusing the Phase-C controller where it fits), honors `sheetSelect`/`rangeSelect`/`scrollTo`/`focusRequest` (currently no-ops), and emits `ready`/`sheetChange`/`selectionChange`/effective state to the parent. Replace the `as unknown as TrustedDocumentHostContext` block in `host-adapters/iframe-child-host.ts` with a real context construction, or delete that file if the composition supersedes it. Keep `./iframe` out of `package.exports` until it is end-to-end verified, then add it with a boundary-test update.

**Phase F — Validation hardening.**
9. Replace the denylist in `config.ts` with a closed allowlist of the documented `MogEmbedConfig` keys (and per-object allowlists for `source`/`chrome`/`theme`), reporting unknown keys as validation errors; remove the string-concatenation obfuscation. Document and (if D1) wire how `requestedCapabilities`/`capabilityGrantRef` feed resolution.

**Phase G — Publish (decision-gated).**
10. Either implement `createPublishView` against the redacted-artifact renderer (reuse `EmbedRenderOrchestrator` with a read-only client over the redacted snapshot, enforce `PublishSecurityPolicy` at the kernel boundary) or make it **fail closed** (`status: 'error'`, rejected `ready`) until the Rust pipeline lands, so it never reports `ready` while rendering nothing. Update `MogPublishedSheet` accordingly.

**Phase H — Dev friend surface.**
11. Refactor `internal/views-host.ts` to a thin typed projection over the Phase-C orchestrator/controller, removing the parallel `any`-typed probing.

## Tests and verification gates

- **Package-boundary suite stays green** (`__tests__/package-boundary.test.ts`): no new public exports, `package.exports` unchanged unless a phase deliberately adds `./iframe`/`./publish` *with* a same-PR boundary-test update and a security sign-off.
- **Existing suites must still pass** unchanged in intent: `config.test.ts` (extend for the allowlist rejections), `resolution.test.ts`, `iframe-protocol.test.ts`, `iframe-parent-client.test.ts` (extend for the connect-leak fix), `iframe-child-host.test.ts` (extend for real composition), `same-page-host.test.ts`, `publish.test.ts` (extend for fail-closed/real-render), `event-emitter.test.ts`, `column-name.test.ts`.
- **New behavioral tests (reference, authored alongside code):** connect-timeout-leaves-no-listener; double-`ready` idempotence; web-component vs React dirty/effective-state parity (same config → same event stream); `navigateToRange("B2:D10")` selects the range; `focus()` reaches the view; allowlist rejects unknown top-level + nested keys; iframe child renders a real workbook and honors `sheetSelect`.
- **Build/type gates (run by the implementer, not this planning step):** `pnpm --filter @mog-sdk/embed typecheck`, the package `build` (tsup, with the kernel-decoupling contract resolving), and `pnpm --filter @mog-sdk/embed test`. The `as unknown as` reductions should *reduce* the number of casts (track as a quality metric).
- **App/eval gates:** exercise the `internal/views-host` friend surface through `@mog/views-host` app-eval scenarios to confirm the refactor (Phase H) does not regress dev/eval rendering.

## Risks, edge cases, and non-goals

- **Decision required (D, G).** Whether to *implement* same-page editing + publish rendering now or to *narrow the contract / fail closed* is a product-direction call, not a code detail — it changes whether public types advertise editing and whether `./publish` ships. The plan is structured so the safe option (contract honesty + fail-closed) is shippable independently and the ambitious option (real editing, real publish) layers on top. This should be confirmed with the embed product owner before Phase D/G land.
- **Public-surface compatibility.** The web component emits `mog-*` CustomEvents and the React component fires `on*` callbacks that third parties already bind to; the Phase-C unification must keep names, payload shapes, and ordering identical. Treat any change here as a breaking-change review even though the package is `public-experimental`.
- **Kernel coupling churn (Phase B).** Importing kernel types directly trades hidden runtime drift for visible compile-time coupling; if the kernel's public type surface is unstable, define a minimal embed-owned interface that the kernel is asserted to satisfy via a single typed adapter, rather than scattering casts.
- **`randomUUID` fallback** must remain collision-resistant enough for correlation IDs; do not weaken to `Math.random()`.
- **Non-goals:** no new public subpaths beyond `./iframe`/`./publish` (and only when verified); no change to `@mog-sdk/sheet-view`'s substrate ownership (embed stays a thin chrome consumer); no reduced-scope test-only patches; no compatibility shims for the legacy `src` attribute (it must keep erroring); the Rust-side redaction pipeline itself is out of scope (this folder consumes it).

## Parallelization notes and dependencies on other folders

- **Internal ordering:** Phase A (transport) and Phase F (validation) are independent and can land first. Phase B (kernel decoupling) unblocks C and E. Phase C unblocks E and H. Phases D and G are decision-gated and can proceed in parallel once their direction is set.
- **`@mog-sdk/kernel`** (`mog/kernel/src/api`, Plan 009 and siblings): Phase B depends on the kernel exposing a stable workbook/worksheet/viewport type (or accepting a small adapter); coordinate so the embed-owned interface matches what `createWorkbook()` actually returns. If editing is chosen (D1), the kernel mutation-gate / capability-enforcement surface must exist — coordinate with the kernel services/undo and document-collab plans.
- **`@mog-sdk/sheet-view`:** Phases C/E rely on its `focus`, range-select, and `scrollTo` APIs; confirm a focus target and range-selection entry exist (the renderer currently only uses `scrollTo`, `switchSheet`, `viewport`, `geometry`).
- **`@mog-sdk/types-host`** (`mog/types` trusted/runtime/diagnostics/trust): Phase E's real `TrustedDocumentHostContext` construction must use the branded-construction path these contracts define instead of `as unknown as`; coordinate with the types-host plan owners.
- **`@mog/views-host`** (consumer of `./internal/views-host`): Phase H is a friend-surface refactor — verify against its app-eval scenarios before merge.
- **Publish Rust pipeline (out-of-folder):** Phase G's "implement" branch depends on the redaction/artifact pipeline; until then the fail-closed branch is the production-correct behavior.
