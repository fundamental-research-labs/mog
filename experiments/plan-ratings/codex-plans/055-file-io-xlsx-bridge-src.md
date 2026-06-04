# 055 - XLSX Bridge Source Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/file-io/xlsx/bridge/src`

Queue item: 55

Scope: the workspace-internal TypeScript package source for `@mog/xlsx-parser`: exported XLSX bridge types, progress/cancellation helpers, worker message protocol, worker runtime, and small compatibility helpers under `src/xlsx-parser`.

Files and integration points inspected:

- `file-io/xlsx/bridge/src/index.ts`
- `file-io/xlsx/bridge/src/types.ts`
- `file-io/xlsx/bridge/src/progress.ts`
- `file-io/xlsx/bridge/src/mog-sdk-wasm.d.ts`
- `file-io/xlsx/bridge/src/worker/index.ts`
- `file-io/xlsx/bridge/src/worker/types.ts`
- `file-io/xlsx/bridge/src/worker/parse-worker.ts`
- `file-io/xlsx/bridge/src/xlsx-parser/core.ts`
- `file-io/xlsx/bridge/src/xlsx-parser/data-validation.ts`
- `file-io/xlsx/bridge/package.json`
- `file-io/xlsx/bridge/tsconfig.json`
- `file-io/xlsx-api/src/bridge.rs`
- `file-io/xlsx-api/src/parse.rs`
- `file-io/xlsx-api/src/options.rs`
- `compute/wasm/src/lib.rs`
- `infra/transport/src/command-metadata.gen.ts`
- `infra/rust-bridge/bridge-ts/generated/xlsx-types.ts`
- `kernel/src/document/document-lifecycle-system.ts`
- `kernel/src/bridges/compute/compute-bridge.gen.ts`
- `file-io/xlsx/tooling/tests/cancellation.test.ts`
- `docs/architecture/os/packages.md`

Out of scope for this folder:

- Rewriting the Rust XLSX parser internals in `file-io/xlsx/parser/src`.
- Replacing the production workbook hydration path in `compute_import_from_xlsx_bytes_deferred`.
- Adding browser-only mock parse paths or test-only parser adapters.
- Treating generated `dist/` files as source of truth.
- Reintroducing the removed Rust `FullParseResult` bridge output unless the production contract explicitly requires it and exposes it from `xlsx-api` as a generated command.

## Current role of this folder in Mog

`file-io/xlsx/bridge/src` is intended to be the browser/TypeScript bridge around the Rust XLSX parser and the merged `@mog-sdk/wasm` module. The package is workspace-internal and documented as `@mog/xlsx-parser`, with responsibility for TypeScript types, progress/cancellation helpers, and worker orchestration.

Observed current state:

- `src/index.ts` re-exports a large local `types.ts` surface, progress utilities, and worker helpers.
- `src/types.ts` mixes generated aliases from `@mog/bridge-ts/generated/xlsx-types` with a large hand-maintained mirror of old full-parse workbook shapes and parse options.
- `src/worker/parse-worker.ts` imports `@mog-sdk/wasm`, expects `xlsx_parse_full`, and advertises `xlsx_version`.
- `xlsx-api/src/bridge.rs` currently exposes only `xlsx_parse_lazy`, `xlsx_parse_lazy_with_mode`, and `xlsx_version`; comments state `parse_full` and `parse_full_profiled` were removed and full parse consumers should use domain-typed `ParseOutput`.
- `infra/transport/src/command-metadata.gen.ts` confirms only the lazy XLSX commands plus version are present in the generated bridge surface.
- Production workbook import in the app lifecycle already routes XLSX bytes through `computeBridge.importFromXlsxBytesDeferred(xlsxBytes)`, which calls `compute_import_from_xlsx_bytes_deferred` and hydrates the Rust engine directly.
- `package.json` exports `.` plus `./progress`, `./types`, `./worker/types`, and helper modules, but it does not export the documented `./worker` or `./worker/parse-worker` entrypoints.
- `worker/index.ts` documents imports from `@mog/xlsx-parser/worker`, but that subpath is not exported.
- The only observed direct test coverage for this package is indirect tooling coverage of progress helpers and worker message type guards; there are no package-local behavior tests for worker creation, command availability, option mapping, or package exports.
- `parse-worker.ts` contains both worker-thread top-level initialization and main-thread `createWorkerParser` client code, so importing the client couples callers to worker-runtime side effects and environment detection.

The architectural issue is not lack of implementation volume. The bridge's public TypeScript surface is stale relative to the current Rust/generated command surface and current production import path. The improvement should make the bridge a verifiable facade over the real generated commands, and it should only expose full import behavior through the same production hydration contract used by the app.

