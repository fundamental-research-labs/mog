# 059 - Runtime SDK Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/runtime/sdk/src`

Queue item: 59

Scope: the public `@mog-sdk/node` TypeScript source surface, including the package root exports, headless workbook boot orchestration, Node trusted host adapter, SDK-owned kernel facade re-exports, experimental collaboration wrapper, generated API introspection runtime, checked-in generated API spec assets, and Node chart image export integration.

Files and integration points inspected:

- `runtime/sdk/src/index.ts`
- `runtime/sdk/src/boot.ts`
- `runtime/sdk/src/api-describe.ts`
- `runtime/sdk/src/public-kernel-facade.ts`
- `runtime/sdk/src/collaborative-engine.ts`
- `runtime/sdk/src/host-adapters/node-headless-host.ts`
- `runtime/sdk/src/chart-export/node-chart-image-exporter.ts`
- `runtime/sdk/src/generated/api-spec.json`
- `runtime/sdk/src/generated/api-spec.schema.json`
- `runtime/sdk/package.json`
- `runtime/sdk/tsup.config.ts`
- `runtime/sdk/api-extractor.json`
- `runtime/sdk/scripts/generate-api-spec.ts`
- `runtime/sdk/scripts/build-types.mjs`
- `runtime/sdk/scripts/verify-build.mjs`
- `runtime/sdk/__tests__/*`
- `runtime/sdk/etc/node.api.md`
- `runtime/sdk/README.md`
- `runtime/sdk/llms.txt`
- Related kernel/compute test imports of SDK headless helpers found by search

Scope this plan does not cover:

- Rewriting kernel workbook APIs, compute-core, N-API bindings, chart grammar, XLSX import/export internals, or host trust type packages.
- Adding compatibility shims for current accidental exports.
- Moving private/internal planning text into the public `mog` repository.
- Test-only runner improvements that do not exercise the production SDK creation, publish, or runtime paths.

## Current role of this folder in Mog

`runtime/sdk/src` is the Node SDK source for `@mog-sdk/node`. It is the public zero-ceremony headless entrypoint that lets a Node process create a workbook using the same kernel and Rust compute stack as the app, while hiding host context construction, N-API addon resolution, document lifecycle wiring, source handle authorization, and chart raster backend registration.

Observed responsibilities:

- `index.ts` defines the package-root API. It exports `createWorkbook`, several headless/raw boot helpers, `CollaborativeEngine`, kernel utility facades, many contract types, security types, and the API introspection objects `api` and `apiSpec`.
- `boot.ts` implements the overload-heavy `createWorkbook` production path. It normalizes path/buffer/options inputs, defaults headless timezone to `UTC`, creates a host-backed document through `createNodeHeadlessHost`, delegates document creation/import to `@mog/kernel-host-internal`, waits for import durability, registers the Node chart image exporter, wraps workbook disposal/close/asyncDispose, and retains deprecated raw `HeadlessEngine` helpers for N-API/Yrs/collaboration test paths.
- `host-adapters/node-headless-host.ts` builds a branded `TrustedDocumentHostContext` for cooperative local Node automation. It defines session/principal/resource/trust metadata, ephemeral storage handoffs, single-use import source handles, replay protection, capability decisions, transport binding resolution, diagnostics routing, and fail-closed authorization for unsupported management operations.
- `public-kernel-facade.ts` narrows kernel utility/error/event/document factory exports into SDK-owned declaration shapes so package consumers do not import private kernel internals.
- `api-describe.ts` loads `src/generated/api-spec.json` and exposes two introspection forms: string-path `api.describe(...)` and object-tree access through `api.wb`, `api.ws`, and `api.types`.
- `generated/api-spec.json` is a checked-in generated contract. The current artifact reports schema version `1`, 20 workbook sub-APIs, 35 worksheet sub-APIs, 60 interfaces, and 827 referenced types. The generator records rich metadata such as `stableId`, `canonicalPath`, source locations, owner packages, async model, parameter models, normalized return models, alias/deprecation metadata, and type ownership.
- `chart-export/node-chart-image-exporter.ts` serializes production chart marks from the shared chart bridge into a native raster request and returns PNG/JPEG data URLs. It validates mark geometry, style fields, symbol shapes, native result dimensions, and backend availability.
- `collaborative-engine.ts` wraps raw `HeadlessEngine` plus compute coordinator N-API functions for experimental multi-participant sync, locks, structural locks, and shared coordinator groups.

