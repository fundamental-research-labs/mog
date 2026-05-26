//! Class-based napi code generation. Emits `#[napi] impl ClassName { ... }`
//! blocks with `&self` / `&mut self` methods (pure methods stay as free
//! functions) instead of the registry + free-function shape used by the
//! service path in `expand_fn.rs`.

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};
use syn::Token;
use syn::parse::{Parse, ParseStream};

use crate::classify::{is_direct_return, to_snake_case};
use crate::expand_fn::{build_params_and_conversions, build_return_handling, emit_pure_method};
use crate::ir::{NapiAccess, NapiDescriptor, NapiMethod};

/// Parse `__class_name = ClassName; <descriptor tokens>` and generate
/// class-based napi bindings.
pub(crate) fn parse_and_expand_class(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: ClassExpandInput = syn::parse2(input)?;
    let desc: NapiDescriptor = syn::parse2(parsed.descriptor_tokens)?;
    Ok(expand_class(&parsed.class_name, &desc))
}

/// Input for `__expand_class`: `__class_name = ClassName; <descriptor tokens>`.
struct ClassExpandInput {
    class_name: String,
    descriptor_tokens: proc_macro2::TokenStream,
}

impl Parse for ClassExpandInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // __class_name = ClassName;
        let kw: Ident = input.parse()?;
        if kw != "__class_name" {
            return Err(syn::Error::new(kw.span(), "expected '__class_name'"));
        }
        let _: Token![=] = input.parse()?;
        let class_ident: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        // Remaining tokens are the descriptor
        let descriptor_tokens: proc_macro2::TokenStream = input.parse()?;

        Ok(ClassExpandInput {
            class_name: class_ident.to_string(),
            descriptor_tokens,
        })
    }
}

/// Generate class-based napi code from a `NapiDescriptor`.
///
/// Instead of a registry + free functions, this emits:
/// - `#[napi] impl ClassName { ... }` blocks with `&self` / `&mut self` methods
/// - Pure methods stay as free functions (outside the impl block)
/// - No registry, no destroy, no `__with_read_*` / `__with_write_*` helpers
///
/// The struct definition is NOT emitted here — it's emitted by `generate_class!`.
pub(crate) fn expand_class(class_name: &str, desc: &NapiDescriptor) -> TokenStream {
    let class_ident = format_ident!("{}", class_name);
    let type_ident = format_ident!("{}", desc.type_name);

    // Compute effective prefix for method naming
    let type_snake = to_snake_case(&desc.type_name);
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),   // explicit empty = no prefix
        None => type_snake.clone(), // default behavior
    };

    let mut impl_methods = Vec::new();
    let mut pure_functions = TokenStream::new();
    let mut has_self_tuple_lifecycle = false;

    for method in &desc.methods {
        if method.skip_targets.contains(&"napi".to_string()) {
            continue;
        }
        match method.access {
            NapiAccess::LifecycleCreate => {
                // Track if any lifecycle create returns (Self, T)
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_constructor(
                    method,
                    &effective_prefix,
                    &type_ident,
                ));
            }
            NapiAccess::LifecycleCreateFrom { ref variant_name } => {
                // Track if returns (Self, T)
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_factory_method(
                    method,
                    &effective_prefix,
                    &type_ident,
                    variant_name,
                ));
            }
            NapiAccess::Read => {
                impl_methods.push(emit_class_method(method, &effective_prefix, false));
            }
            NapiAccess::Write => {
                impl_methods.push(emit_class_method(method, &effective_prefix, true));
            }
            NapiAccess::Pure => {
                pure_functions.extend(emit_pure_method(
                    desc,
                    method,
                    &effective_prefix,
                    &type_ident,
                ));
            }
        }
    }

    // If any lifecycle create returns (Self, T), add the accessor method
    if has_self_tuple_lifecycle {
        impl_methods.push(emit_take_lifecycle_result_method());
    }

    let mut output = TokenStream::new();

    // Emit impl block with all service methods (if any)
    if !impl_methods.is_empty() {
        output.extend(quote! {
            #[napi_derive::napi]
            impl #class_ident {
                #(#impl_methods)*
            }
        });
    }

    // Emit pure methods as free functions
    output.extend(pure_functions);

    output
}

