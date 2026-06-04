# 059 — Improve `mog/runtime/sdk/src` (public `@mog-sdk/node` surface & generated API integration)

## Source folder and scope

- **Folder:** `mog/runtime/sdk/src`
- **Package:** `@mog-sdk/node` v0.8.0 — the published, headless Node.js spreadsheet engine. This is the *external* product surface: what `import { createWorkbook } from '@mog-sdk/node'` resolves to.
- **Files in scope (9 source files, 2 generated):**
  - `index.ts` (191 lines) — public barrel. Re-exports `createWorkbook`, the deprecated `HeadlessEngine` family, `CollaborativeEngine`, `Utils`/A1 helpers, the `api`/`apiSpec` introspection objects, and ~70 contract types from `@mog-sdk/contracts/*`.
  - `boot.ts` (839 lines) — the `createWorkbook` factory (host-backed, trusted path) **and** the `@deprecated` `HeadlessEngine`/`HeadlessLifecycleSystem`/`createHeadlessEngine`/`createHeadlessEngineFromYrsState` raw-NAPI boot path. Locally redeclares `CreateWorkbookOptions`, `HeadlessOptions`, `WorkbookConfig`, `NapiAddonModule`, `MogSdkLogger`.
  - `public-kernel-facade.ts` (74 lines) — typed re-exports of `@mog-sdk/kernel` symbols (`Utils`, `MogDocumentFactory`, `MogSdkError`, `MogSdkEventFacade`, A1 utils) with SDK-owned interface declarations layered on top.
  - `api-describe.ts` (514 lines) — programmatic API-introspection (`api.describe()`, `api.wb/ws/types` lazy object tree) built from the generated spec for AI agents.
  - `collaborative-engine.ts` (694 lines) — `@experimental` multi-participant sync wrapper (`CollaborativeEngine`, `createCollaborativeGroup`) over the deprecated `HeadlessEngine` + a hand-typed NAPI `CoordinatorHandle`.
  - `host-adapters/node-headless-host.ts` (725 lines) — `createNodeHeadlessHost`, the trusted `TrustedDocumentHostContext` factory; native platform-package resolution (`loadNodeSdkNapiAddon`).
  - `chart-export/node-chart-image-exporter.ts` (484 lines) — `ChartMark` → native raster request serializer/validator for headless chart PNG/JPEG export.
  - `generated/api-spec.json` (**4.95 MB, git-tracked**) and `generated/api-spec.schema.json` (13 KB) — emitted by `scripts/generate-api-spec.ts` from `contracts/`/`types/`.