The folder is small, but it sits at a high-leverage boundary: package consumers see it as the public SDK, while internal tests and collaboration code also depend on raw helper exports that the docs call internal.

## Improvement objectives

1. Make the public SDK surface explicit and mechanically enforced. The package root should expose only deliberate stable APIs, and internal/raw N-API helpers should stop leaking as accidental public contract.

2. Make API introspection a first-class contract for agents. `api.describe` and the object tree should preserve the rich generated metadata already present in `api-spec.json`, not just signatures/docstrings/types.

3. Strengthen generated API spec freshness, schema conformance, and drift detection against the source contract packages.

4. Consolidate `createWorkbook` input normalization, host creation, lifecycle disposal, import readiness, logger/debug behavior, and native backend registration into small explicit contracts that can be verified independently and through the production path.

5. Keep the Node trusted host adapter fail-closed and auditable: source handles are single-use, handoff fingerprints are canonical, unsupported management operations are denied, diagnostics are silent by default, and raw bytes do not cross untrusted boundaries.

6. Replace raw collaboration/root export ambiguity with a deliberate internal package boundary or a deliberate unstable public contract. Do not leave `@internal` declarations exported from the stable package root.

7. Treat chart image export as part of the SDK production path, with exhaustive mark serialization and native backend result validation tied to shared chart mark contracts.

8. Keep published declarations self-contained and aligned with `@mog-sdk/contracts` identities without manual post-build cleanup becoming the only line of defense.

## Production-path contracts and invariants to preserve or strengthen

Public package surface:

- `@mog-sdk/node` remains a public Node package with `createWorkbook()` as the primary stable entrypoint.
- `createWorkbook()` overloads must continue to support blank workbook creation, XLSX bytes, file paths, bytes plus import options, file path plus import options, and options bag creation.
- The package root must re-export public workbook/document/security/event/error/utility types from `@mog-sdk/contracts` or SDK-owned facade declarations, not private `@mog/*`, `@rust-bridge/*`, `@mog-sdk/types-*`, or kernel implementation identities.
- API Extractor warnings about exported `@internal` symbols should be treated as contract failures once the intended surface is defined.
- Published ESM and CJS entrypoints must expose the same stable symbols.

Headless workbook creation:

- Production `createWorkbook()` must use the host-backed document path and must fail closed if host-backed creation/import fails.
- The SDK must not fall back to legacy raw construction when host validation, source handles, operation gates, or principal/resource binding fail.
- Node headless sessions must use an explicit user timezone, defaulting to `UTC`; they must not infer user calendar semantics from process timezone.
- Imported workbooks must be fully queryable when `createWorkbook` resolves, including charts/objects/projections that browser hosts may defer.
- Workbook `dispose`, `close`, and `Symbol.asyncDispose` must tear down the workbook handle and host resources idempotently and surface failures through the configured diagnostics path.
- Chart image exporter registration must happen for blank and imported workbooks before consumers call chart export APIs.

Trusted host adapter:

- `node-headless-sdk-host` remains a cooperative local trusted-process adapter, not a security boundary for untrusted code, HTTP clients, plugins, or external agents.
- Import bytes must be wrapped in single-use source handles with issuance, expiry, principal fingerprint, resource-context fingerprint, and expected content identity checks.
- Handoff replay protection must reject duplicate replay keys.
- Ephemeral storage handoffs must keep `rawProviderBytesMayReachUntrustedClient: false`.
- Export authorization must require the kernel's authorized raw snapshot content policy and high-water proof.
- Share/delete/destroy and other management operations stay denied for the Node headless adapter unless a new production host architecture implements them.
- Diagnostics stay silent by default, route warning-worthy host events to `logger.warn`, route other events to `logger.debug`, and only use console under explicit debug gates.

