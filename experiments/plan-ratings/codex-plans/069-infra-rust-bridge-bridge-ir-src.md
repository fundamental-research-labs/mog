# Plan 069: Rust Bridge IR Contract Hardening

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/infra/rust-bridge/bridge-ir/src`

Scope this plan covers:

- `lib.rs`: the public crate facade for shared bridge descriptor IR.
- `ir.rs`: target-neutral descriptor data structures for `#[bridge::api]` output.
- `parse.rs`: parser for the descriptor DSL emitted by `bridge-core`.
- `param_struct.rs`: parser and eligibility classifier for `BridgeParamStruct` descriptors emitted by `bridge-derive`.
- `classify.rs`: shared target-neutral naming helpers.
- Adjacent production contracts that must move in lockstep with this folder: `infra/rust-bridge/bridge-core/src/descriptor.rs`, `infra/rust-bridge/bridge-core/src/emit.rs`, `infra/rust-bridge/bridge-derive/src/param_struct.rs`, and target macro crates under `bridge-napi`, `bridge-pyo3`, `bridge-wasm`, `bridge-tauri`, and `bridge-delegate`.

Out of scope:

- Rewriting target-specific N-API, PyO3, WASM, Tauri, or delegate code generation semantics.
- Introducing compatibility shims around stale descriptor shapes.
- Moving private/internal planning or eval artifacts into the public `mog` repo.

## Current role of this folder in Mog

`bridge-ir` is the regular Rust library that downstream proc-macro crates can depend on to parse the declarative descriptor DSL emitted by `bridge-core`. It is intentionally not a proc-macro crate because downstream macro crates name its types in their own parser and adapter APIs.

The current production flow is:

- `bridge-core` parses Rust `impl` blocks annotated with `#[bridge::api]` and emits `__bridge_descriptor_*!` declarative macros containing `bridge_version = 1`, group, optional function prefix, stateless `type_name` or stateful `service/key_type/key_param`, optional `extras`, and method/lifecycle blocks.
- `bridge-ir::ApiDescriptor` parses that DSL into target-neutral `ApiDescriptor`, `MethodDescriptor`, `Param`, `ParamTag`, lifecycle, scope, skip-target, and tagged-enum schema types.
- `bridge-napi-macros` already depends on `bridge-ir` and converts the shared IR into its historical NAPI-local adapter shape.
- `bridge-derive` emits `__bridge_param_descriptor_*!` macros for `BridgeParamStruct`; `bridge-ir::ParamStructDescriptor` parses those for CLI-style param expansion eligibility.
- `bridge-pyo3-macros`, `bridge-wasm-macros`, `bridge-tauri-macros`, and `bridge-delegate-macros` still have local descriptor parsers and local IR mirrors. This means the shared IR is not yet the actual single production contract for the bridge system.

Observed contract gaps:

- `parse.rs` reads `bridge_version` and `param_struct_version` values but does not reject unsupported values.
- `ApiDescriptor` still falls back to `Unknown` when neither `type_name` nor `service` appears. That keeps old snapshots parseable, but the production descriptor emitted by `bridge-core` should have an explicit source type.
- The crate comments describe the descriptor parser as lossless, but `bridge-core::VariantField` contains a field type string that the emitted tagged-enum DSL and `bridge-ir::VariantField` do not preserve.
- The param-struct parser supports `[str]`, `[prim]`, `[bytes]`, `[serde]`, and `[parse]`, while the general `ParamTag` enum also supports `TaggedEnum`. The intended param-struct taxonomy should be explicit and tested against `bridge-derive`.
- Shared naming lives in `bridge-ir::classify::to_snake_case`, but target macro crates still duplicate other descriptor parsing, type-string normalization, skip handling, access collapsing, and return-shape classification logic.
- Existing `bridge-ir` tests cover representative hand-written descriptor strings, but there is no golden corpus proving `bridge-core` emission, `bridge-ir` parsing, and every target adapter agree on the same descriptor contract.

## Improvement objectives

