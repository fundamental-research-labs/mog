//! Marker attributes for the `no_bare_f64_at_boundary` build-time gate.
//!
//! The gate (a `tests/no_bare_f64_at_boundary.rs` walker test in each of the
//! five type crates under `compute/core/crates/types/`) forbids bare `f64`
//! fields in any `#[derive(Serialize)]` or `#[derive(Deserialize)]` struct/enum
//! so non-finite `f64` values (`NaN`, `±∞`) cannot serialize to JSON `null` and
//! corrupt the Rust↔TS / Rust↔Rust IPC boundary.
//!
//! ## Usage
//!
//! ```ignore
//! use finite_at_boundary::AllowedBareF64;
//!
//! #[derive(AllowedBareF64)]
//! pub struct FiniteF64 {
//!     #[allowed_bare_f64]   // walker: this field is whitelisted
//!     val: f64,
//! }
//! ```
//!
//! The `#[derive(AllowedBareF64)]` is a no-op at compile time; the walker
//! recognises the helper attribute `#[allowed_bare_f64]` (or its qualified
//! path tail `allowed_bare_f64`) on a field and skips it.
//!
//! ## Why a derive (not a free attribute)?
//!
//! Stable Rust does not allow proc-macro attributes directly on struct fields,
//! and tool attributes (e.g. `#[clippy::foo]`) require explicit toolchain
//! registration. Derive macros, in contrast, *do* support helper attributes on
//! their fields out of the box — the same mechanism `#[serde(...)]` and
//! `#[bridge(...)]` rely on. By declaring `AllowedBareF64` as a derive whose
//! sole helper attribute is `allowed_bare_f64`, we get a field-level marker
//! that compiles cleanly on stable, requires no extra crate features, and is
//! detectable by the walker via simple syntactic scan.
//!
//! ## Self-applied locations
//!
//! The only legitimate bare-`f64` carriers in the type crates:
//! - `value-types::FiniteF64::val` — wrapped finite-f64 storage
//! - `value-types::F64x2::{hi, lo}` — double-double pair
//!
//! New uses must justify themselves in a comment immediately above the field.

extern crate proc_macro;

use proc_macro::TokenStream;

/// Derive macro whose sole purpose is to permit the `#[allowed_bare_f64]`
/// helper attribute on fields. The derive itself emits no code; the walker
/// reads the helper attribute syntactically.
///
/// Apply to a struct or enum that contains one or more bare-`f64` fields that
/// must be exempted from the `no_bare_f64_at_boundary` gate (e.g. `FiniteF64`,
/// `F64x2`). Annotate each exempt field with `#[allowed_bare_f64]`.
#[proc_macro_derive(AllowedBareF64, attributes(allowed_bare_f64))]
pub fn allowed_bare_f64_derive(_input: TokenStream) -> TokenStream {
    // No code generation needed; the derive only exists to legalise the
    // `#[allowed_bare_f64]` helper attribute on fields. The walker test
    // reads the attribute syntactically from `src/*.rs`.
    TokenStream::new()
}