## Improvement objectives

1. Align the TypeScript bridge with the current generated XLSX command surface: `xlsx_parse_lazy`, `xlsx_parse_lazy_with_mode`, and `xlsx_version`.

2. Remove or replace stale `xlsx_parse_full` assumptions. If browser full import belongs in this package, define and implement a production Rust/compute command that returns domain import state or performs engine hydration directly; do not revive an obsolete JSON full-parse shape as a local TypeScript fiction.

3. Make generated Rust bridge types the source of truth for command outputs. Keep local TypeScript types only for intentional public aliases, worker protocol envelopes, progress events, and adapters that the package owns.

4. Split worker runtime from main-thread worker client code so importing `createWorkerParser` has no worker-side top-level effects.

5. Make package exports match documented and intended subpaths, or update documentation and tests to match the actual exports. No documented import path should be unresolvable.

6. Replace untyped dynamic WASM access and `@ts-ignore`/`@ts-expect-error` command lookup with an explicit `XlsxWasmModule` contract derived from generated bridge names.

7. Make parse options honest. Unsupported options must be absent from the bridge API or rejected before crossing the WASM boundary; they must not be silently passed to commands that ignore them.

8. Make progress and cancellation reflect the real production semantics. For synchronous WASM commands, cancellation is pre/post-call only unless the Rust bridge grows cooperative cancellation. Do not fabricate fine-grained parser progress.

9. Add package-local tests that verify the production command contract, export map, worker protocol, and progress/cancellation utilities.

10. Keep the bridge workspace-internal and public-repo-only. It must not depend on `mog-internal`, and it must not duplicate compute/kernel ownership.

## Production-path contracts and invariants to preserve or strengthen

Package boundary:

- `@mog/xlsx-parser` remains workspace-internal and `private: true`.
- The package may depend on public Mog packages and generated bridge types, but `mog` must not depend on `mog-internal`.
- Source files under `src/` are authoritative; generated `dist/` output is not hand-edited.
- The package must remain compatible with the merged `@mog-sdk/wasm` module used by compute WASM.

Command surface:

- The TypeScript bridge must only call XLSX commands that exist in the generated WASM/NAPI/Tauri bridge surface.
- Current generated XLSX commands are `xlsx_parse_lazy`, `xlsx_parse_lazy_with_mode`, and `xlsx_version`.
- Any future full import command must be added at the Rust bridge descriptor layer first, regenerated through bridge tooling, and then consumed by this TypeScript package.
- A command-name drift between Rust descriptors, generated metadata, ambient TS declarations, and bridge client tests must fail verification.

Production import ownership:

- Full workbook hydration for the spreadsheet app remains `compute_import_from_xlsx_bytes_deferred` through `ComputeBridge.importFromXlsxBytesDeferred`.
- The bridge package must not introduce a parallel JSON import path that bypasses Rust engine hydration, mutation result propagation, identity formula conversion, or deferred hydration state.
- If a browser-facing full import helper is added, it should delegate to the same compute transport/import path or to a new Rust command that produces the same domain state contract.

Type contracts:

- Generated Rust bridge outputs from `@mog/bridge-ts/generated/xlsx-types` are the source of truth where they correspond to actual commands.
- Hand-maintained interfaces in `types.ts` must not claim to mirror Rust output unless a type-level assertion proves structural compatibility against generated types.
- Local helper types such as `ParseProgress`, worker envelopes, and public aliases can stay local because the TypeScript bridge owns those.
- `CellRange`, `FullParseOptions`, and other locally mirrored shapes must either become generated/domain aliases or be marked as local adapter inputs with tested mapping rules.

Worker lifecycle:

- Main-thread client imports must not execute worker initialization.
- Worker runtime imports must not instantiate a worker client.
- `ready` resolves exactly once per worker and rejects on initialization timeout or fatal worker error.
- Every request id is unique and cleaned from `pendingRequests` on success, error, cancellation, termination, and worker-level failure.
- Transferred `ArrayBuffer` ownership must be explicit in API docs and tests because caller buffers are neutered after posting.
- `terminate()` aborts active operations, rejects pending promises deterministically, posts termination only when the worker is alive, and releases event handlers.

Progress and cancellation:

- Progress percentages are monotonic per operation and never exceed 100.
- `complete` progress is delivered even when throttling is enabled.
- Cancellation before WASM load or before command start returns `cancelled`/`AbortError`.
- Cancellation during a synchronous WASM command is documented and tested as best-effort unless the Rust parser grows cooperative checkpoints.
- Progress messages must be correlated to the originating request id.

