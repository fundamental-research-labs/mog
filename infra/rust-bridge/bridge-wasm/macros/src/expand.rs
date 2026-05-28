//! Code generation for WASM bindings.
//!
//! Converts a `WasmDescriptor` (parsed from descriptor tokens) into a
//! `TokenStream` containing `#[wasm_bindgen]` functions, thread-local
//! registries, and helper code.

mod generate;
mod ir;
mod method;
mod names;
mod params;
mod parse;
mod registry;
mod returns;
mod types;

#[cfg(test)]
mod tests;

pub(crate) fn parse_and_expand(
    input: proc_macro2::TokenStream,
) -> syn::Result<proc_macro2::TokenStream> {
    let desc: ir::WasmDescriptor = syn::parse2(input)?;
    Ok(generate::expand(&desc))
}