1. Make `bridge-ir` the single source of truth for the descriptor DSL grammar consumed by every bridge target macro.
2. Convert descriptor versions from ignored syntax into enforced production contracts with clear diagnostics and explicit upgrade points.
3. Remove ambiguous production parsing behavior such as the implicit `Unknown` type fallback once all real emitters and fixtures provide explicit source identity.
4. Make the IR either truly lossless for codegen-relevant schema data or explicitly document and test which upstream details are intentionally not emitted.
5. Centralize shared descriptor utilities without contaminating the target-neutral IR with target-specific codegen policy.
6. Strengthen parser diagnostics so broken descriptor macros fail at the bridge contract boundary, not later inside generated target code.
7. Add cross-target contract tests that catch parser drift, access-kind drift, skip-target drift, tagged-enum drift, and param-struct drift before production bindings compile with incompatible assumptions.

## Production-path contracts and invariants to preserve or strengthen

- `bridge-ir` stays a normal library crate, not a proc-macro crate.
- `bridge-core` remains target-neutral. It emits descriptor facts; target crates decide how to lower those facts into NAPI, PyO3, WASM, Tauri, or delegate code.
- The descriptor DSL has one canonical versioned grammar. All target macros consume the same `bridge-ir::ApiDescriptor` after their own optional preamble tokens are parsed.
- Every production descriptor has exactly one source identity: either `type_name = X;` for stateless APIs or `service = X; key_type = ...; key_param = "...";` for stateful APIs.
- `group`, `fn_prefix`, `extras`, `scope`, `needs_principal`, `skip`, `async`, lifecycle `create`, lifecycle `create_from`, `structural`, and `session` remain first-class descriptor facts.
- Access-kind lowering is target-specific but explicit: for example `Structural` may collapse to write-like bindings, and `Session` may collapse to read-like bindings, but the shared IR preserves the distinction.
- `extras` remain deterministic through `BTreeMap` ordering and must not require `bridge-core` to know target-specific metadata keys.
- `[serde]`, `[str]`, `[prim]`, `[bytes]`, `[parse]`, and `[tagged_enum ...]` param tags keep their existing wire meaning.
- `BridgeParamStruct` Mode B eligibility remains based on terminal scalar fields only. Non-terminal fields must force Mode A, and that decision must be driven by the same tag taxonomy emitted by `bridge-derive`.
- Target codegen may keep local adapter structs where useful, but adapter construction must consume `bridge-ir` rather than reparsing raw descriptor tokens.

## Concrete implementation plan

1. Define the descriptor grammar as an explicit contract in `bridge-ir`.

   - Add public constants for `BRIDGE_DESCRIPTOR_VERSION` and `PARAM_STRUCT_DESCRIPTOR_VERSION`.
   - Add small internal parsing helpers for `key = value;` headers, expected keywords, version checks, and braced blocks so `parse.rs` and `param_struct.rs` share diagnostics instead of open-coding equivalent checks.
   - Change version parsing to reject any version other than the supported constant with an error that names the descriptor kind and expected version.
   - Document the exact accepted descriptor order in `lib.rs` or a crate-local contract comment: optional target preamble belongs to target macros; the standard descriptor begins at `bridge_version`.

2. Make source identity mandatory on the production path.

   - Replace the `Unknown` fallback in `ApiDescriptor` with a parse error when neither `type_name` nor `service` is present.
   - Audit handwritten tests and descriptor fixtures that depended on the fallback and update them to the production shape.
   - Add a negative parser test for missing source identity and a positive test proving stateless and stateful descriptors still parse.
   - Keep `group` optional only if a real production caller still emits descriptors without it; otherwise make it mandatory too and update all target adapters to rely on a real group.

3. Resolve the tagged-enum losslessness mismatch.

   - Compare `bridge-core::TaggedEnumSchema` and `bridge-ir::TaggedEnumSchema` field by field.
   - Decide whether variant field Rust type strings are codegen-relevant. If they are, extend `bridge-core` emission to include them in the `[tagged_enum ...]` DSL, add `ty: String` or `ty: Type` to `bridge-ir::VariantField`, update NAPI/PyO3 adapters, and add round-trip tests.
   - If field type strings are intentionally not part of the descriptor contract, remove or rewrite comments that claim full field/type losslessness and add a test that verifies the intentionally preserved subset: Rust name, wire name, field tag, variant name, tag key, content key, and variant ordering.
   - Add a golden descriptor containing renamed variants, renamed fields, adjacent tagging with `content`, empty variants, and all supported field tags.