Error handling:

- Errors from Rust bridge commands must preserve command error category, user-safe message, request id, and stack where available.
- Encrypted XLSX and invalid ZIP cases exposed by `xlsx-api` lazy parsing must map to deterministic TypeScript errors or explicit `ok: false` result objects, matching Rust output.
- Unsupported parse options are rejected as a bridge contract error before command execution.

Bundling and environment:

- Browser workers use ESM workers with `new Worker(url, { type: 'module' })`.
- Node worker support is optional only if explicitly tested; otherwise do not advertise it as a supported production contract.
- Avoid dynamic `require('worker_threads')` in browser-bundled modules unless it is isolated behind a Node-only entrypoint.
- Runtime capability detection should report WASM support, SIMD support, SharedArrayBuffer support, and command availability separately.

## Concrete implementation plan

### 1. Define the bridge surface contract

Create a small source-owned contract module, for example `src/wasm-contract.ts`, that defines the actual XLSX command surface available from `@mog-sdk/wasm`:

- `xlsx_parse_lazy(data: Uint8Array): BridgeLazyParseResult`
- `xlsx_parse_lazy_with_mode(data: Uint8Array, mode: number): BridgeLazyParseResultWithErrors`
- `xlsx_version(): string`
- `default?: () => Promise<void>`

Import output types from `@mog/bridge-ts/generated/xlsx-types` or generated xlsx-api bridge aliases where available. If bridge-ts does not generate `BridgeLazyParseResult` aliases in the current generated file, add them through the Rust bridge type generation path rather than creating another disconnected mirror.

Add runtime guards:

- `assertXlsxWasmModule(value): XlsxWasmModule`
- `assertCommandAvailable(module, commandName)`
- `parseModeToBridgeCode(mode): 0 | 1 | 2`
- `unsupportedOptionNames(options): string[]`

This removes all `@ts-ignore` and dynamic unverified command lookups in production code.

### 2. Reclassify `types.ts` into generated aliases plus local bridge types

Refactor `src/types.ts` into three layers:

- Generated aliases for actual Rust bridge outputs.
- Local public aliases intentionally preserved for callers.
- Local adapter/input types for TypeScript-only behavior.

The stale large full-parse mirror should not remain as the default exported production parse result unless the Rust bridge again exposes that exact command. Options:

- Preferred current-state outcome: replace `FullParseResult`, `FullParsedSheet`, and `FullParseOptions` exports with actual generated/domain aliases only where command-backed, and expose lazy parse result types as the package's command-backed result.
- If full browser parse is required by product owners: add a new Rust bridge command in `xlsx-api` or compute that returns a domain-owned import contract, regenerate bridge-ts, and then expose that generated shape. Do not make the TypeScript package synthesize `FullParseResult`.

Add compile-time structural assertions for intentionally duplicated helper shapes. For example, if `CellRange` must remain local, assert it is assignable to the canonical contracts shape or generated domain shape expected by consumers.

### 3. Split worker runtime from client API

Move main-thread client code out of `src/worker/parse-worker.ts` into a dedicated client module, for example:

- `src/worker/client.ts`: exports `createWorkerParser`.
- `src/worker/runtime.ts`: owns worker-global initialization, message listener, and command execution.
- `src/worker/index.ts`: re-exports client API and protocol types.
- `src/worker/parse-worker.ts`: either becomes a tiny runtime entrypoint that imports `./runtime`, or is renamed/kept as the worker bundle entrypoint.

The runtime entrypoint should have the only top-level worker side effects. The client module should be import-safe in a normal browser main thread, test runner, and bundler.

### 4. Replace full-parse worker behavior with command-backed lazy behavior or production full import delegation

Current `executeParse` calls `xlsx_parse_full`, which is not in the generated command metadata. Replace this with one of two explicit production contracts:

- Lazy metadata worker: worker request type becomes `parseLazy`, calls `xlsx_parse_lazy` or `xlsx_parse_lazy_with_mode`, and returns sheet count, sheet names, warning/error counts, and errors JSON. This is appropriate for file previews, validation, and capability checks.
- Full import worker: if the app needs a browser worker wrapper around full import, the request delegates to compute's production `compute_import_from_xlsx_bytes_deferred` path or to a new Rust bridge command that is added to `xlsx-api`, code-generated, and tested. This command should use domain `ParseOutput`/engine hydration semantics, not the old internal `FullParseResult` JSON surface.

Do not keep a method named `parse` that claims to return `FullParseResult` unless it is backed by a real generated command and used in production. Use names that describe the actual contract, such as `parseLazy`, `inspectWorkbook`, or `importIntoDocument`.