Generated API introspection:

- `runtime/sdk/src/generated/api-spec.json` is the canonical checked-in generated SDK API discovery artifact for agents.
- `schemaVersion` must remain explicit and runtime code must reject unsupported schema versions instead of blindly casting.
- Generated entries must preserve source file/line, owner package, stable ID, canonical path, member kind, visibility, async model, parameters, normalized return type, deprecation metadata, aliases, and transitive type references.
- `api.describe()` and object-tree access must be JSON-serializable and deterministic.
- Reserved object-tree property names must not silently hide API methods; conflicts need an explicit alias or conflict report in the generated spec.
- API docs in `llms.txt` must describe fields that actually exist; stale examples such as `tags` on methods should fail a freshness gate.

Chart export:

- The SDK chart exporter must consume production `IChartBridge.getMarksAtSize`, not a parallel chart path.
- Mark serialization must cover every `ChartMark['type']` and every symbol shape supported by the native raster backend.
- Unsupported mark types, invalid fields, unsupported SVG export, missing native backend, and mismatched native output dimensions must fail explicitly.
- PNG/JPEG output dimensions must match normalized physical size including pixel ratio.

Collaboration/raw boot helpers:

- CRDT/Yrs state bootstrap, compute bridge access, coordinator handles, and raw N-API addon injection are not stable package-root APIs unless deliberately promoted.
- Internal tests that need raw headless helpers should import from an internal workspace path or explicit unstable subpath, not from the stable public root.
- Structural lock helpers must still release locks in `finally`, and coordinator disposal must stay idempotent.

## Concrete implementation plan

1. Define the SDK surface manifest.
   Add a source-owned manifest that lists every intended export from the stable package root with release level, owner module, declaration source, and public rationale. Start with `createWorkbook`, `MogDocumentFactory`, `MogSdkError`, `MogSdkEventFacade`, `Utils`, A1/range helpers, contract type re-exports, security type re-exports, `api`, and `apiSpec`. Treat raw `HeadlessEngine`, `createHeadlessEngine`, `createHeadlessEngineFromYrsState`, `HeadlessCodeExecutorFactory`, `NapiAddonModule`, `CollaborativeEngine`, and `createCollaborativeGroup` as separate internal/unstable surfaces that must not be exported from the stable root by accident.

2. Split stable and internal SDK entrypoints.
   Keep `src/index.ts` as the stable public root and remove internal/raw boot and experimental collaboration exports from it. Add a deliberate internal or unstable source entrypoint only if production monorepo tests need those helpers across package boundaries. That entrypoint should be named and exported in package metadata only with an explicit release-level contract, not hidden inside the stable root.

3. Move kernel/collaboration tests off the stable root.
   Update the dependent kernel and compute tests that currently import raw headless helpers from the SDK module so they consume the internal/unstable entrypoint. Remove fallback code that reaches through `engine.lifecycle.computeBridge`; instead expose the exact internal test port required by those tests. This is a production-boundary fix, not a test shortcut, because it keeps the public package root clean while preserving real N-API/headless integration coverage.

4. Enforce the surface with API Extractor.
   Convert API Extractor warnings for incompatible release tags, forgotten exports, and internal-missing-underscore issues into failing gates for `@mog-sdk/node`. Regenerate `runtime/sdk/etc/node.api.md` after the surface split and treat it as the expected public contract. Add a test that imports built ESM and CJS bundles and asserts the exact stable root export set.

5. Replace local `ApiSpec` runtime types with generated-schema-aligned types.
   Expand `api-describe.ts` types to include the fields already generated by `generate-api-spec.ts`: `schemaVersion`, `stableId`, `canonicalPath`, `root`, `parentRoot`, `interface`, `method`, `kind`, `visibility`, `asyncModel`, `parameters`, `returns`, `typeScript`, `ownership`, `ownerPackage`, `alias`, `deprecation`, and `source`. Keep the older summary shapes as convenience views only where useful.

