Rating: 8/10

# Review of 070 — infra/transport/src improvement plan


## Summary judgment

This is a strong, evidence-grounded plan for the `@mog/transport` bridge boundary. Its central thesis — that host-authoritative transport selection is a *partial* contract: fail-closed for explicit Node/Tauri/WASM in `factory.ts`, but silently ignored in `factory.browser.ts`, and host binding fields accepted-but-dropped — is independently verifiable in the source and is the single most valuable observation in the document. The plan correctly distinguishes existing machinery (generated `command-metadata.gen.ts`, `RECALC_COMMANDS`, `BYTES_TUPLE_COMMANDS`, time injection, `resetWasmModule`) from genuine gaps (no worker transport, loose `TransportConfig`, `Object.values(args)` ordering, hand-maintained error union). It does not invent problems, and where it proposes new contracts it preserves the one interface kernel consumers depend on (`BridgeTransport.call`). The main reasons it is not a 9–10 are scope ambition (six tracks, A–F, several of which are multi-package efforts) and a couple of objectives that are stated as fresh work but are already partly implemented, which slightly inflates the apparent surface.

## Major strengths

- **Verified problem statements.** I confirmed the key claims against the tree:
  - `factory.browser.ts` (lines 36–56) genuinely ignores `explicitRuntime` and `forbidAutoDetect`; only `factory.ts` honors them (lines 51–79).
  - `TransportConfig` in `types.ts` is exactly the loose optional-field interface described, with `wasmBaseUrl`/`workerUrl`/`ipcNamespace` not even present as fields — yet `host-runtime-transport.ts` constructs a config carrying `wasmBaseUrl`/`workerUrl` that the factory never reads.
  - `napi-transport.ts` builds positional args via `Object.entries(rest)` (line 237) on documented caller-order assumption.
  - `browser-wasm-worker` is a real `RuntimeKind` in `types/host/src/runtime.ts` that maps to `explicitRuntime: 'wasm'` (direct, main-thread) with no worker file anywhere in `infra/transport/src`. Objective 3's "make it truthful or rename" is precisely the right framing.
  - `bridge-error.ts` is a hand-mirrored union with an explicit "Mirror it as a new arm" maintenance comment — confirming the drift risk objective 7 targets.
- **Contract-first decomposition.** The "contracts and invariants to preserve or strengthen" section reads like an interface spec: deterministic runtime selection, uniform result shape across all four backends, `[BRIDGE_ERROR]` envelope preservation through `cause` chains, trap-only `TrapError` classification, timezone-correct time injection. These are testable assertions, not aspirations.
- **Codegen-as-source-of-truth instinct.** Pushing param order, encoding, dispatch target, and error variants into `bridge-ts` generation (rather than hand maps) is the correct architectural direction and matches how the folder already works.
- **Parity-gated deletion.** The requirement to prove generated N-API serde metadata supersedes `DEFAULT_NAPI_SERDE_PARAMS` *before* deleting it (step 3, and the matching test gate) is exactly the discipline that prevents a silent serialization regression.
- **Clean dependency direction** is called out explicitly (`infra/transport` must not depend on `mog-internal`; shared types in `types/host`/`contracts`).

## Major gaps or risks

