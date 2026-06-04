Rating: 8/10

Summary judgment

This is a strong plan for `mog/infra/transport/src`. It identifies real production-path mismatches in the current transport boundary: the browser factory ignores `explicitRuntime` and `forbidAutoDetect`, host runtime bindings pass `wasmBaseUrl`, `workerUrl`, and `ipcNamespace` values that transport does not consume, direct WASM and N-API still rely on generated-client object insertion order for positional arguments, and bridge error/metadata contracts are only partially generated. The plan is architecturally aligned with Mog's host-authoritative runtime model and mostly frames the work as a contract problem rather than a local patch set.

The score is not higher because several of the highest-risk parts are still specified as intent rather than as implementable contracts. The plan needs a concrete generated metadata schema, a concrete worker protocol, explicit generator/source-of-truth ownership, and complete verification gates for the Rust codegen side before it is a fully executable spec.

Major strengths

- The production-path diagnosis matches the source. `factory.ts` partially fails closed for explicit node/Tauri/WASM selection, but `factory.browser.ts` currently falls through to Tauri or direct WASM regardless of `explicitRuntime`/`forbidAutoDetect`. The plan correctly treats that as a host contract violation, not an acceptable browser fallback.
- The plan connects transport behavior to upstream host contracts. `kernel/src/document/host-runtime-transport.ts` already models `browser-wasm-worker`, `node-napi`, and `tauri-native`, including asset URLs and IPC namespace, and document lifecycle passes explicit runtime config with `forbidAutoDetect: true`. The plan correctly closes the gap between that public contract and the transport implementation.
- The objectives are systematic. It does not propose fixing one command or one backend; it targets command ordering, serde encoding, byte tuples, case normalization, errors, time injection, traps, and loader lifecycle across all transports.
- The plan preserves the right boundary: `BridgeTransport.call(command, args)` stays small for kernel/generated clients, while transport-specific behavior becomes explicit or generated behind that interface.
- The verification section is materially better than a compile-only plan. It calls for package-local tests, cross-transport equivalence tests, worker tests, loader tests, host integration tests, generated-artifact diff checks, and real UI exercise for browser worker behavior.
- The sequencing and parallelization notes are credible. Metadata generation, transport factory/config, worker backend, init registry, host integration, and verification fixtures are independent enough to split across agents once the config and generated metadata contracts are nailed down.

Major gaps or risks

- The new `TransportConfig` union is not specified precisely enough. The plan lists fields and modes, but it should define the exact discriminants, required fields, forbidden fields, defaults, and compatibility story for existing `createTransport({ wasmInitFns, napiAddon })` callers. Without that, implementers can produce incompatible unions while still claiming to satisfy the plan.
- `browser-wasm-worker` is the largest implementation risk and needs a protocol contract. The plan mentions request ids, structured clone, cancellation/dispose messages, transfer lists, traps, and recreation, but does not define the message envelope, lifecycle state machine, timeout/cancellation semantics, ownership rules for transferred bytes, or how synchronous WASM calls interact with concurrent worker requests.
- Generated command metadata needs a concrete schema. The plan says to emit ordered params, encodings, service target, doc-id policy, result encoding, and recalc markers, but it does not define the TypeScript shape, how it is derived from `TsParam`/bridge annotations, or how edge cases such as `[parse]`, `[bytes]`, nullable primitive serde params, pure addon functions, and lifecycle methods are represented.
- The bridge error generation source of truth is still loose. "Derived from Rust bridge error source or a generated JSON schema" is directionally correct, but a plan at this layer should pick the first implementation contract, name the Rust test/codegen artifact, and define how TS rejects unknown variants versus preserving forward-compatible envelopes.
- The composition pipeline is underspecified around ordering. The plan says to apply time injection, backend invocation, byte-tuple unpacking, JSON/string parsing, camelCase normalization, and error wrapping consistently, but it should state the exact order per backend and the invariants each middleware receives and returns. This matters because N-API currently parses JSON and camelizes internally, while Tauri byte tuple metadata may be packed JSON and WASM returns direct JS values.
- Loader lifecycle objectives are good but need config identity details. "Key the singleton by load configuration" should specify whether the key includes `wasmBaseUrl`, module URL, init feature ids, direct/worker mode, and version/build identity, and whether multiple live direct WASM instances are allowed or rejected.
- The plan spans `infra/rust-bridge/bridge-ts`, `types/host`, `kernel`, `shell`, `runtime`, and transport, but the "source folder and scope" section initially frames adjacent folders as dependencies rather than primary scope. Later steps require editing them. That is acceptable for an integration plan, but the ownership boundary should be made explicit up front.

Contract and verification assessment

The contract direction is excellent: fail-closed host-authoritative runtime selection, generated command metadata instead of `Object.values(args)`, uniform result shape, typed bridge errors, timezone-aware time injection, and trap-specific reset behavior are the right contracts for this package.

The verification gates are strong for TypeScript transport behavior but incomplete for the codegen/Rust side. Because the plan changes `infra/rust-bridge/bridge-ts` and generated artifacts, it should include the relevant Rust/codegen checks, such as the bridge-ts cargo tests that produce metadata, plus clippy if implementation work touches Rust. `pnpm generate:bridge` and a checked diff are necessary but not sufficient for generator correctness.

The plan should also add browser bundle/conditional-export verification. The package currently has separate node and browser entrypoints to keep native addon and Node module imports out of browser graphs. A worker transport and richer config create new opportunities for accidental `node:*`, native addon, or main-thread-only imports in the browser build, so the plan should require a browser build/import smoke test in addition to `@mog/transport build`.

The proposed UI exercise is appropriate because `browser-wasm-worker` is a production browser runtime claim. It should be made more concrete: open a host-backed document configured as `browser-wasm-worker`, verify the worker script is actually used, perform edit/recalc/import/mutation-result/trap-recovery/close, and assert no direct main-thread WASM fallback occurred.

Concrete changes that would raise the rating

- Add the exact `TransportConfig` discriminated union to the plan, including required/forbidden fields for `auto`, `browser-wasm-direct`, `browser-wasm-worker`, `node-napi`, and `tauri-native`.
- Define the generated `COMMAND_METADATA` TypeScript schema and one representative generated entry for a service method, a pure function, a bytes command, a nullable serde primitive, and a lifecycle command.
- Specify the worker protocol envelope: request, response, error, init, dispose, cancel, trap/reset, transfer ownership, and concurrent request ordering.
- Pick the bridge error generation source of truth for the first implementation and name the generated artifact plus parity test.
- State the exact transport composition order and backend-specific preconditions/postconditions.
- Add Rust/codegen verification gates for `infra/rust-bridge/bridge-ts` and a browser conditional-export/bundle smoke gate.
- Split the implementation sequence into contract-first milestones: config/schema/codegen contract, existing direct backend refactor, host adapter integration, worker backend, then cross-transport and UI verification.