/// Emit a constructor method for the class.
///
/// The lifecycle create method becomes `#[napi(constructor)]` and returns
/// `napi::Result<Self>` with `Self { inner: ... }`.
///
/// When the constructor returns `(Self, T)`, the extra data is stashed in
/// `__lifecycle_result: Option<String>` (serde-serialized JSON). The caller
/// retrieves it via the generated `take_lifecycle_result` accessor method.
fn emit_class_constructor(
    method: &NapiMethod,
    _type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // Check if the lifecycle create returns (Self, T)
    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        // (Self, T) variant: destructure the tuple, stash the extra data
        // as serialized JSON in `__lifecycle_result`.
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        // Use short-form `napi` for inner method attributes — the outer
        // `#[napi_derive::napi]` on the impl block consumes these as helper
        // attributes before the compiler tries to resolve them.
        quote! {
            #[napi(constructor)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| napi::Error::from_reason(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        // Plain Self variant
        let call_expr = if method.is_fallible {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        // Use short-form `napi` for inner method attributes — the outer
        // `#[napi_derive::napi]` on the impl block consumes these as helper
        // attributes before the compiler tries to resolve them.
        quote! {
            #[napi(constructor)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self { inner: instance, __lifecycle_result: None })
            }
        }
    }
}

/// Emit a factory method for the class (for create_from lifecycle).
///
/// Unlike the constructor, this generates a `#[napi(factory)]` static method
/// that returns `napi::Result<Self>`.
fn emit_class_factory_method(
    method: &NapiMethod,
    _type_snake: &str,
    type_ident: &Ident,
    _variant_name: &str,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi(factory)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| napi::Error::from_reason(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        let call_expr = if method.is_fallible {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi(factory)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: None,
                })
            }
        }
    }
}

/// Emit a `take_lifecycle_result` accessor method for class-mode lifecycle
/// creates that return `(Self, T)`. This allows the caller to retrieve
/// the stashed auxiliary data after construction.
fn emit_take_lifecycle_result_method() -> TokenStream {
    quote! {
        #[napi]
        pub fn take_lifecycle_result(&mut self) -> Option<String> {
            self.__lifecycle_result.take()
        }
    }
}

