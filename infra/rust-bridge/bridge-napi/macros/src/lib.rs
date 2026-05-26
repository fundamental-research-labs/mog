//! Code generation for napi-rs bindings.
//!
//! Converts a `NapiDescriptor` (parsed from descriptor tokens) into a
//! `TokenStream` containing `#[napi]` functions, `LazyLock<DashMap>` registries,
//! and helper code.

mod classify;
mod expand_class;
mod expand_fn;
mod ir;
mod parse;

use proc_macro::TokenStream;

/// Internal proc macro -- receives descriptor tokens and emits napi binding code.
///
/// Not intended to be called directly. Use `bridge_napi::generate!` instead.
#[proc_macro]
pub fn __expand(input: TokenStream) -> TokenStream {
    let input2: proc_macro2::TokenStream = input.into();
    match expand_fn::parse_and_expand(input2) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}

/// Internal proc macro -- receives `__class_name = ClassName; <descriptor tokens>`
/// and emits class-based `#[napi] impl` methods.
///
/// Not intended to be called directly. Use `bridge_napi::generate_class!` instead.
#[proc_macro]
pub fn __expand_class(input: TokenStream) -> TokenStream {
    let input2: proc_macro2::TokenStream = input.into();
    match expand_class::parse_and_expand_class(input2) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}

/// Internal proc macro -- receives `struct ClassName(InnerType); desc1, desc2, ...`
/// and emits a `#[napi]` struct definition plus descriptor macro invocations.
///
/// Not intended to be called directly. Use `bridge_napi::generate_class!` instead.
#[proc_macro]
pub fn __generate_class(input: TokenStream) -> TokenStream {
    let input2: proc_macro2::TokenStream = input.into();
    match expand_class::generate_class_impl(input2) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}
