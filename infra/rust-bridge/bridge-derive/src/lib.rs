use proc_macro::TokenStream;
use quote::quote;
use syn::{DeriveInput, parse_macro_input};

mod param_struct;

/// Derive `BridgeError` for an error type.
///
/// Generates `impl bridge_types::BridgeError for MyError {}`.
/// The type must already implement `Display` (e.g., via `thiserror::Error`)
/// and be `Send + 'static` -- the compiler enforces these bounds from the trait.
///
/// # Basic usage
///
/// ```ignore
/// #[derive(thiserror::Error, BridgeError)]
/// enum MyError {
///     #[error("not found: {0}")]
///     NotFound(String),
/// }
/// ```
///
/// # Structured errors
///
/// With `#[bridge_error(structured)]`, also derives `BridgeStructuredError`
/// using serde serialization. The type must additionally derive `serde::Serialize`,
/// and the consuming crate must depend on `serde_json`.
///
/// ```ignore
/// #[derive(thiserror::Error, BridgeError, serde::Serialize)]
/// #[bridge_error(structured)]
/// enum MyError {
///     #[error("not found: {id}")]
///     NotFound { id: String, code: u32 },
/// }
/// ```
#[proc_macro_derive(BridgeError, attributes(bridge_error))]
pub fn derive_bridge_error(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    // Check for #[bridge_error(structured)] attribute
    let has_structured = input.attrs.iter().any(|attr| {
        if !attr.path().is_ident("bridge_error") {
            return false;
        }
        attr.parse_args::<syn::Ident>()
            .map(|ident| ident == "structured")
            .unwrap_or(false)
    });

    let base_impl = quote! {
        impl #impl_generics bridge_types::BridgeError for #name #ty_generics #where_clause {}
    };

    if has_structured {
        let structured_impl = quote! {
            impl #impl_generics bridge_types::BridgeStructuredError for #name #ty_generics #where_clause {
                fn to_bridge_value(&self) -> serde_json::Value {
                    serde_json::to_value(self).unwrap_or_else(|e| {
                        serde_json::Value::String(format!("serialization error: {}", e))
                    })
                }
            }
        };
        quote! {
            #base_impl
            #structured_impl
        }
        .into()
    } else {
        base_impl.into()
    }
}

/// Derive `BridgeParamStruct` — emits an `__bridge_param_descriptor_<Name>!`
/// declarative macro alongside the struct so downstream targets (first
/// consumer: `bridge-cli-macros` for Mode B clap flag expansion) can discover
/// the struct's field shape at compile time.
///
/// The struct must have named fields. Each field is classified per the
/// bridge-core taxonomy (`str` / `prim` / `bytes` / `serde`); `Option<T>` is
/// peeled once and the field gets an `optional` marker. See
/// `ARCHITECTURE.md §2.4` for the design.
///
/// # Example
///
/// ```ignore
/// #[derive(serde::Serialize, serde::Deserialize, BridgeParamStruct)]
/// pub struct ChartSpec {
///     pub kind: String,
///     pub range: String,
///     pub title: Option<String>,
/// }
/// ```
///
/// then downstream:
///
/// ```ignore
/// bridge_cli::generate! {
///     api: [ ... ],
///     param_structs: [ crate::__bridge_param_descriptor_ChartSpec ],
/// }
/// ```
#[proc_macro_derive(BridgeParamStruct)]
pub fn derive_bridge_param_struct(input: TokenStream) -> TokenStream {
    param_struct::derive(input)
}