/// Emit a class instance method (&self for read, &mut self for write).
fn emit_class_method(method: &NapiMethod, type_snake: &str, is_write: bool) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let js_name = if type_snake.is_empty() {
        method.name.clone()
    } else {
        format!("{}_{}", type_snake, method.name)
    };
    let js_name_lit = syn::LitStr::new(&js_name, proc_macro2::Span::call_site());

    let (return_type_tokens, _) = build_return_handling(&method.return_type, true);

    let self_param = if is_write {
        quote! { &mut self }
    } else {
        quote! { &self }
    };

    let await_suffix = if method.is_async {
        quote! { .await }
    } else {
        quote! {}
    };

    let inner_call = if method.is_fallible {
        quote! {
            self.inner.#method_ident(#(#call_args),*) #await_suffix
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?
        }
    } else {
        quote! {
            self.inner.#method_ident(#(#call_args),*) #await_suffix
        }
    };

    // Determine how to handle the return value
    let needs_serde_return = method
        .return_type
        .as_ref()
        .map(|r| !is_direct_return(r))
        .unwrap_or(false);

    let needs_bytes_tuple_return = method
        .return_type
        .as_ref()
        .map(|r| r.is_bytes_tuple)
        .unwrap_or(false);

    let needs_bytes_return = method
        .return_type
        .as_ref()
        .map(|r| r.is_bytes)
        .unwrap_or(false);

    let body = if needs_serde_return {
        quote! {
            #(#conversion_stmts)*
            let result = #inner_call;
            serde_json::to_string(&result)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))
        }
    } else if needs_bytes_tuple_return {
        quote! {
            #(#conversion_stmts)*
            let result = #inner_call;
            let (bytes, metadata) = result;
            let meta_json = serde_json::to_string(&metadata)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            let json_bytes = meta_json.as_bytes();
            let mut packed = Vec::with_capacity(4 + bytes.len() + json_bytes.len());
            packed.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            packed.extend_from_slice(&bytes);
            packed.extend_from_slice(json_bytes);
            Ok(napi::bindgen_prelude::Buffer::from(packed))
        }
    } else if needs_bytes_return {
        quote! {
            #(#conversion_stmts)*
            let result = #inner_call;
            Ok(napi::bindgen_prelude::Buffer::from(result))
        }
    } else {
        let has_return = method.return_type.is_some();
        if has_return {
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                Ok(result)
            }
        } else {
            quote! {
                #(#conversion_stmts)*
                #inner_call;
                Ok(())
            }
        }
    };

    // Use short-form `napi` for inner method attributes — the outer
    // `#[napi_derive::napi]` on the impl block consumes these as helper
    // attributes before the compiler tries to resolve them.
    if method.is_async {
        quote! {
            #[napi(js_name = #js_name_lit)]
            pub async fn #method_ident(#self_param, #(#napi_params),*) -> #return_type_tokens {
                #body
            }
        }
    } else {
        quote! {
            #[napi(js_name = #js_name_lit)]
            pub fn #method_ident(#self_param, #(#napi_params),*) -> #return_type_tokens {
                #body
            }
        }
    }
}

// ---------------------------------------------------------------------------
// `generate_class!` parsing and code generation
// ---------------------------------------------------------------------------

/// Input for `__generate_class`:
/// `struct ClassName(path::to::InnerType); desc1, desc2, ...`
pub(crate) struct GenerateClassInput {
    pub class_name: Ident,
    pub inner_type: syn::Path,
    pub descriptors: Vec<syn::Path>,
}

impl Parse for GenerateClassInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // struct keyword
        let _: Token![struct] = input.parse()?;
        let class_name: Ident = input.parse()?;

        // (InnerType)
        let content;
        syn::parenthesized!(content in input);
        let inner_type: syn::Path = content.parse()?;

        // ;  (cargo fmt may insert a trailing comma after the semicolon)
        let _: Token![;] = input.parse()?;
        let _ = input.parse::<Option<Token![,]>>();

        // descriptor paths, comma-separated
        let descriptors =
            syn::punctuated::Punctuated::<syn::Path, Token![,]>::parse_terminated(input)?;

        Ok(GenerateClassInput {
            class_name,
            inner_type,
            descriptors: descriptors.into_iter().collect(),
        })
    }
}

