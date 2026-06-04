# 069 — Improve `mog/infra/rust-bridge/bridge-ir/src` (Rust bridge IR & codegen contract)

## Source folder and scope

- **Folder:** `mog/infra/rust-bridge/bridge-ir/src`
- **Crate:** `bridge-ir` (`publish = false`; a *regular library*, deliberately NOT a proc-macro crate, so proc-macro crates can name its types in their public APIs). Deps: `syn 2 [full, extra-traits]`, `quote`, `proc-macro2`.
- **Files in scope (5):**
  - `lib.rs` — crate doc + module wiring + public re-exports.
  - `ir.rs` — target-neutral descriptor types (`ApiDescriptor`, `MethodDescriptor`, `Param`, `ParamTag`, `AccessLevel`, `LifecycleKind`, `ServiceMeta`, `TaggedEnumSchema`, `VariantSchema`, `VariantField`).
  - `parse.rs` — `impl Parse for ApiDescriptor`: the descriptor-DSL parser (the grammar consumed from `bridge-core`'s `__bridge_descriptor_*!` macros).
  - `param_struct.rs` — `ParamStructDescriptor` / `ParamStructField` + `impl Parse` for the `__bridge_param_descriptor_*!` DSL, plus `is_mode_b_eligible`.
  - `classify.rs` — target-neutral helpers (`to_snake_case`) + unit tests.
- **In scope:** the IR type surface; the two DSL grammars parsed here; round-trip/version invariants; diagnostics; helper correctness. The two integration test files (`tests/parse.rs`, `tests/param_struct.rs`) are referenced as verification gates, not edit targets of the *folder* itself, but new gates added by this plan land in this crate's `tests/`.
- **Out of scope (do not edit; named only to describe coupling):** the *producer* `bridge-core/src/emit.rs` and `bridge-derive/src/param_struct.rs`; the consuming target crates `bridge-napi/macros/{ir,parse,classify}.rs`; the independent parallel parsers in `bridge-pyo3/macros/src/expand/parse.rs`, `bridge-wasm/macros/src/expand/parse.rs`, `bridge-tauri/macros/src/expand/parse.rs`, and `bridge-delegate/macros/src/expand/parse.rs`. Changes that ripple into those crates are flagged as cross-folder dependencies.

## Current role of this folder in Mog

`bridge-ir` is the **target-neutral intermediate representation and grammar contract** that sits between `bridge-core` (which emits a declarative-macro DSL describing each `#[bridge::api]` impl block) and the per-target codegen crates (napi / pyo3 / wasm / tauri / delegate) that turn that DSL into bindings. Conceptually it is the one place where "what shape does a bridged API have" is defined as data: identifiers, access levels, parameter wire-tags (`str`/`prim`/`bytes`/`serde`/`parse`/`tagged_enum`), return/error types, `async`/`fallible`/`scope`/`needs_principal` flags, lifecycle constructors, and an open `extras` metadata bag. `param_struct.rs` plays the same role for `#[derive(BridgeParamStruct)]` structs, classifying each field so a CLI target can decide Mode-A vs Mode-B argument emission.

The crate's stated reason to exist (per its own module docs) is **de-duplication**: every downstream target "needs to parse the same DSL into the same IR," so that parsing + IR should live here once rather than as parallel copies.

**Observed reality — the contract is only half-adopted.** Today only `bridge-napi/macros` actually depends on `bridge-ir` (and even then it wraps the IR in a *local* `String`-based adapter IR via `From` impls — see `bridge-napi/macros/src/ir.rs`'s historical note). The other four DSL consumers — `bridge-pyo3`, `bridge-wasm`, `bridge-tauri`, `bridge-delegate` — each ship their **own** `expand/parse.rs` that re-parses the same DSL independently; none lists `bridge-ir` as a dependency. The DSL grammar is therefore currently authored in **six** places (one emitter in `bridge-core` + five parsers), exactly the fan-out `bridge-ir` was created to collapse. `param_struct.rs`'s designated first consumer (`bridge-cli-macros`) does not yet exist in the tree, so `is_mode_b_eligible` has no production caller.

This framing matters: the highest-value production-path work here is **making `bridge-ir` correct, complete, and authoritative enough to be the single parser**, and enforcing the round-trip contract mechanically — not adding features.

## Improvement objectives

1. **Mechanically enforce the "lossless round-trip" invariant.** The crate docs assert "every known shape round-trips losslessly," but nothing tests `bridge-core` emit → `bridge-ir` parse end to end. The two parsers are hand-maintained mirrors of one emitter and can silently drift. Add a contract test that drives real `bridge-core` output through the `bridge-ir` parser.
2. **Make the version handshake real.** `bridge_version = 1;` and `param_struct_version = 1;` are parsed into `_version` and discarded — an unknown future version is silently accepted and then mis-parsed. Validate the version and fail with a clear, actionable diagnostic.
3. **Fix the `parse_type_until_comma` bracket-depth bug.** The custom type scanner tracks only `<`/`>` depth, so a parameter type containing a top-level comma inside `()` or `[]` (tuple types, `Fn(A, B)`/closure-trait bounds, fixed arrays with generic elements) is truncated at the wrong comma and fails to parse. This is a latent correctness bug in the production parse path.
4. **Remove or wire the dead `crate_path` field.** `ApiDescriptor::crate_path` is always set to `None` by the parser (the DSL never carries it; `bridge-core` qualifies paths inline before emit). It is a misleading part of a "contract" IR. Either delete it or give it a real source.
5. **Tighten parser diagnostics to point at the offending span.** Several errors (`tagged_enum: missing name`/`missing tag`) report at `Span::call_site()`, which surfaces in a developer's build at the macro-invocation site with no useful location. Use the best available span.
6. **Centralize and document the grammar as the single source of truth**, so the migration of the four still-independent parsers onto `bridge-ir` (cross-folder) can proceed against a stable, well-specified contract.

All six are production-path: they harden the IR that every target crate compiles against, fix a real parse bug, and make the de-duplication the crate promises actually achievable. None is a test-only patch — objective 1 *adds* a gate but the others change shipping parser behavior.

## Evidence (observed in the current tree)

- **No round-trip gate.** `tests/parse.rs` feeds hand-written DSL strings; it never imports `bridge-core` or `bridge-core::emit` output. Drift between `emit.rs` and `parse.rs` is invisible until a downstream codegen breaks.
- **Version discarded.** `parse.rs:31-34` reads `bridge_version` then binds the literal to `_version` and drops it. `param_struct.rs:72-81` does the same for `param_struct_version`. `bridge-core/src/emit.rs` emits `1` in two arms; `bridge-derive/src/param_struct.rs` emits `1` in two arms. There is a producer→consumer version field with no consumer-side check.
- **Bracket-depth bug.** `parse.rs:452-473` (`parse_type_until_comma`) increments/decrements only on `"<"`/`">"`. A param emitted by `emit.rs` as `[serde] pair: (String, i32),` breaks at the inner comma; `Fn(A, B)` trait-object/closure params and array types with commas in generic args have the same failure. `emit.rs` emits the type verbatim via `quote!`, so any such type reaches this scanner unwrapped.
- **`crate_path` is dead.** `parse.rs:124` hardcodes `crate_path: None`; the field's own doc in `ir.rs:39-41` calls it "currently informational at this layer." No DSL token populates it; no consumer reads it from the parsed IR.
- **Call-site spans.** `parse.rs:374-381` constructs `syn::Error::new(proc_macro2::Span::call_site(), ...)` for missing `tagged_enum` keys instead of a span derived from the enclosing tokens.
- **Adoption gap.** `rg "bridge_ir" bridge-pyo3 bridge-wasm bridge-tauri bridge-delegate` returns nothing in their `Cargo.toml`s; each has its own `expand/parse.rs`. Only `bridge-napi/macros` depends on `bridge-ir`, and it re-wraps the IR in a local adapter.
- **Speculative param-struct consumer.** `is_mode_b_eligible` (`param_struct.rs:60`) and the whole `param_struct` parser have no in-tree caller; `bridge-cli`/`bridge-cli-macros` referenced in the docs do not exist (only a `client/` dir is present).

## Production-path contracts and invariants to preserve or strengthen

- **Byte-identical DSL backward compatibility.** `emit.rs` is explicit that an empty `extras` map and unset `scope`/`needs_principal` must produce DSL byte-identical to the pre-feature shape, because downstream parsers (pyo3/wasm/tauri) don't yet skip those constructs. The `bridge-ir` parser must keep accepting both the minimal historical shape **and** the extended shape. Any new required token would break those independent parsers — so additions stay optional-and-skippable.
- **Lossless round-trip.** Every shape `bridge-core` can emit must parse, and the parsed IR must carry enough to reconstruct an equivalent DSL. Objective 1 turns this from prose into a gate; do not weaken it.
- **Unit-return normalization.** `return_type = ();` ⇒ `None` (`parse.rs:236`, `is_unit_type`). Preserve: downstream codegen distinguishes "no return" from a real return, and this is the single normalization point.
- **`None` fallbacks for older descriptors.** Missing `group`/`fn_prefix`/`type_name` are tolerated (`type_name` falls back to `Unknown`). These exist to keep pre-existing snapshots parsing; keep them, but ensure objective 2's version check does not regress them (an explicit `bridge_version` is always present in current emit output, so version validation is safe to require).
- **Determinism.** `extras` is a `BTreeMap` and method/param/variant order is preserved by `Vec`s — the emitted-and-reparsed DSL is stable across compilations. Do not introduce `HashMap` or reordering.
- **`fn_prefix` tri-state.** `Some("")` (disabled) vs `Some(p)` (override) vs `None` (default to `to_snake_case(type_name)`) is a real three-way contract (`ir.rs:34-38`, parsed at `parse.rs:48-60`). Preserve all three.
- **`scope`/`needs_principal` are lossless passthrough** consumed by `bridge-delegate` even though most targets strip them. The IR must keep carrying them verbatim.
- **`to_snake_case` byte-level behavior is load-bearing.** `classify.rs` documents that it deliberately does NOT special-case acronyms (`HTTPServer` ⇒ `h_t_t_p_server`) and that "all existing call sites rely on that." `bridge-napi` re-exports it. Do not "fix" the acronym handling — it would silently rename generated functions.
- **`VariantField::tag` is `Box<ParamTag>` but nested `tagged_enum` collapses to `Serde`** (matching `bridge-core`'s emit-side fallback). Preserve this representation so the DSL round-trips; do not start emitting/parsing recursively nested tagged enums without a coordinated `emit.rs` change.

## Concrete implementation plan

Work is ordered so each step is independently landable and each strengthens the contract without breaking the four independent parsers.

1. **Add a cross-crate round-trip contract test (objective 1).**
   - New `bridge-ir/tests/roundtrip_with_core.rs` (dev-only; add `bridge-core` as a `[dev-dependencies]` entry in `bridge-ir/Cargo.toml` — a dev-dep does not make `bridge-ir` depend on `bridge-core` at build time, preserving layering).
   - Build representative `bridge-core` descriptor values (stateless pure/read; stateful service with lifecycle `create`/`create_from`; tagged-enum params; `extras`; `scope`/`needs_principal`; async; skip targets), run them through `bridge-core::emit`'s descriptor-body emitter, then `syn::parse_str::<bridge_ir::ApiDescriptor>` the result and assert field-by-field equality with the source.
   - If `emit`'s descriptor-body function is not exposed for testing, the *minimal* enabling change in `bridge-core` is to make that one fn `pub(crate)`-testable or expose a `#[doc(hidden)]` helper — flag as a small cross-folder dependency (see Parallelization). Do not refactor `emit.rs` beyond exposure.
   - This is the keystone gate: it makes objectives 2–5 safe to land and catches future emitter/parser drift.

2. **Validate `bridge_version` and `param_struct_version` (objective 2).**
   - Introduce a `pub const SUPPORTED_BRIDGE_VERSION: u64 = 1;` (and `SUPPORTED_PARAM_STRUCT_VERSION`) in `ir.rs`/`param_struct.rs` so the contract version is a named, documented constant rather than a magic literal split across emitter and parser.
   - In both `Parse` impls, compare the parsed `LitInt` against the supported version; on mismatch return `syn::Error::new(version_lit.span(), format!("bridge-ir supports descriptor version {SUPPORTED_BRIDGE_VERSION}, but this descriptor declares version {n}; rebuild bridge-core and bridge-ir together"))`.
   - Keep accepting the historical "no `type_name`" fallback — version validation gates only the explicit version token, which current emit always includes.

3. **Fix `parse_type_until_comma` (objective 3).**
   - Track `()` and `[]` nesting depth alongside `<>` depth; only break on a comma when **all** depths are zero. Match-by-`Delimiter` on `TokenTree::Group` (which is how `proc_macro2` represents parenthesized/bracketed sub-streams) rather than string-comparing `"("`/`"["` — a `Group` token is atomic, so a tuple/array/fn-trait type is captured whole in one `append` and the inner comma never reaches the top-level check. This is both the correct fix and simpler than counting brackets.
   - Add unit tests for `(String, i32)`, `Vec<(K, V)>`, `Box<dyn Fn(A, B) -> C>`, `[u8; 4]`, and `HashMap<K, V>` param types, asserting the full type is captured.

4. **Resolve `crate_path` (objective 4).**
   - Confirm via the round-trip test and `rg` that no consumer reads `ApiDescriptor::crate_path` (only `parse.rs` writes the constant `None`; `bridge-napi` doesn't surface it). **Remove the field** and its doc, deleting the dead contract surface. (If a consumer is found, instead carry it through the DSL properly — but evidence says remove.)
   - This is an IR shape change; the round-trip test and the napi `From` impls must be updated. Removing a never-populated field is low-risk but is a public-type change, so it ships behind the round-trip gate.

5. **Improve diagnostics (objective 5).**
   - Replace `Span::call_site()` errors in `parse_tagged_enum_spec` with spans captured from the `tagged_enum` keyword/bracket group so the message points at the offending param. Apply the same to any other `call_site()` error paths.
   - Keep the existing "unknown X" arms (`unknown access level`, `unknown param tag`, `unexpected keyword in method body`) — they already use the ident's span and are the right model.

6. **Document the grammar as the single source of truth (objective 6).**
   - Expand the `parse.rs` module doc into a compact grammar reference (the union of constructs `emit.rs` produces) and cross-link it from `lib.rs`, so the four independent parsers have an authoritative spec to migrate against. This is doc-only and lands with no behavior change.

## Tests and verification gates

- **New gate — emit↔parse round-trip** (`tests/roundtrip_with_core.rs`): for each representative descriptor, `emit → parse → assert structural equality`. This is the gate that makes the crate's central invariant real.
- **New unit tests** in `parse.rs` for `parse_type_until_comma` covering tuple/array/fn-trait/nested-generic param types (objective 3).
- **New unit tests** for version mismatch: a DSL string with `bridge_version = 2;` must `Err` with a message naming the supported version; `param_struct_version = 2;` likewise.
- **Diagnostics test:** a malformed `tagged_enum` (missing `tag`) yields an error whose span is not `call_site` (assert via `to_string`/location proxy as `syn` allows).
- **Preserve existing gates:** all current assertions in `tests/parse.rs` (service/lifecycle/access levels/tagged enum/async/skip/scope/needs_principal/extras) and `tests/param_struct.rs`, plus `classify.rs`'s `to_snake_case` cases (including the acronym case that must stay `h_t_t_p_server`) must continue to pass unchanged.
- **Build/typecheck gates (run by reviewer, not by this planning task):** `cargo test -p bridge-ir`; and because objective 4 changes a public type and objective 2/3 change behavior, also `cargo build -p bridge-napi-macros` (the only current consumer) and the workspace check, to confirm no downstream break.
- **Backward-compat assertion:** include a test parsing the *minimal* historical DSL (no `group`, no `fn_prefix`, no `extras`, no `scope`) to prove the optional-and-skippable contract still holds.

## Risks, edge cases, and non-goals

- **Risk: removing `crate_path` is a breaking IR change.** Mitigation: it is provably never populated (always `None`) and no reader was found; gated behind the round-trip + napi build. If any out-of-tree consumer exists, downgrade objective 4 to "document as reserved/always-None" instead of removing.
- **Risk: version validation rejecting in-flight descriptors.** Mitigation: current `emit`/`derive` always emit version `1`; the check only fires on a genuine mismatch, which is exactly the case we want to fail loudly rather than mis-parse.
- **Edge case: `>>` shift tokenization.** `proc_macro2` yields two `>` puncts for `Vec<Vec<T>>`, so angle tracking already balances; the `Group`-based rewrite in objective 3 sidesteps bracket counting entirely and is robust to this.
- **Edge case: the four independent parsers may already (mis)handle tuple params their own way.** The `bridge-ir` fix must match whatever `emit.rs` actually emits; the round-trip test pins that. Migrating those parsers is explicitly cross-folder (below).
- **Non-goal: changing `to_snake_case` acronym behavior** — load-bearing, documented, relied upon by napi.
- **Non-goal: implementing recursively-nested `tagged_enum` fields** — current contract collapses them to `Serde` to match `emit.rs`; changing that requires a coordinated emitter change and is out of scope.
- **Non-goal: building `bridge-cli-macros` or adding `is_mode_b_eligible` consumers** — that is a separate feature; this plan only keeps the param-struct IR correct and version-checked.
- **Non-goal: no reduced-scope shims or compat layers** — objectives strengthen the real contract; the temporary napi `From`-adapter is acknowledged but its removal is a cross-folder follow-up, not a shim added here.

## Parallelization notes and dependencies on other folders

- **Independent within this folder:** objectives 2 (version), 3 (type scanner), 5 (diagnostics), and 6 (grammar doc) touch disjoint regions of `parse.rs`/`param_struct.rs`/`lib.rs` and can be done in parallel. Objective 1 (round-trip test) should land first because it de-risks the rest.
- **Cross-folder dependency — `bridge-core` (`emit.rs`):** the round-trip test needs the descriptor-body emitter reachable from a dev-dependency. Smallest enabling change: expose that one function for testing. No semantic change to `emit.rs`.
- **Cross-folder ripple — `bridge-napi/macros`:** objective 4 (removing `crate_path`) and any IR field change require updating the `From<bridge_ir::*>` adapter in `bridge-napi/macros/src/ir.rs`. This is the only current consumer, so the blast radius is contained.
- **Cross-folder follow-up (separate plans) — `bridge-pyo3`/`bridge-wasm`/`bridge-tauri`/`bridge-delegate`:** migrating their `expand/parse.rs` onto `bridge_ir::ApiDescriptor` is the payoff that makes this crate's de-duplication real, but each is its own folder and its own plan. This plan deliberately makes `bridge-ir` *ready* for that migration (correct type scanner, version handshake, documented grammar, enforced round-trip) without editing those crates.
- **No dependency** on the unrelated `mog-internal` eval scenarios listed as pre-existing dirty paths; this plan touches only the one required plan file.
