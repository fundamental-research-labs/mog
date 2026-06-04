# 070 - infra/transport/src improvement plan

## Source folder and scope

Source folder: `mog/infra/transport/src`

This plan covers the private `@mog/transport` TypeScript source package: transport factories, N-API/Tauri/WASM implementations, WASM and N-API loaders, result normalization middleware, bridge error parsing, generated command metadata, and package-local tests.

Adjacent folders are dependencies, not primary scope: `mog/infra/rust-bridge/bridge-ts` for metadata codegen, `mog/infra/rust-bridge/bridge-types` for bridge error envelopes, `mog/kernel/src/document` for host runtime mapping, `mog/types/host` for host runtime contracts, and table/chart WASM initialization packages consumed by the transport loader.

## Current role of this folder in Mog

`infra/transport/src` is the runtime bridge boundary between TypeScript callers and Rust bridge hosts. The kernel and lifecycle systems call the small async `BridgeTransport` interface, while this folder chooses or constructs the concrete backend:

- Node/headless: N-API addon and lazy `ComputeEngine` lifecycle.
- Tauri desktop: `@tauri-apps/api/core` `invoke`.
- Browser/web: `@mog-sdk/wasm` dynamic import and direct WASM function calls.

It also owns cross-host concerns that must be invisible to kernel callers: current-time injection for volatile formulas, byte-tuple unpacking for binary mutation results, snake_case to camelCase result normalization, WASM trap classification, bridge error envelope parsing, N-API addon discovery, and WASM singleton reset after traps.

The production host path already validates a runtime binding in `kernel/host-internal`, maps runtime kinds in `kernel/src/document/host-runtime-transport.ts`, and calls `createTransport` with `explicitRuntime` and `forbidAutoDetect`. The current transport source only partially honors that contract: `factory.ts` is fail-closed for explicit Node/Tauri/WASM selection, but `factory.browser.ts` ignores `explicitRuntime` and `forbidAutoDetect`; host-provided fields like `workerUrl`, `wasmBaseUrl`, `ipcNamespace`, and N-API resolution policy are accepted structurally but not enforced by the transport layer.

## Improvement objectives

1. Make host-authoritative transport selection a typed, fail-closed contract across both node and browser builds. No production host-backed path should fall back to ambient globals or silently ignore transport binding fields.
2. Replace implicit command argument ordering and hand-maintained N-API serde maps with generated command metadata derived from `#[bridge::api]` annotations.
3. Make browser `browser-wasm-worker` mean a real worker-backed WASM transport, or rename/split the runtime contract so the code and host type system describe the same execution model.
4. Canonicalize result, binary tuple, and error behavior uniformly across N-API, Tauri, direct WASM, and worker WASM.
5. Strengthen WASM loader lifecycle so late initialization requirements, trap recovery, asset location, and worker/main-thread loading cannot drift.
6. Keep `BridgeTransport.call(command, args)` small for kernel consumers, but make all transport-specific behavior explicit, generated where possible, and testable at the package boundary.

## Production-path contracts and invariants to preserve or strengthen

- `BridgeTransport.call<T>(command, args)` remains the only interface consumed by generated bridge clients and `ComputeBridge`.
- Host-backed document lifecycle must use explicit runtime bindings and `forbidAutoDetect: true`; ambient detection is only allowed for legacy/stateless construction paths that intentionally ask for it.
- Runtime selection must be deterministic:
  - `browser-wasm-worker` cannot become direct main-thread WASM unless the host contract says so.
  - `node-napi` cannot fall back to WASM when fail-closed host construction is requested.
  - `tauri-native` must route through the Tauri IPC namespace or fail if the host binding is inconsistent.
- Command argument order must come from generated bridge metadata, not `Object.values(args)` as an implicit caller-order contract.
- N-API serde serialization must be complete for every command, including primitive serde params, bytes, nullable params, string enums, pure functions, and doc-scoped service methods.
- All transports must return the same TypeScript shape for the same command: binary data as `Uint8Array`, byte tuples as `[Uint8Array, metadata]`, metadata/result objects in camelCase, and primitive/string returns unchanged.
- Bridge errors must preserve the Rust `[BRIDGE_ERROR]` envelope through `TransportError.cause` chains and expose generated discriminated union types synchronized with Rust variants.
- WASM traps must still become `TrapError` with `isTrap === true`, and non-trap runtime errors must not trigger trap recovery.
- Time injection must use the active session timezone, must happen before every generated recalc-triggering command, and must not read host process timezone on host-backed paths.
- `resetWasmModule()` must invalidate all cached direct-WASM state needed for a fresh instance after a trap.

## Concrete implementation plan