### 5. Make options explicit and validated

Replace broad `WorkerParseOptions extends Omit<FullParseOptions, 'onProgress'>` with command-specific option types:

- `LazyParseOptions`: mode and progress reporting flags only.
- `FullImportOptions`: only if a production full import command is added; map to supported Rust `ParseOptions` fields and reject unsupported options.

Mirror `xlsx-api/src/options.rs` honestly:

- `mode` is supported for lazy parse with mode.
- `maxCells`, `skipStyles`, `skipCharts`, `skipDrawings`, `skipComments`, `skipDataValidation`, `skipConditionalFormatting`, `sheetFilter`, and `valuesOnly` are not currently enforced by `xlsx-api::parse_with_options`; they should not be silently exposed as effective browser options.
- `maxSheets` is a real parse API option in Rust but is not currently part of the lazy bridge; only expose it if a command exists.

### 6. Correct package exports and docs

Update package exports in a future implementation so source and docs agree:

- Add `./worker` if `worker/index.ts` is intended to be imported.
- Add `./worker/parse-worker` or a clearer `./worker/runtime` entry if bundlers need a worker URL target.
- Keep `./worker/types`.
- Keep `./progress`, `./types`, and helper subpaths if they have real consumers.

Add an export-map test that imports each documented subpath through the package name, not via relative paths.

### 7. Strengthen worker protocol and cleanup behavior

Update protocol types to be command-specific and lifecycle-complete:

- Add explicit request and response variants for ready, lazy parse success, error, cancelled, terminated, and capability failure.
- Include `requestId` or `id` consistently across inbound and outbound messages.
- Add a worker-level error event that rejects all pending requests and the ready promise.
- Add init timeout handling in `createWorkerParser` using `WorkerParserOptions.initTimeoutMs`.
- Ensure `cancel()` is idempotent and does not leave pending promises forever.
- Ensure `terminate()` rejects pending requests with a deterministic termination error and clears maps.

### 8. Make progress real

For current lazy parse commands, progress should be lifecycle progress only:

- `init`
- `wasmLoad`
- `parse`
- `complete`

Do not report ZIP/XML/cells/styles/features percentages unless the Rust command can emit those phases. Keep `ProgressTracker` as a generic utility, but make worker progress use a command-backed phase model.

If fine-grained progress is required, add cooperative progress checkpoints in the Rust XLSX parser/bridge and expose them through a streaming or async worker protocol. That work belongs across `file-io/xlsx/parser`, `file-io/xlsx-api`, and this bridge, not as fake TypeScript percentages.

### 9. Add package-local tests

Add tests inside `file-io/xlsx/bridge/src/__tests__` or `file-io/xlsx/bridge/tests` for:

- Export map resolution for every documented package subpath.
- `wasm-contract` command guards and parse mode mapping.
- Unsupported option rejection.
- Progress monotonicity, throttling, completion delivery, and cancellation helpers.
- Worker message type guards and error message mapping.
- `createWorkerParser` behavior with a fake Worker implementation: ready, success, progress routing, cancellation, worker error, terminate, timeout, and pending cleanup.
- Worker runtime command dispatch with an injectable fake `XlsxWasmModule`.
- Buffer transfer policy: posted parse requests transfer the provided `ArrayBuffer` only when the API documents ownership transfer.

Keep tests package-local rather than relying on `file-io/xlsx/tooling/tests/cancellation.test.ts` as the only coverage.

### 10. Coordinate Rust bridge work only if full browser import is required

If the desired production outcome is browser full XLSX import through this package, implement that as a cross-folder feature:

- Add a Rust bridge command in `file-io/xlsx-api/src/bridge.rs` or use an existing compute command that performs engine hydration.
- Prefer returning a domain import report or mutation result over exposing parser-internal `FullParseResult`.
- Regenerate bridge-ts outputs and transport metadata.
- Update `compute/wasm/src/lib.rs` descriptors if needed.
- Add Rust tests in `xlsx-api` and compute for invalid ZIP, encrypted file, unsupported options, large workbook, import diagnostics, and roundtrip through `ParseOutput`.
- Then wire the TypeScript bridge to the generated command.

This is a dependency, not a workaround. The TypeScript bridge should not invent a full parse contract before the Rust production contract exists.

## Tests and verification gates

For a TypeScript-only bridge cleanup:

- `pnpm --filter @mog/xlsx-parser typecheck`
- `pnpm --filter @mog/xlsx-parser test` after adding a package-local test script
- `pnpm --filter @mog/xlsx-tooling typecheck` because tooling imports `@mog/xlsx-parser` progress and worker types
- `pnpm typecheck` from the public `mog` repo unless the implementation is intentionally scoped to a narrower explicit type gate