6. Validate the generated spec at runtime module load.
   Add a lightweight schema-version and structural assertion in `api-describe.ts`. The runtime should reject missing `schemaVersion`, unknown schema versions, missing root interfaces, missing `subApis.workbook`, missing `subApis.worksheet`, or malformed function/type entries before exposing `api`. Do not rely on `rawApiSpec as unknown as ApiSpec` as the only guard.

7. Make `api.describe` preserve metadata.
   Update `OverviewResult`, `InterfaceResult`, `MethodResult`, and `TypeResult` so method results include the canonical generated function entry plus transitive type entries. Provide compact `methods` summaries, but keep source/owner/async/parameter metadata available for agents. Add object-tree nodes that expose metadata fields without losing JSON serializability.

8. Add conflict and reserved-name reporting for object-tree access.
   Generate or compute a `conflicts` section for methods/sub-APIs skipped because they collide with reserved node properties such as `name`, `path`, `methods`, `subApis`, `types`, or `signature`. Fail generation unless each conflict has a deliberate alias. This prevents a future public method from silently disappearing from `api.ws.someMethod`.

9. Add generated spec freshness and schema gates.
   Extend `generate:api-spec` verification so CI/package checks fail when `api-spec.json` or `api-spec.schema.json` is stale. Add a test that runs the generator in check mode, validates the checked-in JSON against the checked-in schema, and confirms the documented counts or a generated summary match the artifact. If a non-deterministic timestamp is desired, keep it out of the checked-in artifact or store deterministic source provenance instead.

10. Align `llms.txt` and README API discovery examples with the generated schema.
    Update examples to reference real fields. Add a docs smoke that imports `api` and verifies every path shown in `llms.txt` and README examples resolves to non-null data with the documented fields. This should run against the source package and built package.

11. Refactor `createWorkbook` into named production phases.
    Split the overload implementation into pure helpers:
    `normalizeCreateWorkbookArgs`, `normalizePrincipalAndSecurity`, `resolveInputSource`, `createNodeHostBackedHandle`, `awaitSdkReadyState`, `registerSdkRuntimeCapabilities`, and `attachWorkbookDisposal`. The public overload behavior should not change; the goal is to make fail-closed behavior and disposal sequencing testable.

12. Remove or formalize the `WorkbookConfig` bypass.
    The README still documents `createWorkbook({ ctx, eventBus })` as a power-user path, while `boot.ts` marks `WorkbookConfig` internal and bypasses the host adapter. Decide the contract explicitly. If it is internal, remove it from docs and the stable root overload path. If it is public, make it a typed stable contract with security/lifecycle implications documented and tested. Do not leave it as an unadvertised bypass that can be mistaken for the primary SDK path.

13. Harden lifecycle disposal semantics.
    Introduce one `SdkWorkbookResource` owner that tracks workbook dispose, handle dispose, host dispose, chart exporter ownership, and external workbook session registration. Make `dispose`, `close('skipSave')`, `close('save')`, and `Symbol.asyncDispose` share this owner so repeated calls cannot double-dispose or leave host resources alive. Add tests for dispose idempotency, async dispose, close-save ordering, and disposal after import failure.

14. Make host adapter contracts inspectable and testable.
    Factor canonical fingerprinting, byte content identity, replay registry, source handle resolver, storage handoff creation, export handoff creation, and diagnostics sink into small helpers in the host adapter folder. Add tests that prove single-use source handles reject mismatched session, source host, issuer host, expiry, principal fingerprint, resource fingerprint, expected content identity, and replay attempts.

15. Tighten native addon resolution.
    Keep public platform packages as optional dependencies, but make `loadNodeSdkNapiAddon` return a typed checked capability set. Validate required compute methods, coordinator methods for the unstable collaboration entrypoint, and `render_chart_marks_image` for chart export. Error messages should include platform/arch/libc and missing capability names.

16. Expand chart mark serialization contracts.
    Convert `SUPPORTED_SYMBOL_SHAPES` and the `serializeMark` switch into an exhaustive type-level contract over `ChartMark`. Add coverage for `path`, `arc`, every text alignment/baseline/style option, gradient/pattern fallback behavior, opacity composition, invalid dash values, invalid finite numbers, empty marks, and native result mismatches. Keep tests using the production chart bridge/exporter path where possible.

