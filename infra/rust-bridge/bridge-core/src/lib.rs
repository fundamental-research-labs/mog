mod descriptor;
mod emit;
mod parse;

use proc_macro::TokenStream;
use quote::quote;
use syn::parse_macro_input;

static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Annotate a struct as a bridge service (marker — metadata goes on the impl block).
#[proc_macro_attribute]
pub fn service(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

/// Parse an impl block and emit an API descriptor macro.
///
/// # Mode 1 — stateless functions
/// ```ignore
/// #[bridge::api]
/// impl Utilities {
///     #[bridge::pure]
///     pub fn validate(input: &str) -> bool { ... }
/// }
/// ```
///
/// # Mode 2 — stateful service
/// ```ignore
/// #[bridge::api(service = "Engine", key = "doc_id")]
/// impl Engine {
///     #[bridge::lifecycle(create)]
///     pub fn new(config: Config) -> Result<Self, MyError> { ... }
///     #[bridge::read]
///     pub fn get(&self, key: &str) -> Result<String, MyError> { ... }
/// }
/// ```
#[proc_macro_attribute]
pub fn api(attr: TokenStream, item: TokenStream) -> TokenStream {
    let item_impl = parse_macro_input!(item as syn::ItemImpl);

    let args = match parse::parse_api_attr(attr.into()) {
        Ok(v) => v,
        Err(e) => return e.to_compile_error().into(),
    };

    match parse::parse_impl_block(
        &item_impl,
        args.service,
        args.group,
        args.fn_prefix,
        args.crate_path,
        args.extras,
    ) {
        Ok(desc) => {
            let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let descriptor_macro = emit::emit_descriptor(&desc, counter);
            let cleaned = strip_bridge_attrs(&item_impl);

            let output = quote! {
                #cleaned
                #descriptor_macro
            };
            output.into()
        }
        Err(e) => e.to_compile_error().into(),
    }
}

/// Strip `#[bridge::*]` attributes from methods so they don't trigger expansion.
fn strip_bridge_attrs(item: &syn::ItemImpl) -> proc_macro2::TokenStream {
    let mut item = item.clone();
    for impl_item in &mut item.items {
        if let syn::ImplItem::Fn(method) = impl_item {
            method.attrs.retain(|attr| !parse::is_bridge_attr(attr));
            for arg in &mut method.sig.inputs {
                if let syn::FnArg::Typed(pat_type) = arg {
                    pat_type.attrs.retain(|attr| !parse::is_bridge_attr(attr));
                }
            }
        }
    }
    quote! { #item }
}

// --- Pass-through attributes for method-level annotations ---
// These exist so `#[bridge::read]` etc. are valid syntax.
// The real processing happens in `#[bridge::api]` above.

#[proc_macro_attribute]
pub fn read(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn write(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn structural(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn pure(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn tagged_enum(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn lifecycle(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn async_read(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn async_write(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn skip(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn extra(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn target(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}

#[proc_macro_attribute]
pub fn parse(_attr: TokenStream, item: TokenStream) -> TokenStream {
    item
}
