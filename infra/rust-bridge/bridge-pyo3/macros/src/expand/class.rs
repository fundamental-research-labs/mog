use super::*;

pub(crate) fn parse_and_expand_class(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: ClassExpandInput = syn::parse2(input)?;
    let desc: PyO3Descriptor = syn::parse2(parsed.descriptor_tokens)?;
    Ok(expand_class(&parsed.class_name, &desc))
}

/// Input for `__expand_class`: `__class_name = ClassName; <descriptor tokens>`.
struct ClassExpandInput {
    class_name: String,
    descriptor_tokens: proc_macro2::TokenStream,
}

impl Parse for ClassExpandInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let kw: Ident = input.parse()?;
        if kw != "__class_name" {
            return Err(syn::Error::new(kw.span(), "expected '__class_name'"));
        }
        let _: Token![=] = input.parse()?;
        let class_ident: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        let descriptor_tokens: proc_macro2::TokenStream = input.parse()?;

        Ok(ClassExpandInput {
            class_name: class_ident.to_string(),
            descriptor_tokens,
        })
    }
}

/// Generate class-based PyO3 code from a `PyO3Descriptor`.
///
/// Emits:
/// - `#[pymethods] impl ClassName { ... }` blocks with `&self` / `&mut self` methods
/// - Pure methods stay as free `#[pyfunction]` functions
/// - No registry, no destroy
///
/// The struct definition is NOT emitted here — it's emitted by `generate_class!`.
pub(super) fn expand_class(class_name: &str, desc: &PyO3Descriptor) -> TokenStream {
    let class_ident = format_ident!("{}", class_name);
    let type_ident = format_ident!("{}", desc.type_name);

    let type_snake = to_snake_case(&desc.type_name);
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),
        None => type_snake.clone(),
    };

    let mut impl_methods = Vec::new();
    let mut pure_functions = TokenStream::new();
    let mut has_self_tuple_lifecycle = false;

    for method in &desc.methods {
        if method.skip_targets.contains(&"pyo3".to_string()) {
            continue;
        }
        match method.access {
            PyO3Access::LifecycleCreate => {
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_constructor(method, &type_ident));
            }
            PyO3Access::LifecycleCreateFrom { ref variant_name } => {
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_factory_method(method, &type_ident, variant_name));
            }
            PyO3Access::Read => {
                impl_methods.push(emit_class_method(method, &effective_prefix, false));
            }
            PyO3Access::Write => {
                impl_methods.push(emit_class_method(method, &effective_prefix, true));
            }
            PyO3Access::Pure => {
                pure_functions.extend(emit_pure_function(method, &effective_prefix, &type_ident));
            }
        }
    }

    // If any lifecycle create returns (Self, T), add the accessor method
    if has_self_tuple_lifecycle {
        impl_methods.push(emit_take_lifecycle_result_method());
    }

    let mut output = TokenStream::new();

    if !impl_methods.is_empty() {
        output.extend(quote! {
            #[pyo3::pymethods]
            impl #class_ident {
                #(#impl_methods)*
            }
        });
    }

    output.extend(pure_functions);

    output
}

/// Emit a `#[new]` constructor method for the class.
fn emit_class_constructor(method: &PyO3Method, type_ident: &Ident) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[new]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        let call_expr = if method.is_fallible {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[new]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self { inner: instance, __lifecycle_result: None })
            }
        }
    }
}

/// Emit a `#[staticmethod]` factory method for create_from lifecycle.
fn emit_class_factory_method(
    method: &PyO3Method,
    type_ident: &Ident,
    _variant_name: &str,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[staticmethod]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        let call_expr = if method.is_fallible {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[staticmethod]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
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

/// Emit a `take_lifecycle_result` accessor method.
fn emit_take_lifecycle_result_method() -> TokenStream {
    quote! {
        pub fn take_lifecycle_result(&mut self) -> Option<String> {
            self.__lifecycle_result.take()
        }
    }
}

/// Emit a class instance method (&self for read, &mut self for write).
fn emit_class_method(method: &PyO3Method, type_snake: &str, is_write: bool) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // PyO3 method name: use pyo3(name = "...") to set the Python-visible name
    let py_name = if type_snake.is_empty() {
        method.name.clone()
    } else {
        format!("{}_{}", type_snake, method.name)
    };
    let py_name_lit = syn::LitStr::new(&py_name, proc_macro2::Span::call_site());

    let self_param = if is_write {
        quote! { &mut self }
    } else {
        quote! { &self }
    };

    let inner_call = if method.is_fallible {
        quote! {
            self.inner.#method_ident(#(#call_args),*)
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?
        }
    } else {
        quote! {
            self.inner.#method_ident(#(#call_args),*)
        }
    };

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

    let (return_type_tokens, body) = if needs_serde_return {
        (
            quote! { pyo3::PyResult<String> },
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                serde_json::to_string(&result)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))
            },
        )
    } else if needs_bytes_tuple_return {
        // Return Python tuple (bytes, str)
        (
            quote! { pyo3::PyResult<(Vec<u8>, String)> },
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                let (bytes, metadata) = result;
                let meta_json = serde_json::to_string(&metadata)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
                Ok((bytes, meta_json))
            },
        )
    } else if needs_bytes_return {
        (
            quote! { pyo3::PyResult<Vec<u8>> },
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                Ok(result)
            },
        )
    } else {
        let has_return = method.return_type.is_some();
        if has_return {
            let ret = method.return_type.as_ref().unwrap();
            let rt = build_pyo3_return_type(ret);
            (
                quote! { pyo3::PyResult<#rt> },
                quote! {
                    #(#conversion_stmts)*
                    let result = #inner_call;
                    Ok(result)
                },
            )
        } else {
            (
                quote! { pyo3::PyResult<()> },
                quote! {
                    #(#conversion_stmts)*
                    #inner_call;
                    Ok(())
                },
            )
        }
    };

    quote! {
        #[pyo3(name = #py_name_lit)]
        pub fn #method_ident(#self_param, #(#py_params),*) -> #return_type_tokens {
            #body
        }
    }
}

// ---------------------------------------------------------------------------
// Code generation — free-function mode (`generate!`)