17. Make collaboration an explicit unstable subsystem or remove it from the Node SDK root.
    If the collaboration wrapper remains in `runtime/sdk/src`, give it a separate entrypoint with `unstable` naming, a clear release tag, and complete N-API coordinator capability checks. Add tests for manual/batch/immediate sync behavior, coordinator ownership, join failure cleanup, lock conflict reporting, structural lock retry behavior, and disposing partially-created groups. If collaboration belongs elsewhere, move it to the owning collaboration package and leave only the stable SDK workbook surface here.

18. Reduce declaration post-processing fragility.
    Keep `scripts/build-types.mjs` as a validation gate, but move declaration correctness upstream by importing public contract identities directly in source and preventing private imports from entering public declarations. The post-processor should become a final verifier and normalizer, not the only mechanism that hides private type leakage.

19. Add a public consumer matrix.
    Extend `verify-build.mjs` or add a focused test that compiles representative ESM and CJS consumers using the built package, including `createWorkbook`, contract type imports, `api.describe`, `MogDocumentFactory`, `Utils`, security types, and chart export types. It should also assert internal/unstable helpers are unavailable from the stable root.

20. Align docs and package exports after implementation.
    After the source contract is clean, update README, `llms.txt`, API report, package exports, and publish verification together. Public docs must not advertise raw compute bridge access or `ctx/eventBus` bypass unless those are intentionally stable production APIs.

## Tests and verification gates

Required gates for the implementation work:

- `pnpm --filter @mog-sdk/node test`
- `pnpm --filter @mog-sdk/node typecheck`
- `pnpm --filter @mog-sdk/node build`
- `pnpm --filter @mog-sdk/node api-report`
- `pnpm --filter @mog-sdk/node verify-build`
- `pnpm --filter @mog-sdk/node smoke-test`
- `pnpm --filter @mog-sdk/node verify-publish`
- `pnpm typecheck` after SDK export/type changes, unless a narrower package-wide type contract is explicitly selected for that workstream and documented.

Behavior and contract tests to add or strengthen:

- Stable root export-set test for source, built ESM, and built CJS.
- API Extractor gate that fails on leaked `@internal` package-root symbols and incompatible release tags.
- Generated API spec freshness test comparing checked-in `api-spec.json` and schema against generator output.
- API spec schema validation test and runtime load validation test.
- `api.describe` tests for overview, root interface, sub-API, root method, sub-API method, type lookup, transitive type expansion, source metadata, owner metadata, async model, parameters, and reserved-name conflicts.
- README/`llms.txt` path smoke tests for all documented `api.describe(...)` examples.
- `createWorkbook` overload tests for blank, bytes, file path, bytes plus import options, file path plus import options, options bag, principal shorthand, security resolver, logger false, and debug env behavior.
- Host adapter authorization tests for create/open/import/export allow paths and management-operation deny paths.
- Source handle resolver rejection tests for every fingerprint/session/identity/expiry/single-use mismatch.
- Disposal tests for dispose/close/asyncDispose idempotency, import failure cleanup, and chart exporter registration before use.
- Native addon resolution tests for unsupported platform, missing optional package, and missing required native capabilities.
- Production chart export tests for created charts, imported charts, PNG/JPEG dimensions, unsupported SVG, missing backend, invalid marks, and native output mismatches.
- Unstable collaboration tests if retained: coordinator capability check, join cleanup on failure, sync modes, structural lock retries, lock release in `finally`, shared group disposal, and no stable-root export leakage.

Release-readiness gates when publishing behavior changes:

- Install-package smoke in a temporary consumer project using the packed `@mog-sdk/node` tarball.
- ESM and CJS runtime smoke from outside the monorepo workspace symlink layout.
- Native-platform package matrix smoke for the supported optional dependency names where artifacts are available.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Cleaning the public root will break tests or internal tools that rely on accidental exports. The fix is to move those imports to a deliberate internal/unstable entrypoint, not keep the accidental root contract.
- API spec metadata is large. Runtime validation should be linear and cheap, and object-tree nodes should stay lazy where that preserves startup cost.
- Generated docs and `llms.txt` can drift from source unless examples are tested against the actual `api` object.
- `api-describe.ts` currently skips reserved-name collisions silently. Future contract additions can disappear from object-tree access unless conflict detection becomes a generator/runtime gate.
- `createWorkbook` disposal wraps methods on a workbook object owned by kernel. Refactoring must preserve kernel method semantics while preventing double cleanup and unhandled async disposal failures.
- Import durability waiting is required for headless readiness. Tests must catch any refactor that resolves before imported charts, objects, or sheet projections are ready.
- Source handle fingerprinting currently canonicalizes bytes by converting to arrays, which can be expensive for large imports. Any optimization must preserve canonical content identity and source-handle rejection semantics.
- Optional native package resolution must distinguish unsupported platform, missing package, and missing native capability so failures are actionable without leaking private paths.
- Collaboration uses raw coordinator N-API functions and manual touched-sheet tracking. If promoted, it needs a real contract; if not, stable consumers should never see it.

Non-goals:

- Do not replace the production host-backed `createWorkbook` path with legacy raw headless construction.
- Do not add compatibility shims that keep internal helpers on the stable package root after the surface contract is cleaned.
- Do not make the public `mog` repo depend on `mog-internal`.
- Do not create a second chart rendering path for SDK tests.
- Do not weaken source-handle, replay, handoff, or export authorization checks for ergonomics.
- Do not hide stale generated API spec artifacts by generating them only at runtime.
- Do not optimize test-only runners or mocks instead of the built `@mog-sdk/node` package and real Node headless path.

## Parallelization notes and dependencies on other folders, if any

Parallelization:

- Agent A: Define the stable/unstable SDK export manifest, split `index.ts`, update package exports if needed, and regenerate the API report.
- Agent B: Update internal kernel/compute tests and any monorepo callers to import raw headless/collaboration helpers from the deliberate internal or unstable entrypoint.
- Agent C: Upgrade generated API spec runtime types, validation, `api.describe`, object-tree metadata, conflict detection, and tests.
- Agent D: Add generator freshness/schema/docs smoke gates for `api-spec.json`, `api-spec.schema.json`, README, and `llms.txt`.
- Agent E: Refactor `createWorkbook` phases and add overload/lifecycle/disposal/import-readiness tests.
- Agent F: Harden the Node trusted host adapter helper contracts and add source-handle/authorization/replay tests.
- Agent G: Expand native addon capability checks and chart image exporter serialization/backend tests.
- Agent H: Decide and implement the collaboration boundary, either as an unstable entrypoint with full tests or as a move to a better-owning package.

Dependencies:

- `mog/contracts/src` and `mog/types/*/src` own the public API/type contracts that feed SDK exports and generated API spec entries.
- `mog/kernel/src/api`, `mog/kernel/src/api/document`, and `mog/kernel/src/document` own `Workbook`, `Worksheet`, document lifecycle, host-backed document handles, and import durability.
- `mog/kernel/src/host-lifecycle-internal` and `@mog/kernel-host-internal` own the trusted host-backed creation/import functions used by `createWorkbook`.
- `mog/types-host/src` owns trusted host, runtime, bindings, authorization, diagnostics, identity, trust, and capability contracts consumed by the Node host adapter.
- `mog/compute/napi` and native optional platform packages own the N-API addon capabilities loaded by the SDK.
- `mog/compute/core/crates/compute-coordinator` owns coordinator functions consumed by `collaborative-engine.ts`.
- `mog/charts/src` and `mog/contracts/src/bridges` own chart mark contracts and chart bridge behavior consumed by the Node chart exporter.
- `mog/file-io/xlsx` and kernel export paths own `Workbook.toXlsx`, import readiness, and chart roundtrip behavior that the SDK must expose without bypassing production code.
- `mog/runtime/sdk/scripts` owns generation, build, declaration, API report, publish, and consumer-smoke verification that must become the enforcement layer for this folder's contracts.