1. Define a first-class transport config contract in `types.ts`.
   - Replace the loose optional-field `TransportConfig` with a discriminated union that covers `auto`, `browser-wasm-direct`, `browser-wasm-worker`, `node-napi`, and `tauri-native`.
   - Keep a deliberate legacy/stateless auto-detect entry for schema helpers and tests, but require host-backed document creation to pass an explicit config.
   - Model `wasmBaseUrl`, `workerUrl`, `ipcNamespace`, N-API addon resolution, worker policy, init features, and `getUserTimezone` as typed fields instead of accepted-but-ignored extras.

2. Make `factory.ts` and `factory.browser.ts` share the same fail-closed runtime selection rules.
   - Add a shared resolver that validates config shape before constructing a backend.
   - In browser builds, reject `explicitRuntime: "napi"` and unsupported host configs with descriptive errors instead of falling through to direct WASM.
   - In node builds, keep auto-detect only for explicit `auto` mode; host-backed configs must either construct the requested backend or throw.
   - Add Tauri namespace handling so `tauri-native` host bindings cannot claim an IPC namespace that the transport ignores.

3. Generate command metadata for argument and return contracts.
   - Extend `bridge-ts` metadata generation beyond `BYTES_TUPLE_COMMANDS`, `NAPI_SERDE_PARAM_INDICES`, `RECALC_COMMANDS`, and security levels.
   - Emit ordered params per command, each with name, transport encoding (`serde`, `str`, `parse`, `prim`, `bytes`), service target (`engine`, `addon`, `tauri`, `wasm`), doc-id policy, result encoding, and recalc/time-injection marker.
   - Update `wasm-transport.ts` and `napi-transport.ts` to build positional args from generated order and encoding metadata.
   - Remove `DEFAULT_NAPI_SERDE_PARAMS` once generated metadata covers every command, with a temporary parity test proving the generated set matches or supersedes the old hand-maintained set before deletion.

4. Build a uniform transport composition pipeline.
   - Create a small `composeTransport` helper that applies time injection, backend invocation, byte-tuple unpacking, JSON/string result parsing where needed, camelCase normalization, and error wrapping in a consistent order.
   - Apply result canonicalization after byte-tuple unpacking for all backends so packed N-API/Tauri metadata cannot leak snake_case.
   - Validate packed byte tuples before reading length prefixes; malformed packed bytes should throw a `TransportError` with command and backend context.
   - Preserve binary buffers without accidental key rewriting or buffer detachment.

5. Implement or explicitly split browser worker WASM.
   - Add a worker transport for `browser-wasm-worker` that uses `workerUrl`, request ids, structured-cloneable messages, cancellation/dispose messages, and transfer lists for large binary payloads.
   - Move WASM initialization from function callbacks to serializable init feature descriptors, backed by a registry that can run in both main-thread direct WASM and the worker bundle.
   - Keep direct WASM as a separate `browser-wasm-direct` mode for local/simple hosts if needed; do not let it masquerade as worker execution.
   - Ensure trap classification and `resetWasmModule` work for both direct and worker-backed WASM. Worker traps should either reset the worker-owned instance or terminate/recreate the worker with the same host config.

6. Fix WASM loader lifecycle.
   - Key the singleton by load configuration where needed: asset base, direct vs worker, and initialized feature set.
   - If `loadWasmModule` is called after the module is already loaded with additional init features, run only the missing initializers against the existing module instead of returning early.
   - Make reset clear module, pending promise, initialized-feature tracking, and wasm-bindgen private cache via `__wbindgen_reset`.
   - Surface asset resolution failures as `TransportError` with backend and phase context.

7. Generate bridge error TypeScript from Rust error definitions.
   - Replace the manually mirrored `BridgeError` union with generated TS derived from the Rust bridge error source or a generated JSON schema emitted by Rust tests/codegen.
   - Keep `parseBridgeError` as the runtime parser, but validate parsed `kind` against generated known variants in tests.
   - Add a Rust/TS parity gate so adding a Rust bridge error variant fails until the TS generated union and tests are updated.

8. Update consumers after the transport contract is explicit.
   - Update `kernel/src/document/host-runtime-transport.ts` and host adapters to pass the typed transport config, not untyped extras.
   - Update `createComputeBridge` call sites to pass serializable init feature ids instead of raw `WasmInitFn` callbacks when using worker-capable browser runtimes.
   - Keep dependency direction clean: `mog/infra/transport` must not depend on `mog-internal`; shared public types should live in `types/host`, `contracts`, or the transport package itself.

## Tests and verification gates

Package-local tests to add or strengthen:

- Factory tests for node and browser builds:
  - explicit runtime honored;
  - `forbidAutoDetect` throws without explicit config;
  - browser build rejects N-API config;
  - `browser-wasm-worker` requires `workerUrl`;
  - unsupported host fields fail instead of being ignored.
