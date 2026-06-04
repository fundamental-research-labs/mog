Rating: 7/10

Summary judgment

This is a strong, production-oriented plan with the right primary target: the duplicated descriptor lists in `compute/wasm/src/lib.rs` and `compute/napi/src/lib.rs` are a real boundary risk, and the plan correctly treats generated symbol stability as the contract. It is not yet implementation-ready because the anchor change hides important macro/generator design work, misses at least one real descriptor consumer, and leaves the panic-marker recovery path under-specified.

Major strengths

- The plan is grounded in the actual browser binding role: `wasm_start`, descriptor imports, and `bridge_wasm::generate!` are the only hand-written WASM source surface.
- It correctly prioritizes production-path drift between generated WASM exports and the sibling runtime binding, and ties that to the documented `Unknown WASM function` incident.
- The contract section is unusually clear about symbol-name stability, no timestamp/clock access in WASM init, and trap recovery ownership staying in JS rather than Rust.
- The proposed verification gates are aimed at real artifacts: generated `.d.ts`, app-eval load behavior, and trap-classifier coverage rather than mock-only checks.
- The non-goals are useful. Calling out NAPI-only chart rendering and coordinator handles prevents false parity work.

Major gaps or risks

- The evidence claim that only WASM and NAPI consume `__bridge_descriptor_ComputeService_*` is false in the current tree. `compute/pyo3/src/lib.rs` also maintains a descriptor list, with intentional omissions. A single-source manifest plan must include PyO3 or explicitly define why it is a different platform manifest with checked exceptions.
- The manifest macro design is not specified enough for implementation. Today `bridge_wasm::generate!` accepts `$(desc:path),+`, and `bridge_napi::__generate_class` parses descriptor `syn::Path`s. A `for_each_*` manifest cannot simply drop into those call sites without changing wrapper macro APIs or adding new generator entrypoints.
- The plan says the manifest can be emitted by the same codegen pass that emits descriptor groups, but `#[bridge::api]` runs per impl block and the stateless bridge groups are separate impls. Aggregating across those groups needs a concrete mechanism, likely in `bridge_delegate` for `ComputeService` and a different explicit or generated manifest for `bridge_pure`.
- Phase 1 is framed as the anchor for a `compute/wasm/src` plan, but it requires coordinated edits in `compute/api`, `compute/core`, `infra/rust-bridge`, `compute/napi`, and likely `compute/pyo3`. That cross-folder dependency is acknowledged, but the file-local deliverable is downstream and cannot retire the risk by itself.
- The panic marker contract has no observable delivery path to `wasm-transport.ts`. A `console.error("[mog-wasm-panic] ...")` marker is useful for humans, but the catch branch receives only the thrown error object. The plan needs a machine-readable channel such as a global last-panic export, an event, or an error-message contract.
- Tightening imports by hand-writing explicit type lists may recreate drift in another form. `compute_core::bridge_types::*` already exists as a documented single source for bridge signature types, so the plan should either use it or explain why generated/import-manifest checks are better.

Contract and verification assessment

The contract intent is good, but several gates need sharper definitions before they can enforce the desired invariants. The parity test should compare a normalized bridge-method manifest, not raw exported symbols, because NAPI class methods, WASM free functions, lifecycle helpers, `*_destroy`, skip-target methods, and platform-only modules do not have a one-to-one raw export shape. The exception list should cover every binding consumer and every `#[bridge::skip(...)]` target, not only chart rendering and coordinator functions.

The `.d.ts` diff gate is valuable for WASM symbol stability, but it should be paired with an authoritative source manifest generated from bridge IR. The wasm init tests also need exact harness ownership: current `compute/wasm` does not visibly define a wasm-pack test setup, so the plan should specify any `wasm-bindgen-test` dev dependency and the exact command. For logging, define accepted `set_log_level` values, return/error behavior, and what happens if a subscriber was already installed without the reload handle.

Concrete changes that would raise the rating

- Replace the WASM/NAPI-only parity framing with an "all descriptor consumers" inventory covering WASM, NAPI, PyO3, and any Tauri/TS registry surfaces, with explicit platform manifests and checked exceptions.
- Specify the exact manifest macro API and intended call sites before implementation, including how `bridge_wasm::generate!`, `bridge_napi::generate_class!`, `bridge_napi::generate!`, and `bridge_pyo3` consume it.
- Put `ComputeService` manifest generation in the layer that actually has the full delegated descriptor list, or define a checked hand-written manifest there as an interim step. Do the same separately for stateless `bridge_pure` descriptors.
- Define a machine-readable panic signal that `wasm-transport.ts` can observe in its catch path, not only a console marker.
- Use `compute_core::bridge_types::*` or a generated import manifest for descriptor signature types instead of another manually curated import list.
- Make the verification section executable: list the exact cargo/package/app-eval commands, the generated artifacts to diff, and the normalized symbol/method sets each gate compares.
