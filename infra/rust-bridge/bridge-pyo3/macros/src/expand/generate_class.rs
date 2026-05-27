use super::*;

/// Input for `__generate_class`:
/// `struct ClassName(path::to::InnerType); desc1, desc2, ...`
pub(super) struct GenerateClassInput {
    pub class_name: Ident,
    pub inner_type: syn::Path,
    pub descriptors: Vec<syn::Path>,
}

impl Parse for GenerateClassInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let _: Token![struct] = input.parse()?;
        let class_name: Ident = input.parse()?;

        let content;
        syn::parenthesized!(content in input);
        let inner_type: syn::Path = content.parse()?;

        let _: Token![;] = input.parse()?;
        let _ = input.parse::<Option<Token![,]>>();

        let descriptors =
            syn::punctuated::Punctuated::<syn::Path, Token![,]>::parse_terminated(input)?;

        Ok(GenerateClassInput {
            class_name,
            inner_type,
            descriptors: descriptors.into_iter().collect(),
        })
    }
}

/// Generate a `#[pyclass]` struct definition and dispatch descriptor macros
/// through `__expand_class`.
pub(crate) fn generate_class_impl(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: GenerateClassInput = syn::parse2(input)?;

    let class_ident = &parsed.class_name;
    let inner_path = &parsed.inner_type;
    let callback_name = format_ident!("__pyo3_class_expand_{}", class_ident);

    // We need to emit a `$` inside a macro_rules body.
    let dollar = proc_macro2::Punct::new('$', proc_macro2::Spacing::Alone);

    let mut output = quote! {
        #[pyo3::pyclass]
        pub struct #class_ident {
            pub(crate) inner: #inner_path,
            /// Stash for auxiliary data returned by `(Self, T)` lifecycle creates.
            /// Populated by the constructor when the Rust create method returns a
            /// tuple, and retrieved via `take_lifecycle_result()`. Always `None`
            /// for plain `Self` constructors.
            pub(crate) __lifecycle_result: Option<String>,
        }

        macro_rules! #callback_name {
            (#dollar ( #dollar tt:tt)*) => {
                bridge_pyo3::__expand_class!{ __class_name = #class_ident; #dollar ( #dollar tt)* }
            }
        }
    };

    for desc_path in &parsed.descriptors {
        output.extend(quote! {
            #desc_path!(#callback_name);
        });
    }

    Ok(output)
}

// ---------------------------------------------------------------------------
// Parameter and return type helpers
