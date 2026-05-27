use super::*;

pub(super) fn expand(desc: &PyO3Descriptor) -> TokenStream {
    let type_snake = to_snake_case(&desc.type_name);
    let type_ident = format_ident!("{}", desc.type_name);

    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),
        None => type_snake.clone(),
    };

    let mut output = TokenStream::new();

    // In free-function mode, all methods become #[pyfunction]
    for method in &desc.methods {
        if method.skip_targets.contains(&"pyo3".to_string()) {
            continue;
        }
        output.extend(emit_pure_function(method, &effective_prefix, &type_ident));
    }

    output
}

/// Emit a pure (stateless) function as a `#[pyfunction]`.
pub(super) fn emit_pure_function(
    method: &PyO3Method,
    type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let method_ident = format_ident!("{}", method.name);

    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let (return_type_tokens, result_conversion) =
        build_return_handling(&method.return_type, method.is_fallible);

    let call_expr = if method.is_fallible {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*)
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
        }
    } else {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*);
        }
    };

    quote! {
        #[pyo3::pyfunction]
        pub fn #fn_name(#(#py_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #call_expr
            #result_conversion
        }
    }
}