/// Generate a `#[napi]` struct definition and dispatch descriptor macros
/// through `__expand_class`.
pub(crate) fn generate_class_impl(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: GenerateClassInput = syn::parse2(input)?;

    let class_ident = &parsed.class_name;
    let inner_path = &parsed.inner_type;
    let callback_name = format_ident!("__napi_class_expand_{}", class_ident);

    // We need to emit a `$` inside a macro_rules body, but `quote!` can't
    // produce raw `$`. Use a proc_macro2 Punct token directly.
    let dollar = proc_macro2::Punct::new('$', proc_macro2::Spacing::Alone);

    let mut output = quote! {
        #[napi_derive::napi]
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
                bridge_napi::__expand_class!{ __class_name = #class_ident; #dollar ( #dollar tt)* }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::{
        NapiAccess, NapiDescriptor, NapiMethod, NapiParam, NapiParamTag, NapiServiceMeta,
        ReturnInfo,
    };

    #[test]
    fn expand_class_produces_impl_block() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![NapiParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should contain impl MyEngine { ... } not free functions
        assert!(
            code.contains("impl MyEngine"),
            "expected impl block in output: {}",
            code
        );
        // Method should be inside the impl block (uses self)
        assert!(
            code.contains("& self"),
            "expected &self in output: {}",
            code
        );
    }

    #[test]
    fn expand_class_lifecycle_creates_constructor() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![NapiParam {
                    name: "config".to_string(),
                    ty: "KvConfig".to_string(),
                    tag: NapiParamTag::Serde,
                }],
                return_type: None,
                error_type: Some("KvError".to_string()),
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should contain #[napi(constructor)]
        assert!(
            code.contains("constructor"),
            "expected constructor attribute in output: {}",
            code
        );
        // Should return Self
        assert!(
            code.contains("Self"),
            "expected Self in constructor return: {}",
            code
        );
        // Should contain inner
        assert!(
            code.contains("inner"),
            "expected inner field assignment: {}",
            code
        );
    }

    #[test]
    fn expand_class_read_uses_self_ref() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Read,
                name: "get".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Read methods should use &self
        assert!(
            code.contains("& self"),
            "expected &self for read method: {}",
            code
        );
        // Should NOT contain &mut self
        assert!(
            !code.contains("& mut self"),
            "read method should not have &mut self: {}",
            code
        );
    }

    #[test]
    fn expand_class_write_uses_mut_self() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Write,
                name: "set".to_string(),
                params: vec![NapiParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Write methods should use &mut self
        assert!(
            code.contains("& mut self"),
            "expected &mut self for write method: {}",
            code
        );
    }

    #[test]
    fn expand_class_pure_stays_free_function() {
        let desc = NapiDescriptor {
            type_name: "KvUtils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![
                NapiMethod {
                    access: NapiAccess::Read,
                    name: "get".to_string(),
                    params: vec![],
                    return_type: Some(ReturnInfo {
                        ty: "String".to_string(),
                        is_string: true,
                        is_prim: false,
                        is_bytes: false,
                        is_unit: false,
                        is_bytes_tuple: false,
                        serde_inner_ty: None,
                        is_self_tuple: false,
                        self_tuple_inner_ty: None,
                    }),
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
                NapiMethod {
                    access: NapiAccess::Pure,
                    name: "hash_key".to_string(),
                    params: vec![NapiParam {
                        name: "key".to_string(),
                        ty: "&str".to_string(),
                        tag: NapiParamTag::Str,
                    }],
                    return_type: Some(ReturnInfo {
                        ty: "u64".to_string(),
                        is_string: false,
                        is_prim: true,
                        is_bytes: false,
                        is_unit: false,
                        is_bytes_tuple: false,
                        serde_inner_ty: None,
                        is_self_tuple: false,
                        self_tuple_inner_ty: None,
                    }),
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
            ],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Pure method should be a free function (contains fn name with prefix, no self)
        assert!(
            code.contains("kv_utils_hash_key"),
            "expected free function name in output: {}",
            code
        );
        // Instance method should be in impl block
        assert!(
            code.contains("impl MyEngine"),
            "expected impl block for read method: {}",
            code
        );
    }

    #[test]
    fn expand_class_no_registry() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![
                NapiMethod {
                    access: NapiAccess::LifecycleCreate,
                    name: "new".to_string(),
                    params: vec![],
                    return_type: None,
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
                NapiMethod {
                    access: NapiAccess::Read,
                    name: "get".to_string(),
                    params: vec![],
                    return_type: Some(ReturnInfo {
                        ty: "String".to_string(),
                        is_string: true,
                        is_prim: false,
                        is_bytes: false,
                        is_unit: false,
                        is_bytes_tuple: false,
                        serde_inner_ty: None,
                        is_self_tuple: false,
                        self_tuple_inner_ty: None,
                    }),
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
            ],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should NOT contain DashMap, LazyLock, or registry
        assert!(
            !code.contains("DashMap"),
            "should not contain DashMap: {}",
            code
        );
        assert!(
            !code.contains("LazyLock"),
            "should not contain LazyLock: {}",
            code
        );
        assert!(
            !code.contains("__REGISTRY"),
            "should not contain registry: {}",
            code
        );
    }

    #[test]
    fn expand_class_no_destroy() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should NOT contain destroy function
        assert!(
            !code.contains("destroy"),
            "should not contain destroy: {}",
            code
        );
    }

    #[test]
    fn expand_class_js_name_attribute() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Read,
                name: "get_value".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should contain js_name attribute with the prefixed name
        assert!(
            code.contains("kv_store_get_value"),
            "expected js_name with prefixed name: {}",
            code
        );
        assert!(
            code.contains("js_name"),
            "expected js_name attribute: {}",
            code
        );
    }

    #[test]
    fn expand_class_skip_napi_method() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![
                NapiMethod {
                    access: NapiAccess::LifecycleCreate,
                    name: "new".to_string(),
                    params: vec![],
                    return_type: None,
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: vec!["napi".to_string()],
                },
                NapiMethod {
                    access: NapiAccess::Read,
                    name: "get".to_string(),
                    params: vec![],
                    return_type: Some(ReturnInfo {
                        ty: "String".to_string(),
                        is_string: true,
                        is_prim: false,
                        is_bytes: false,
                        is_unit: false,
                        is_bytes_tuple: false,
                        serde_inner_ty: None,
                        is_self_tuple: false,
                        self_tuple_inner_ty: None,
                    }),
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
            ],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Constructor should be skipped
        assert!(
            !code.contains("constructor"),
            "skipped lifecycle should not emit constructor: {}",
            code
        );
        // Read method should still be present
        assert!(
            code.contains("get"),
            "read method should still be present: {}",
            code
        );
        assert!(
            code.contains("& self"),
            "read method should use &self: {}",
            code
        );
    }

    #[test]
    fn expand_class_serde_params_work() {
        let desc = NapiDescriptor {
            type_name: "Svc".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Write,
                name: "update".to_string(),
                params: vec![NapiParam {
                    name: "config".to_string(),
                    ty: "MyConfig".to_string(),
                    tag: NapiParamTag::Serde,
                }],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Serde params should use serde_json::from_str
        assert!(
            code.contains("serde_json :: from_str"),
            "expected serde_json::from_str in class method: {}",
            code
        );
        // Param should be String
        assert!(
            code.contains("config : String"),
            "expected String param for serde in class method: {}",
            code
        );
    }

    #[test]
    fn expand_class_custom_prefix() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: Some("compute".to_string()),
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Read,
                name: "get_value".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should use custom prefix in js_name
        assert!(
            code.contains("compute_get_value"),
            "expected custom prefix in js_name: {}",
            code
        );
    }

    #[test]
    fn expand_class_serde_return() {
        let desc = NapiDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Read,
                name: "get_stats".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "EngineStats".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Serde return should use serde_json::to_string
        assert!(
            code.contains("serde_json :: to_string"),
            "expected serde_json::to_string in class method: {}",
            code
        );
        // Should access self.inner
        assert!(
            code.contains("self . inner"),
            "expected self.inner access: {}",
            code
        );
    }

    #[test]
    fn expand_class_bytes_tuple_return() {
        let desc = NapiDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Write,
                name: "apply".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "(Vec<u8>, MutationMeta)".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: true,
                    serde_inner_ty: Some("MutationMeta".to_string()),
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should handle bytes tuple return with Buffer
        assert!(
            code.contains("Buffer"),
            "expected Buffer in bytes-tuple return: {}",
            code
        );
        assert!(
            code.contains("& mut self"),
            "expected &mut self for write: {}",
            code
        );
    }

    #[test]
    fn generate_class_input_parses() {
        let input: proc_macro2::TokenStream = quote! {
            struct ComputeEngine(some::path::Inner);
            some::path::descriptor_a,
            some::path::descriptor_b,
        };
        let parsed: GenerateClassInput = syn::parse2(input).unwrap();
        assert_eq!(parsed.class_name.to_string(), "ComputeEngine");
        assert_eq!(parsed.descriptors.len(), 2);
    }

    #[test]
    fn generate_class_impl_emits_struct_and_macro() {
        let input: proc_macro2::TokenStream = quote! {
            struct MyEngine(path::to::Inner);
            path::to::desc_a,
        };
        let tokens = generate_class_impl(input).unwrap();
        let code = tokens.to_string();
        // Should emit struct definition with #[napi]
        assert!(
            code.contains("pub struct MyEngine"),
            "expected struct definition: {}",
            code
        );
        assert!(
            code.contains("pub (crate) inner"),
            "expected pub(crate) inner field: {}",
            code
        );
        // Should emit callback macro
        assert!(
            code.contains("__napi_class_expand_MyEngine"),
            "expected callback macro: {}",
            code
        );
        // Should invoke descriptor with callback
        assert!(
            code.contains("desc_a"),
            "expected descriptor invocation: {}",
            code
        );
    }

    #[test]
    fn async_class_method_emits_async_fn() {
        let desc = NapiDescriptor {
            type_name: "DbDriver".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::Read,
                name: "query".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: Some("DbError".to_string()),
                is_fallible: true,
                is_async: true,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyDbDriver", &desc);
        let code = tokens.to_string();
        // Should emit `pub async fn` in class impl
        assert!(
            code.contains("pub async fn query"),
            "expected pub async fn in class method: {}",
            code
        );
        // Should contain .await on self.inner call (token stream renders as ". await")
        assert!(
            code.contains(". await"),
            "expected .await in class async method: {}",
            code
        );
        // Should still use &self (read access)
        assert!(
            code.contains("& self"),
            "expected &self for read method: {}",
            code
        );
    }

    #[test]
    fn class_lifecycle_create_self_tuple_stashes_result() {
        let desc = NapiDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "engine_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "(Self, InitData)".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: true,
                    self_tuple_inner_ty: Some("InitData".to_string()),
                }),
                error_type: None,
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyEngine", &desc);
        let code = tokens.to_string();
        // Should have constructor attribute
        assert!(
            code.contains("constructor"),
            "expected constructor attribute: {}",
            code
        );
        // Should stash the lifecycle result
        assert!(
            code.contains("__lifecycle_result"),
            "expected __lifecycle_result field assignment: {}",
            code
        );
        // Should destructure the tuple
        assert!(
            code.contains("__inner"),
            "expected __inner destructure: {}",
            code
        );
        assert!(
            code.contains("__data"),
            "expected __data destructure: {}",
            code
        );
        // Should serialize with serde_json
        assert!(
            code.contains("serde_json :: to_string"),
            "expected serde_json serialization: {}",
            code
        );
        // Should emit take_lifecycle_result accessor
        assert!(
            code.contains("take_lifecycle_result"),
            "expected take_lifecycle_result method: {}",
            code
        );
    }

    #[test]
    fn class_plain_lifecycle_has_no_take_lifecycle_result() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("MyKvStore", &desc);
        let code = tokens.to_string();
        // Plain Self constructor should NOT emit take_lifecycle_result
        assert!(
            !code.contains("take_lifecycle_result"),
            "plain constructor should not emit take_lifecycle_result: {}",
            code
        );
    }

    #[test]
    fn generate_class_struct_includes_lifecycle_result_field() {
        let input: proc_macro2::TokenStream = quote! {
            struct MyEngine(path::to::Inner);
            path::to::desc_a,
        };
        let tokens = generate_class_impl(input).unwrap();
        let code = tokens.to_string();
        // Should emit the __lifecycle_result field
        assert!(
            code.contains("__lifecycle_result"),
            "expected __lifecycle_result field in struct: {}",
            code
        );
        // Should still have inner field
        assert!(
            code.contains("pub (crate) inner"),
            "expected inner field: {}",
            code
        );
    }
}