4. Make the IR easier to snapshot and compare.

   - Derive `Clone`, `PartialEq`, and `Eq` for every IR type where `syn` permits it under the existing `extra-traits` dependency.
   - For `syn::Type` fields, add deterministic helper methods that render normalized token strings for tests and target adapters without duplicating token-joining code.
   - Add `MethodDescriptor::is_skipped_for(&str)`, `ApiDescriptor::effective_fn_prefix()`, and small access-query helpers only where they are target-neutral facts.
   - Keep return encoding decisions out of `bridge-ir`, but centralize syntax-only return-shape inspection if all target crates need the same tuple/bytes/self detection.

5. Move target macro parsers onto `bridge-ir`.

   - Keep target-specific config preambles local: `security_level` for Tauri and `delegate_*` config for delegate macros should be parsed before handing the remaining stream to `ApiDescriptor`.
   - Update `bridge-pyo3-macros`, `bridge-wasm-macros`, `bridge-tauri-macros`, and `bridge-delegate-macros` to depend on `bridge-ir` and parse `ApiDescriptor` for the standard descriptor body.
   - Convert each target's local IR from `bridge_ir::ApiDescriptor` through a small adapter module, following the current NAPI pattern.
   - Delete local duplicate descriptor parsers once the adapter tests pass.
   - Preserve target-specific access lowering explicitly in adapters: `Structural` to write-like where appropriate, `Session` to read-like where appropriate, and delegate preserving gated/security distinctions.

6. Align param-struct parsing with `bridge-derive`.

   - Add tests that derive or fixture every `BridgeParamStruct` field category emitted by `bridge-derive`, including optional fields, nested serde fields, bytes, parse, and any enum/tagged-enum cases.
   - If `BridgeParamStruct` can emit tagged-enum fields, teach `ParamStructDescriptor` to parse them and mark the struct Mode A only.
   - If it cannot emit tagged-enum fields by design, encode that design in comments and in a negative test with a clear diagnostic.
   - Add helper methods for `terminal_fields`, `non_terminal_fields`, or `mode_b_blockers` so CLI-style targets can explain why Mode B is unavailable instead of recomputing eligibility.

7. Add a bridge descriptor golden corpus.

   - Build a checked-in test fixture set under `bridge-ir/tests` that covers every descriptor grammar feature emitted by `bridge-core`: stateless APIs, services, groups, prefixes including `_`, extras, all access kinds, lifecycle variants, every param tag, generic and reference types, unit returns, fallible methods, async methods, skip targets, scope, and needs-principal.
   - Add tests that parse each fixture through `bridge-ir` and through every target adapter after migration.
   - Add a bridge-core emission round-trip test that starts from annotated Rust APIs, emits descriptor tokens, parses them with `bridge-ir`, and compares the parsed facts to expected snapshots.
   - Include negative fixtures for unsupported versions, missing mandatory headers, unknown access kinds, unknown method-body keywords, malformed tagged enum schemas, and invalid param-struct markers.

8. Strengthen diagnostics at the contract boundary.

   - Make parse errors include the descriptor section and expected grammar, for example `bridge descriptor: expected exactly one of type_name or service` or `tagged_enum variants: missing tag key`.
   - Preserve useful spans for target macros by returning `syn::Error` at the earliest bad token.
   - Add tests that assert diagnostic substrings for common broken descriptor shapes.
   - Avoid panics in parsing and adapter conversion; target code generation should only see validated IR.

9. Document and enforce dependency direction.

   - Keep `bridge-ir` independent of `bridge-core`, `bridge-napi`, `bridge-pyo3`, `bridge-wasm`, `bridge-tauri`, `bridge-delegate`, and production compute crates.
   - Allow target macro crates to depend on `bridge-ir`; never add a reverse dependency.
   - If shared return-shape helpers are added, keep them syntactic and target-neutral, or place target-specific logic in each target adapter.
   - Add comments in each target adapter explaining which shared IR fields are intentionally ignored by that target.

10. Remove stale duplicate helpers after migration.

   - Delete duplicate `to_snake_case` implementations where targets can import `bridge_ir::classify::to_snake_case`.
   - Delete duplicate type-token joining helpers where adapters can use a shared normalized type-rendering helper.
   - Delete duplicate tagged-enum parser code in PyO3 and any other target after they consume shared `ParamTag::TaggedEnum`.
   - Keep local code only for target-specific return classification, parameter conversion, and generated syntax.

## Tests and verification gates

Required bridge IR gates:

- `cargo test -p bridge-ir`
- `cargo clippy -p bridge-ir`

Target adapter gates after migrating target macro crates:

- `cargo test -p bridge-napi-macros`
- `cargo test -p bridge-pyo3-macros`
- `cargo test -p bridge-wasm-macros`
- `cargo test -p bridge-tauri-macros`
- `cargo test -p bridge-delegate-macros`
- `cargo clippy -p bridge-napi-macros`
- `cargo clippy -p bridge-pyo3-macros`
- `cargo clippy -p bridge-wasm-macros`
- `cargo clippy -p bridge-tauri-macros`
- `cargo clippy -p bridge-delegate-macros`

Production bridge behavior gates:

- `cargo test -p bridge-napi`
- `cargo test -p bridge-pyo3`
- `cargo test -p bridge-wasm`
- `cargo test -p bridge-tauri`
- `cargo test -p bridge-delegate`
- `cargo test -p bridge-core`
- `cargo test -p bridge-derive`

Contract-specific tests to add:

- Descriptor version rejection for unsupported bridge and param-struct versions.
- Mandatory source identity rejection.
- Bridge-core emit to bridge-ir parse round-trip snapshots.
- Cross-target adapter snapshots for the same descriptor corpus.
- Tagged-enum schema preservation or explicitly documented intentional lossy subset.
- Param-struct Mode B eligibility and blocker diagnostics.
- Access-kind lowering snapshots for `Pure`, `Read`, `Write`, `Structural`, `Session`, lifecycle create, and lifecycle create-from.
- Skip-target behavior snapshots per target.
- Extras ordering and target-specific extras ignoring/consumption.

Broader verification after descriptor grammar changes:

- Run the Rust bridge package tests before compute binding tests. Descriptor parser failures should surface at the macro layer before NAPI/WASM/PyO3/Tauri generated bindings are exercised.
- For changes that alter descriptor emission, run the relevant compute binding package tests that compile generated descriptors on the production path, especially `compute/napi`, `compute/wasm`, `compute/pyo3`, and any Tauri integration crate that consumes bridge descriptors.

## Risks, edge cases, and non-goals

- Migrating every target macro to `bridge-ir` can expose existing parser drift. Treat those as contract bugs to resolve through adapter lowering, not as reasons to keep duplicate parsers.
- Removing the `Unknown` fallback may break stale handwritten fixtures. Production descriptors should be updated to the real emitted shape instead of preserving ambiguous parsing.
- Version enforcement will make future descriptor changes more explicit. Any `bridge_version = 2` work should land as a planned grammar migration with tests for both the emitter and every consumer.
- Target-specific preambles are not part of the shared descriptor grammar. Folding them into `ApiDescriptor` would make `bridge-ir` target-aware and should be avoided.
- Do not move bridge-core's upstream Rust-source parser into `bridge-ir`. `bridge-ir` owns the emitted descriptor contract, not the original attribute parser.
- Do not add test-only descriptor modes that production emitters never use.
- Do not collapse `Structural` or `Session` inside the shared IR. Only target adapters may collapse them for codegen shape.
- Be careful with `syn::Type` equality and token rendering. Snapshot helpers should normalize enough for deterministic tests without changing the parsed type tree used by target codegen.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable after the version/source-identity contract is agreed:

- Worker A: harden `bridge-ir/src` parsing, IR derives/helpers, diagnostics, and local tests.
- Worker B: align `bridge-core/src/emit.rs` and `bridge-core/src/descriptor.rs` with the bridge-ir contract, including tagged-enum field-type preservation or documented omission.
- Worker C: migrate `bridge-pyo3-macros` and `bridge-wasm-macros` from local parsers to `bridge-ir` adapters.
- Worker D: migrate `bridge-tauri-macros` and `bridge-delegate-macros`, including their target preamble handling and gated access lowering.
- Worker E: align `bridge-derive/src/param_struct.rs` with `ParamStructDescriptor` and add param-struct fixture coverage.
- Worker F: build the shared descriptor golden corpus and cross-target adapter snapshot tests.

Dependencies:

- `bridge-core` emission changes must land before mandatory parser changes if any current production descriptor omits source identity or group.
- Target macro migrations depend on `bridge-ir` exposing stable helper methods for normalized type rendering and skip/effective-prefix queries.
- Delegate migration needs extra care because it re-emits descriptors after stripping or preserving security facts. It should be verified with existing gated delegate tests before NAPI/WASM/PyO3 downstream tests.
- Param-struct changes depend on the exact descriptor shape emitted by `bridge-derive`.
