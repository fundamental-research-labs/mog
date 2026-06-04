Rating: 7/10

## Summary judgment

This is a strong contract-focused plan with unusually good local evidence, a correct read of `bridge-ir`'s role, and useful emphasis on making the descriptor DSL authoritative instead of letting target parsers drift. It identifies real production-path issues around discarded versions, dead IR surface, diagnostic spans, and the adoption gap between `bridge-ir` and the pyo3/wasm/tauri/delegate parsers.

The rating is held back by two material execution problems. First, the proposed keystone round-trip test is not implementable as described: `bridge-core` is a `proc-macro` crate, its descriptor and emitter internals are `pub(crate)`, and a `bridge-ir` integration test cannot just dev-depend on it, construct its private descriptor values, or call a `pub(crate)` emitter. Second, the claimed `parse_type_until_comma` tuple/array/`Fn(A, B)` truncation bug appears overstated or wrong for `bridge-ir`, because `proc_macro2::TokenTree::Group` already makes parenthesized and bracketed contents atomic to the top-level loop.

## Major strengths

- The plan accurately frames `bridge-ir` as the target-neutral grammar and IR contract between `bridge-core` emit output and downstream codegen crates.
- The evidence for version fields being parsed and discarded is correct in both `parse.rs` and `param_struct.rs`.
- The evidence for `ApiDescriptor::crate_path` being always `None` in `bridge-ir` is correct, and the plan correctly distinguishes this from `bridge-core`'s pre-emit path rewriting.
- The adoption gap is real: NAPI uses `bridge-ir`, while pyo3, wasm, tauri, and delegate still maintain independent parsers.
- The contract invariants are well specified: unit-return normalization, `fn_prefix` tri-state, deterministic `extras`, optional historical fields, passthrough `scope`/`needs_principal`, and the load-bearing `to_snake_case` acronym behavior.
- The verification intent is production-relevant. The plan asks for crate tests plus the current consumer build, not just isolated parser unit tests.

## Major gaps or risks

- The round-trip gate needs a different architecture. A `bridge-ir` test cannot access `bridge-core::descriptor::*` or `emit::emit_descriptor` as written, and `pub(crate)` exposure from a proc-macro crate would not make those internals callable from `bridge-ir` tests. A `#[doc(hidden)] pub` helper is also suspect because proc-macro crates cannot freely export arbitrary public APIs.
- The plan refers to an emitter "descriptor-body" helper, but the current `bridge-core` emitter produces a full `macro_rules!` descriptor macro. The extraction boundary is not specified.
- The scanner bug claim should be revalidated. Current `bridge-ir` parsing sees `(String, i32)`, `[u8; 4]`, and `Fn(A, B)` as group tokens, so their inner commas should not terminate `parse_type_until_comma`. Adding regression tests is useful, but the plan should not assume a production bug without a failing case.
- The plan's scope is internally inconsistent. It says `bridge-core`, `bridge-napi`, tests, and Cargo files are out of scope or only referenced, but then requires a `bridge-core` exposure change, a `bridge-ir` dev-dependency, new tests, and NAPI adapter updates for `crate_path` removal.
- Version constants in `bridge-ir` alone do not actually centralize the producer/consumer version contract. `bridge-core` and `bridge-derive` would still hardcode `1` unless the plan defines an allowed dependency or a shared non-proc-macro constants home.
- The diagnostics test is underspecified. Span-quality assertions through `syn`/`proc_macro2` can be awkward without location features or a compile-fail harness, so the test strategy needs a concrete mechanism.

## Contract and verification assessment

The plan is good at naming the contracts that matter and mostly ties them to production paths. Version rejection, optional-field compatibility, deterministic metadata, and consumer build checks are the right direction.

The weakest contract point is the proposed emit-to-parse test. The invariant is valuable, but the test design needs to respect Rust proc-macro crate boundaries. Better options are to move descriptor/emitter support into a normal shared crate, add emitter/parser contract tests inside `bridge-core` with local access to private modules, or expose a non-proc-macro support crate used by both `bridge-core` and `bridge-ir`. Without that change, objective 1 will stall or produce a test-only workaround.

The verification gates should also include whichever crate owns the producer-side change. If `bridge-core` or `bridge-derive` are edited for version constants or test exposure, their targeted tests/checks must be listed explicitly, not just `cargo test -p bridge-ir` and `cargo build -p bridge-napi-macros`.

## Concrete changes that would raise the rating

- Replace the `bridge-ir` dev-dependency-on-`bridge-core` round-trip design with a concrete, legal boundary: shared non-proc-macro support crate, `bridge-core` internal contract test, or another mechanism that can actually access emitted descriptor bodies.
- Add an explicit failing fixture for `parse_type_until_comma` before prescribing the fix. If tuple/array/`Fn` cases already pass, recast objective 3 as regression coverage plus any real failing edge case discovered.
- Resolve scope sequencing: either keep this as a `bridge-ir`-only plan and defer `crate_path` removal/NAPI updates/core exposure, or make it a multi-folder plan with exact allowed edits and verification per affected crate.
- Define where descriptor version constants live so producers and consumers do not keep separate magic literals.
- Specify the diagnostics assertion mechanism, for example compile-fail tests or a proc-macro2 span-location feature, rather than a vague "location proxy."
- Add an adoption follow-up contract for the four independent parsers: not full migration in this plan, but a precise compatibility checklist they must meet before depending on `bridge-ir`.
