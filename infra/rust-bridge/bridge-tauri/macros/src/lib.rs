mod expand;

use proc_macro::TokenStream;

/// Internal proc macro -- receives descriptor tokens and emits Tauri command code.
///
/// Not intended to be called directly. Use `bridge_tauri::generate!` instead.
#[proc_macro]
pub fn __expand(input: TokenStream) -> TokenStream {
    let input2: proc_macro2::TokenStream = input.into();
    match expand::parse_and_expand(input2) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}