For worker/browser behavior:

- Run the package-local worker tests with a fake Worker.
- Run a real browser/Vite smoke that imports `@mog/xlsx-parser/worker`, creates an ESM worker from the runtime entrypoint, calls the command-backed XLSX operation on a small valid XLSX, and verifies ready/success/error cleanup.
- If the spreadsheet app import path changes, run the dev server and open/import an XLSX through the real UI file input path.

For Rust command-surface changes:

- Regenerate bridge outputs using the repo's bridge generation workflow.
- `cargo test -p xlsx-api`
- `cargo clippy -p xlsx-api`
- `cargo test -p xlsx-parser`
- `cargo clippy -p xlsx-parser`
- `cargo test -p compute-core` if full import/hydration behavior changes.
- `pnpm --filter @mog/xlsx-parser-wasm run gate:check:smoke` for the XLSX parser package when WASM parser behavior changes.

For production XLSX import/hydration changes:

- Run focused compute deferred import tests under `compute/core/src/storage/engine/tests/test_deferred_xlsx_import`.
- Run roundtrip tests that parse/export/reparse through `ParseOutput`, including styles, comments, data validation, conditional formatting, tables, charts, slicers/timelines, external links, workbook metadata, and encrypted/invalid package rejection.
- Exercise the app lifecycle path that calls `computeBridge.importFromXlsxBytesDeferred` with real XLSX bytes.

## Risks, edge cases, and non-goals

Risks:

- Removing stale full-parse TypeScript exports can expose downstream code that was compiling against an unbacked contract. That is useful signal; fix consumers to the production command surface rather than adding shims.
- `@mog-sdk/wasm` initialization can be bundler-sensitive. Keep initialization isolated and tested in the worker runtime entrypoint.
- Transferring an `ArrayBuffer` to a worker detaches it from the caller. APIs that transfer ownership must document that and tests must cover it.
- Synchronous WASM parser calls cannot be cancelled mid-call from TypeScript. Treat mid-parse cancellation as a Rust bridge/parser feature if needed.
- Generated xlsx types can contain parser-internal shapes that are not exposed by any command. The package must not export them as active command results unless a command returns them.
- Node worker support is currently advertised in comments but not proven by package-local tests. Either test it as a real contract or remove it from the supported surface.

Edge cases to cover:

- Empty XLSX bytes.
- Non-ZIP bytes.
- Encrypted Office packages.
- Valid ZIP without workbook parts.
- Large workbook bytes that make buffer transfer and memory behavior visible.
- Multiple concurrent worker requests and cancellation of one request while another completes.
- Worker ready failure when WASM init fails.
- Duplicate or unknown worker messages.
- Progress callback throwing.
- `initTimeoutMs` elapsing before ready.
- Calling `cancel()` after success, after error, and after termination.

Non-goals:

- Do not optimize benchmark harnesses or test-only paths.
- Do not introduce a JavaScript XLSX parser fallback.
- Do not add compatibility wrappers around removed `xlsx_parse_full`.
- Do not move workbook hydration ownership out of compute/kernel.
- Do not hand-edit generated `dist/`, bridge metadata, or generated type files outside the proper generation workflow.
- Do not broaden this package into a public SDK package without a separate package-boundary plan.

## Parallelization notes and dependencies on other folders, if any

The work parallelizes cleanly once the command contract is decided:

- Agent A: audit and update Rust/generated XLSX bridge command contracts in `file-io/xlsx-api`, `compute/wasm`, `infra/rust-bridge/bridge-ts`, and generated metadata if full browser import is required.
- Agent B: refactor `file-io/xlsx/bridge/src` into generated aliases, explicit WASM contract, command-specific options, and split worker client/runtime modules.
- Agent C: add package-local TypeScript tests for exports, worker protocol, progress/cancellation, and command guards.
- Agent D: verify production app/import integration through `kernel/src/document/document-lifecycle-system.ts` and `kernel/src/bridges/compute`, only if bridge changes touch full import behavior.

Dependencies:

- No dependency on `mog-internal`; this plan file lives there, but implementation must happen in public `mog`.
- Full browser import through this bridge depends on a real Rust/compute production command. Without that, the correct package contract is lazy metadata/capability parsing plus progress utilities.
- Package export changes depend on `file-io/xlsx/bridge/package.json`.
- Type-source cleanup depends on bridge-ts generated output and may require regeneration if Rust bridge output aliases are missing.
- App-level UI verification is required only if the implementation changes the real spreadsheet file-open/import path.