- **Scope is large for one plan.** Tracks A–F span `bridge-ts`, `infra/transport`, a new worker protocol+bundle, WASM init-registry changes in table/chart consumers, and kernel/shell/runtime adapter integration. This is closer to an epic than a single executable plan. The parallelization section helps, but there is no phasing of *which slice ships first as a standalone safe change*. The most valuable, lowest-risk slice — making `factory.browser.ts` fail-closed and the `TransportConfig` discriminated union — is buried as step 1–2 alongside the much riskier worker rewrite.
- **A few objectives overstate the gap.** `resetWasmModule()` already invokes `__wbindgen_reset()` and clears module + pending promise (`wasm-loader.ts` lines 137–147); objective/step 6's "make reset clear ... wasm-bindgen private cache via `__wbindgen_reset`" is largely done. The genuinely new part is *init-feature tracking* and the late-init re-run (the current `if (wasmModule) return` short-circuit at line 58 is a real bug). The plan would be tighter if it separated "already done" from "to add" here. Similarly, N-API serde indices are *already* generated (`NAPI_SERDE_PARAM_INDICES`); only the `DEFAULT_NAPI_SERDE_PARAMS` fallback and the `Object.values` ordering remain hand-maintained.
- **Bridge-error codegen is the softest leg.** Step 7 proposes generating TS from Rust error definitions but hedges with "if direct AST generation is too broad, emit a Rust-generated JSON fixture." That fallback is sensible, but the plan does not commit to which path, nor specify where the Rust source-of-truth lives, so this track could stall. It should pick the JSON-fixture contract as the default and treat AST generation as a later optimization.
- **Worker transport is under-specified relative to its risk.** The protocol bullets (request ids, transfer lists, dispose/cancel, trap→worker-recreate) are correct but high-level. Buffer-ownership/detachment rules, the structured-clone constraints on `MutationResult` payloads, and what happens to in-flight requests when a worker is recreated after a trap are the parts most likely to produce subtle corruption, and they get one risk bullet each rather than a defined message schema.
- **No migration/back-compat note for existing auto-detect callers.** The plan keeps a "legacy/stateless auto" mode, but does not enumerate current `createTransport()` call sites that rely on the permissive fallback, so the blast radius of tightening `forbidAutoDetect` is asserted, not measured.

## Contract and verification assessment

The verification section is above average. It pairs package-local unit tests (factory fail-closed behavior, metadata coverage parity, cross-transport canonical-output equivalence, worker request-id correlation, loader late-init/reset, error-variant parity) with cross-package gates (`host-no-globals-sentinel`, document-lifecycle, standalone-browser/node host adapters) and a generated-diff gate (`pnpm generate:bridge` + checked diff of `command-metadata.gen.ts`). The cross-transport equivalence test against stub backends is the right way to lock the "same command → same shape" invariant, and the "malformed packed tuple throws contextual `TransportError`" case shows attention to failure paths, not just happy paths.

Weaknesses: the Rust/TS parity gate for bridge errors is described as a goal but its mechanism (where the fixture is emitted, what fails the build) is not pinned down, so it is not yet an enforceable gate. The worker-WASM end-to-end step ("run the dev server and exercise … through the real UI input path") is a manual, non-deterministic gate with no scripted harness — appropriate as a smoke check but not as a regression guarantee for a concurrency-sensitive transport. The plan also lists verification commands it cannot itself run here, which is fine for a plan, but it should mark the manual UI exercise as explicitly non-CI.

## Concrete changes that would raise the rating

1. **Phase the work into shippable slices.** Promote "fail-closed `factory.browser.ts` + `TransportConfig` discriminated union + consume the dropped `wasmBaseUrl`/`workerUrl`/`ipcNamespace` fields" to a self-contained Phase 1 that lands and ships before any worker or codegen work. State the rollback boundary for each phase.
2. **Reconcile objectives against current state.** Explicitly mark what already exists (`__wbindgen_reset`, `NAPI_SERDE_PARAM_INDICES`, `RECALC_COMMANDS`) versus net-new, so reviewers and implementers do not redo solved work. The loader objective should be reframed around init-feature tracking + the `if (wasmModule) return` late-init bug specifically.
3. **Commit to the bridge-error contract.** Choose the Rust-emitted JSON fixture as the canonical source, name the file and the emitting test, and define the exact build-failure condition for the parity gate.
4. **Specify the worker message schema.** Give a concrete typed envelope (request id, command, encoded args, transfer list, result/err discriminant), the buffer-ownership rule (copy-on-caller-owned vs transfer), and the in-flight-request policy on trap-triggered worker recreation.
5. **Measure the auto-detect blast radius.** Enumerate current `createTransport()`/`createComputeBridge()` call sites that depend on permissive fallback and confirm each is either host-backed (must pass explicit config) or intentionally legacy, so tightening `forbidAutoDetect` is grounded in a real inventory.
6. **Add a deterministic worker regression harness** (jsdom/worker stub) so concurrency correctness is CI-gated, leaving the dev-server run as a smoke check only.

---

Reviewer note: assessment based on read-only inspection of `mog/infra/transport/src` (`factory.ts`, `factory.browser.ts`, `types.ts`, `napi-transport.ts`, `wasm-loader.ts`, `bridge-error.ts`, `command-metadata.gen.ts`, `__tests__/`), plus `mog/kernel/src/document/host-runtime-transport.ts` and `mog/types/host/src/runtime.ts`. No files other than this review were modified.