- **Out of scope (named only for coupling):** `@mog-sdk/kernel`, `@mog/kernel-host-internal`, `@mog-sdk/contracts/*`, `@mog-sdk/types-host/*`, `@mog/charts/export`, and the native platform packages (`@mog-sdk/darwin-arm64`, etc.). `scripts/`, `__tests__/`, `package.json`, `tsup.config.ts`, `api-extractor.json`, `README.md`, `llms.txt` are sibling files **outside `src/`** — this plan flags drift in them but edits only `src/` (with README/llms.txt corrections explicitly called out as adjacent follow-ups, not part of the `src/` edit set, since the constraints forbid editing config/doc files in this run's mechanical sense; see Non-goals).

## Current role of this folder in Mog

`mog/runtime/sdk/src` is the **only public, shippable entry point to the engine outside the browser app**. Everything here compiles into `dist/` and is what npm consumers, internal automation/ETL, CI jobs, agent runtimes, and the `app-eval`/`api-eval` harnesses import. Its responsibilities:

1. **Stable factory surface.** `createWorkbook()` is the one supported way in; it builds a fully-wired trusted `TrustedDocumentHostContext` via the node headless host adapter and delegates to `createHostBackedDocument`/`importHostBackedDocument` from `@mog/kernel-host-internal`. It **fails closed** — the code comment is explicit that falling back to raw construction would bypass source-handle validation, operation gates, and principal/resource binding.
2. **Trust boundary materialization.** `node-headless-host.ts` is the single module allowed to construct the branded `TrustedDocumentHostContext`. It encodes the headless trust profile (`cooperative-local`, `rust-policy-engine` for workbook access), the document-authorization service (allow create/open/import/export; deny management ops), and source-handle wrapping for imported XLSX bytes.
3. **Introspection for agents.** `api-describe.ts` + `generated/api-spec.json` give LLM agents a navigable description of the full Workbook/Worksheet API without reading `.d.ts` files. This is a load-bearing capability for the agent product, advertised in `llms.txt`.
4. **Deprecated-but-load-bearing raw path.** `HeadlessEngine`/`createHeadlessEngine` are marked `@internal @deprecated`, yet `CollaborativeEngine` (an `@experimental` *public* export) is built entirely on top of them and the raw `createHeadlessDocument` boot path — i.e. the deprecated path is the substrate for shipped collaboration.

Because this is the API of record for external consumers, improvements here are about **contract correctness, lifecycle safety, type honesty at the NAPI/host seam, and bundle/startup cost** — not new features.

## Evidence (observed in the current tree)

1. **Async disposal swallowed by sync `dispose()`.** In `createWorkbook` (`boot.ts:333–354`), the returned workbook's `dispose` is overridden to call `void readyHandle.dispose().catch(...)` — **fire-and-forget**. `close()` and `[Symbol.asyncDispose]` correctly `await readyHandle.dispose()`. So `await wb.dispose()` resolves *before* the handle (and its native resources/host) are actually torn down. A consumer that disposes then lets the process exit can race native cleanup; a consumer expecting `dispose()` to be awaitable gets a `void`-returning function. The `MogDisposable`/`MogAsyncDisposable` contracts are exported but the factory's `dispose` honors neither cleanly.
2. **Two creation paths with diverging guarantees.** `createWorkbook` is host-backed and fails closed (`boot.ts:276–313`); `HeadlessLifecycleSystem.create/createFromXlsx` (`boot.ts:527–559`) uses `createHeadlessDocument`/`importHeadlessDocumentFromXlsx` from `@mog/kernel-host-internal` **directly, with the options object cast `as any`** (`boot.ts:536`, `boot.ts:557`). The `as any` defeats all type checking on what the deprecated path passes to the kernel-host boundary, and that path is exactly the one `CollaborativeEngine` uses — so shipped collaboration runs through the un-typechecked, host-adapter-bypassing route the `createWorkbook` comment warns against.
3. **Cross-workbook link registry only wired on the deprecated path.** `registerExternalWorkbookSession` (`boot.ts:72–87`) populates a process-global `Symbol.for('mog.externalWorkbookSessions')` Map, but it is called only from `HeadlessEngine.initWorkbook` (`boot.ts:687–695`), never from `createWorkbook`. Cross-workbook link resolution therefore behaves differently depending on which factory the caller used — a silent split-brain.
4. **Untyped NAPI coordinator surface.** Every coordinator function in `collaborative-engine.ts` is reached through a hand-written `this.addon['coordinator_*'] as (...) => any` cast (15 such casts), and each result is unwrapped with `typeof result === 'string' ? JSON.parse(result) : result` — i.e. the NAPI return shape is unknown/unstable at the type level and probed at runtime. `catch (e: any)` (`:557`) loses error typing. There is no shared typed declaration of the coordinator addon contract.
5. **Eager 4.95 MB JSON import on every `@mog-sdk/node` load.** `api-describe.ts:1` does `import rawApiSpec from './generated/api-spec.json'`. Because `api`/`apiSpec` are re-exported from the package barrel (`index.ts:174`), the entire ~5 MB spec is parsed and resident for *every* consumer of the package, including those that only call `createWorkbook` and never touch introspection. The file is **git-tracked** (confirmed via `git ls-files`) and regenerated at build time — a committed generated artifact that can drift from `contracts/`.
6. **`ApiSpec` shape is `as unknown`-trusted, not validated against the loaded object.** `apiSpec: ApiSpec = rawApiSpec as unknown as ApiSpec` (`api-describe.ts:40`). Throughout the file, `spec.interfaces[name as keyof typeof spec.interfaces] as {...} | undefined` casts paper over the fact that the runtime JSON is not type-checked against the `ApiSpec` interface declared in the same file. A schema file exists (`api-spec.schema.json`) but nothing in `src/` validates the loaded JSON against it at load or in CI from this side.
7. **Duplicated `MogSdkLogger` interface and debug-flag parsing.** `interface MogSdkLogger` is declared identically in `boot.ts:197` and `node-headless-host.ts:120`. The `MOG_SDK_DEBUG ?? MOG_DEBUG` env parse is duplicated as `isSdkDebugEnabled` (`boot.ts:369`) and `isDebugEnabled` (`node-headless-host.ts:168`) with identical bodies. Two sources of truth for one logging contract.
8. **Whole-file byte fingerprinting blows up memory on large imports.** `computeByteContentIdentity` (`node-headless-host.ts:227`) calls `computeCanonicalFingerprint({ bytes: Array.from(bytes), ... })`, which converts the *entire* XLSX byte buffer into a JS number array, then `canonicalJsonStringify` builds a giant `[n,n,n,...]` string, then SHA-256s it. For a multi-MB workbook this allocates several times the file size in transient strings/arrays purely to derive a content hash that `createHash('sha256').update(bytes)` could compute directly over the buffer.
9. **Locally-redeclared types as a build-tool workaround.** `WorkbookConfig`/`CreateWorkbookOptions`/`HeadlessOptions`/`NapiAddonModule` are redeclared in `boot.ts` with the comment "locally declared so tsup's DTS bundler can inline them (it can't resolve `@mog-sdk/kernel/api` workspace subpath)" (`boot.ts:117–120`). `WorkbookConfig` duplicates the kernel's own config shape; drift between this copy and the real kernel type is unguarded.
10. **Deprecated symbols on the public barrel.** `HeadlessEngine`, `createHeadlessEngine`, `createHeadlessEngineFromYrsState`, `HeadlessOptions`, `HeadlessCodeExecutorFactory`, `NapiAddonModule` are all exported from `index.ts:34–44` while being `@internal`/`@deprecated` in `boot.ts`. The barrel does not visibly separate stable from deprecated/internal exports, so consumers and the API-extractor report cannot easily tell the supported surface from the legacy substrate.
11. **README/`llms.txt` drift (adjacent, not in `src/`).** `README.md:30` instructs `cd compute-core-napi && pnpm build` to build the native addon, but the runtime resolves prebuilt platform packages (`@mog-sdk/darwin-${arch}`, `@mog-sdk/linux-…`, `@mog-sdk/win32-x64-msvc`) via `getPlatformPackageName()` (`node-headless-host.ts:238–252`). `llms.txt` hardcodes "582 spreadsheet formula functions" — a count that drifts. Flagged for the doc-owning follow-up; this plan does not edit those files.

## Improvement objectives

1. **Make `dispose()` honest and awaitable.** The public disposal contract for a headless engine that owns native resources must fully release them before the returned promise resolves. Eliminate the fire-and-forget in `createWorkbook`.
2. **Collapse the two creation paths onto one trusted, typed substrate** — or, where the raw path must persist for collaboration, route it through the same host-backed, type-checked boundary so the `as any` and the host-adapter bypass disappear and collaboration gets the same source-handle/operation-gate guarantees.
3. **Type the NAPI coordinator contract.** Replace the 15 ad-hoc `as (...) => any` casts and the `JSON.parse`-or-object probing with a single declared coordinator addon interface and a stable, documented return convention.
4. **Stop paying ~5 MB of import cost for unused introspection.** Make the API spec load lazily so `createWorkbook`-only consumers don't parse the whole spec, and so the published bundle isn't penalized by it.
5. **Guarantee the loaded spec matches `ApiSpec`.** Validate the generated JSON against `api-spec.schema.json` (or a generated type guard) at the seam, so `api-describe.ts`'s casts rest on a verified shape rather than `as unknown`.
6. **Deduplicate the logging contract and debug-flag parsing** into one shared internal module consumed by both `boot.ts` and `node-headless-host.ts`.
7. **Fix the byte-fingerprint memory blow-up** by hashing buffers directly.
8. **Make the public surface legible** — clearly separate stable exports from deprecated/internal ones in the barrel, and ensure the deprecated raw path is either de-published or kept only as the documented collaboration substrate.

All objectives tighten the production contract every external consumer compiles and runs against; none reduce scope, add shims, or change spreadsheet behavior.

## Production-path contracts and invariants to preserve or strengthen

- **`createWorkbook` overload set is frozen.** All six overloads (blank / `Uint8Array` / path / bytes+opts / path+opts / options-bag) and the power-user `WorkbookConfig` (`ctx` + `eventBus`) branch must keep their exact resolution semantics, including the `source.type === 'bytes'` and `principal → security.resolvePrincipal` normalizations (`boot.ts:255–271`).
- **Fail-closed creation.** The host-backed path must keep failing closed on error (`hostResult.dispose()` then rethrow, `boot.ts:306–313`). No change may introduce a fallback to raw construction that bypasses source-handle validation, operation gates, or principal/resource binding.
- **Import readiness.** Imported workbooks must remain fully queryable when `createWorkbook` resolves — `awaitImportDurability()` before returning (`boot.ts:320–322`) is load-bearing for headless callers and must not be deferred.
- **Trust profile semantics.** `node-headless-host.ts` must keep emitting `cooperative-local` / `trusted-process` / `workbookAccess: 'rust-policy-engine'`, denying management operations, and enforcing the single-use source-handle resolver's full equality check (`:660–683`). Strengthening the fingerprint (objective 7) must produce the *same* identity decisions, only more cheaply.
- **Branded-context construction stays confined.** Only `node-headless-host.ts` constructs `TrustedDocumentHostContext`; the `as unknown as` brand cast must remain a single, documented site.
- **Introspection output is stable.** `api.describe()` / `api.wb` / `api.ws` / `api.types` shapes and the `type:` / `wb.x` / `ws.x.y` path grammar are consumed by agents and `llms.txt`; lazy-loading the spec (objective 4) must not change any returned value, only when it's computed.
- **Timezone defaulting.** Headless hosts never read process TZ; `'UTC'` default and explicit `userTimezone` threading through both factories must be preserved (`boot.ts:274`, `node-headless-host.ts:84–85`).
- **Chart export validation.** `node-chart-image-exporter.ts`'s strict per-mark validation and the post-render dimension/format assertion (`:165–173`) are a correctness gate against silent native mis-rasterization — keep them strict.
- **API-extractor report.** Any barrel reorganization must keep `etc/` API-extractor snapshots meaningful; stable-vs-deprecated separation should be reflected, not hidden.

## Concrete implementation plan

Sequenced so low-risk, isolated fixes land first; the creation-path consolidation (highest ripple) lands last behind explicit coordination.

### Step 1 — Fix `dispose()` to fully release resources (correctness)
- In `createWorkbook`, make the overridden `wb.dispose` `async` and `await readyHandle.dispose()` before resolving (mirroring `close`/`asyncDispose`), or have `dispose` delegate to the same internal async teardown the other two use. Preserve idempotency and ordering (`originalDispose()` → handle dispose → `hostResult.dispose()`).
- Reconcile with the `Workbook` contract's declared `dispose` signature: if the contract types `dispose(): void`, coordinate a contracts change to `Promise<void>` (cross-folder, flag it) rather than silently changing the runtime return. Do not leave a `void`-returning fire-and-forget.
- Add a regression test asserting native/handle teardown has completed when the `dispose()` promise resolves (e.g. a spy on `readyHandle.dispose` awaited before resolution).

### Step 2 — Deduplicate logging + debug-flag parsing (mechanical)
- Create `src/internal/diagnostics.ts` exporting the single `MogSdkLogger` interface and an `isSdkDebugEnabled(opts)` / `resolveDebug(env)` helper.
- Import it in `boot.ts` and `node-headless-host.ts`; delete both local `MogSdkLogger` declarations and both env-parse copies. Keep `MogSdkLogger` re-exported from the barrel with the same name/shape so the public type is unchanged.

### Step 3 — Hash bytes directly in the host fingerprint (perf/memory)
- Replace `computeByteContentIdentity`'s `Array.from(bytes)` + `canonicalJsonStringify` round-trip with a direct `createHash('sha256').update(bytes).update(<sizeBytes>)` digest, wrapped to the same `mog-host-fp:v1:sha256:` format. Keep `sizeBytes` in the identity object.
- **Invariant:** the produced `handleFingerprint` must remain *internally consistent* (issuer and resolver both compute it the same way) so the single-use source-handle equality check still passes. If the fingerprint string value changes, both the issuance site and `sourceHandleResolvers.resolve` change together in this step. Add a test that import-from-bytes round-trips through the resolver successfully and that a tampered byte buffer is rejected.

### Step 4 — Lazy + validated API spec (bundle/startup + safety)
- Convert `api-describe.ts` from a top-level `import … from './generated/api-spec.json'` to a lazy loader: parse/require the spec on first access to `api.describe`/`api.wb`/`api.ws`/`api.types`/`apiSpec`, memoized. Keep all returned shapes identical.
- At the load seam, validate the parsed object against `generated/api-spec.schema.json` (or a generated runtime type guard) once, replacing the `as unknown as ApiSpec` trust with a checked narrowing; throw an attributable error if the committed spec drifts from its schema.
- Confirm `tsup`/exports still tree-shake: `createWorkbook`-only consumers should no longer pull the 5 MB JSON into their import graph. (Verification is for the implementing change; this plan does not run builds.)

### Step 5 — Type the NAPI coordinator contract (type honesty)
- Declare a `CoordinatorAddon` interface (the `coordinator_*` function signatures with real parameter/return types) in `collaborative-engine.ts` (or a shared `src/internal/napi-coordinator.ts`), and type `CoordinatorHandle`'s `addon` as that interface instead of indexing `NapiAddonModule` with `as (...) => any`.
- Pin the return convention: either the NAPI layer returns structured objects or JSON strings — pick one and assert it, removing the per-call `typeof result === 'string' ? JSON.parse : result` probe (or centralize it in one typed `decode<T>()` helper if the addon genuinely returns strings). Replace `catch (e: any)` with `catch (e: unknown)` + narrowing.
- Cross-folder: the authoritative `coordinator_*` signatures live in the native addon / NAPI binding crate. Coordinate the interface with that owner so the TS declaration is the true contract, not a guess.

### Step 6 — Consolidate the creation paths (highest ripple)
- Route `CollaborativeEngine` (and `createHeadlessEngineFromYrsState`) onto the host-backed creation boundary so the deprecated `HeadlessLifecycleSystem` either (a) is rebuilt to go through `createNodeHeadlessHost` + the kernel-host-internal factories with **typed** options (removing the two `as any` casts at `boot.ts:536,557`), or (b) is retained only as a thin, typed wrapper whose option object matches the `@mog/kernel-host-internal` signature exactly (delete the `as any`).
- Wire `registerExternalWorkbookSession` consistently: if cross-workbook links are a supported capability, populate the registry from the host-backed `createWorkbook` path too; if it is collaboration-only, scope/document it so the split-brain (evidence #3) is intentional and visible, not accidental.
- This is the step that retires or properly bounds the `@deprecated` raw path. Gate it behind the full SDK conformance + colab-eval suites.

### Step 7 — Make the public surface legible (additive)
- Reorganize `index.ts` into clearly commented blocks: **Stable** (`createWorkbook`, `Utils`/A1 helpers, contract types, `api`/`apiSpec`), **Experimental** (`CollaborativeEngine`, `createCollaborativeGroup`, `SyncMode`), **Deprecated/Internal** (`HeadlessEngine` family). Keep `@stability`/`@deprecated` JSDoc on each export so the API-extractor report reflects the split. Do not remove any export without a coordinated major-version/contracts change.
- After Step 6 determines whether the raw `HeadlessEngine` path is still needed by anything external, decide (with the package owner) whether to keep it exported, mark it clearly legacy, or drop it from the barrel in a future major.

### Step 8 — Replace the locally-redeclared types with the build-tool fix (cleanup)
- Investigate whether the tsup DTS-bundler limitation that forced the local `WorkbookConfig`/`HeadlessOptions` redeclarations (`boot.ts:117–120`) is still real. If the subpath now resolves, import the canonical kernel types and delete the duplicates. If not, add a type-level guard (a `satisfies`/assignability check against the kernel type) so drift between the local copy and the real kernel config is caught at compile time.

## Tests and verification gates

- **Existing `__tests__/` must stay green:** `runner.test.ts`, `kernel-boundary.test.ts`, `chart-export.test.ts`, `node-chart-image-exporter.test.ts`, `sdk-logging.test.ts`. `sdk-logging` directly covers Step 2; `node-chart-image-exporter`/`chart-export` guard Step 3's neighborhood; `kernel-boundary` guards the trust seam touched by Steps 3 and 6.
- **New tests:**
  - Step 1: `dispose()` awaits handle teardown (spy asserts handle disposed before promise resolves); `dispose()` is idempotent; `[Symbol.asyncDispose]` and `close('save')` still teardown in order.
  - Step 3: import-from-bytes succeeds through the source-handle resolver after the fingerprint change; a mutated byte buffer is rejected; large-buffer import does not allocate O(file) intermediate arrays (assert via the new code path, or a memory/timing smoke check).
  - Step 4: `api.describe()` / `api.describe('ws.charts')` / `api.describe('ws.charts.add')` / `api.describe('type:ChartType')` / `api.wb` / `api.ws` / `api.types` return byte-identical results to pre-change; spec is loaded lazily (a module-load probe shows the JSON is not parsed until first `api` access); schema-validation throws on a deliberately corrupted spec fixture.
  - Step 5: a coordinator round-trip (create → join → push → pull) using the typed interface; a malformed addon (missing `coordinator_push`) fails with a typed, attributable error rather than `undefined is not a function`.
  - Step 6: colab-eval scenarios pass against the consolidated path; the two `as any` casts are gone (grep gate: zero `as any` in `boot.ts`); `CollaborativeEngine` create/sync/dispose lifecycle unchanged.
- **Static gates:** `pnpm --filter @mog-sdk/node typecheck` clean; `api-report` (api-extractor) reviewed so the stable/experimental/deprecated reorg (Step 7) is reflected, not a silent surface change; `verify-build`/`smoke-test`/`verify-publish` scripts still pass for the implementing change.
- **No build/test/typecheck commands are run while authoring this plan.** These gates are for the implementing change.

## Risks, edge cases, and non-goals

- **Highest risk: Step 6 (path consolidation).** `CollaborativeEngine` is `@experimental` but shipped; rerouting its boot must not change CRDT/Yrs-state semantics (the `from_yrs_state` "same Yrs items" requirement documented at `collaborative-engine.ts:265–295` is load-bearing for correct merges). Migrate behind colab-eval; treat any divergence in SheetId/history sharing as a blocker.
- **Step 1 dispose change may ripple into the `Workbook` contract** (`@mog-sdk/contracts/api`) if `dispose` is typed `void`. That is a cross-folder, possibly breaking-signature change — coordinate; do not work around it with a cast.
- **Step 3 fingerprint format change is security-adjacent.** The issuance site and the resolver must change atomically; a mismatch fails *closed* (import rejected) rather than open, but it would break all imports — hence the paired round-trip test.
- **Step 4 lazy-loading must not change `api` semantics or first-call latency unacceptably.** Parsing 5 MB on first `api` access is acceptable (agents opt into introspection); penalizing `createWorkbook` callers is what we're removing.
- **Step 5 depends on the native addon's real return convention.** If the coordinator NAPI genuinely returns JSON strings inconsistently, the fix is to pin the convention with the addon owner, not to enshrine the runtime probe.
- **Edge cases:** Windows/Linux/musl platform-package resolution (`getPlatformPackageName`) must keep working after any host-adapter refactor; `process.report` glibc detection for the gnu/musl split is fragile but out of scope to change here beyond preserving it.
- **Non-goals:** no new public API capabilities; no changes to formula/compute/rendering behavior; no edits to `package.json`, `tsup.config.ts`, `api-extractor.json`, lockfiles, the generated `api-spec.json` content, or the native packages; no edits to `README.md`/`llms.txt` in this `src/`-scoped plan (their drift in evidence #11 is logged for the doc owner as an adjacent follow-up); no test-only or shim solutions; the deprecated `HeadlessEngine` family is not deleted in this plan — it is consolidated/clarified, with removal deferred to a coordinated major version.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable now:** Step 2 (diagnostics dedup), Step 3 (byte fingerprint), Step 4 (lazy/validated spec), Step 7 (barrel reorg) touch disjoint files (`internal/diagnostics.ts`, `node-headless-host.ts`, `api-describe.ts`, `index.ts`) and can proceed concurrently.
- **Serialized:** Step 1 (dispose) should land before Step 6 (path consolidation) so the consolidated factory inherits a correct disposal contract. Step 5 (typed coordinator) precedes Step 6 (which reroutes `CollaborativeEngine`). Step 8 (type dedup) is independent but easiest after Step 6 settles `boot.ts`.
- **Cross-folder dependencies:**
  - Step 1 may require a `Workbook.dispose` signature change in `@mog-sdk/contracts/api` (and downstream consumers) — coordinate with the contracts owner.
  - Step 5's `CoordinatorAddon` interface must match the native NAPI coordinator binding (compute-core-napi / coordinator crate) — coordinate so the TS declaration is authoritative.
  - Step 6 touches the boundary with `@mog/kernel-host-internal` (`createHeadlessDocument`/`importHeadlessDocumentFromXlsx` option shapes) — align the typed options with that package's real signatures.
  - Step 4's schema validation depends on `scripts/generate-api-spec.ts` keeping `api-spec.schema.json` in sync; no edit to the script is required here, but the validation will surface generator drift (a feature, not a coupling to fix in `src/`).
- **No dependency** on the pre-existing dirty paths (api-eval/app-eval scenarios, `dev/fixtures/`, the launch script); this plan does not touch them.