- Command metadata tests:
  - every generated bridge command has ordered params;
  - generated N-API serde encoding covers all old `DEFAULT_NAPI_SERDE_PARAMS` entries before that map is removed;
  - commands with bytes, nullable serde params, string enums, and pure addon functions serialize correctly.
- Cross-transport equivalence tests with stub backends:
  - same command/result produces identical canonical output for N-API, Tauri, direct WASM, and worker WASM;
  - byte tuple metadata is camelCase after unpacking;
  - malformed packed tuple data throws a contextual `TransportError`.
- Worker transport tests:
  - request id correlation under concurrent calls;
  - binary transfer behavior without corrupting caller-owned arrays;
  - init, dispose, trap, reset, and worker recreation paths;
  - error and bridge-error envelope propagation through worker messages.
- Loader tests:
  - late init features run after an earlier load;
  - reset clears module, promise, and init-feature tracking;
  - Node WASM fallback still handles file URL bytes.
- Error contract tests:
  - TS generated bridge error variants match Rust-generated fixture;
  - cause-chain parsing still finds inner `[BRIDGE_ERROR]`;
  - known WASM trap messages classify as `TrapError`, unknown `RuntimeError`s do not.
- Host integration tests:
  - `kernel/src/document/__tests__/host-no-globals-sentinel.test.ts` continues proving host-backed runtime mapping does not read globals;
  - document lifecycle host path passes an explicit typed transport config;
  - standalone browser and node headless host adapters pass transport bindings that the transport factory actually consumes.

Verification gates for the eventual implementation:

- `pnpm --filter @mog/transport test`
- `pnpm --filter @mog/transport typecheck`
- `pnpm --filter @mog/transport build`
- `pnpm --filter @mog/kernel test -- host-no-globals-sentinel document-lifecycle-system`
- `pnpm --filter @mog/shell test -- standalone-browser-host create-document-manager`
- `pnpm generate:bridge` followed by a checked diff of `infra/transport/src/command-metadata.gen.ts` and generated bridge error artifacts
- For browser worker behavior, run the dev server and exercise document open, edit, recalc, import, mutation-result, trap-recovery, and close through the real UI input path.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Worker WASM cannot receive function callbacks, so `wasmInitFns` must become serializable init descriptors before `browser-wasm-worker` can be truthful.
- Transfer lists can detach buffers. The worker protocol must define ownership rules and copy when the caller still owns a buffer.
- Some commands are stateless pure functions while others are document-scoped service methods. Generated metadata must preserve dispatch target and doc-id stripping rules exactly.
- Tauri and N-API packed byte tuples can carry metadata shapes that were not previously normalized after unpacking; tests should lock down the desired camelCase contract before changing callers.
- Browser and Node package exports must continue preventing browser bundles from importing `module`, `node:fs`, native addon loaders, or platform packages.
- Existing auto-detect schema helpers may depend on permissive fallback; keep that path explicit as legacy/stateless auto mode rather than accidentally using it for host-backed documents.
- Bridge error generation depends on Rust-side source-of-truth availability. If direct AST generation is too broad for the first implementation, emit a Rust-generated JSON fixture as the narrow contract and generate TS from it.

Non-goals:

- Do not redesign the kernel `BridgeTransport` interface.
- Do not add HTTP service, Python PyO3, or Rust library transports until their runtime packages have production bindings and host contracts.
- Do not change collaboration update transport semantics; this plan is for Rust bridge command transport, not room/provider networking.
- Do not optimize benchmark-only or test-only paths.

## Parallelization notes and dependencies on other folders, if any

This work splits cleanly into parallel tracks once the typed transport config shape is agreed:

- Track A: `infra/rust-bridge/bridge-ts` metadata generation for param order, encodings, dispatch target, result encoding, recalc, and bridge error schema.
- Track B: `infra/transport/src` factory/config refactor and shared composition pipeline.
- Track C: browser worker transport protocol, worker entry bundle, reset/dispose behavior, and binary transfer tests.
- Track D: WASM init registry changes in table/chart initialization consumers so worker and direct modes use serializable init features.
- Track E: kernel/host adapter integration in `kernel/src/document`, `kernel/host-internal`, `shell/src/host-adapters`, and `runtime/spreadsheet-app`.
- Track F: cross-transport verification fixtures and end-to-end browser runtime exercise.

Dependencies:

- Track A must land before removing hand-maintained N-API serde maps or `Object.values(args)` ordering.
- Track D must land before `browser-wasm-worker` can become the default browser host runtime.
- Track B can first enforce fail-closed config for existing direct transports, then wire Track C when the worker backend is ready.
- Track E should wait for the final `TransportConfig` discriminated union but can independently audit every current host binding field for dropped/ignored values.
