use super::*;

pub(super) fn expand_descriptor(desc: &TauriDescriptor) -> TokenStream {
    let is_service = desc.service.is_some();
    let type_name = &desc.type_name;
    let type_snake = to_snake_case(&type_name.to_string());
    let has_type_prefix = *type_name != "_";

    // Compute the effective prefix for generated function names.
    // fn_prefix overrides the default type_snake prefix.
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(), // explicit empty = no prefix
        None => {
            if has_type_prefix {
                type_snake.clone()
            } else {
                String::new()
            }
        }
    };

    // Only the "primary" descriptor (the one that declares a non-skipped
    // lifecycle create) emits infrastructure: registry type, destroy command.
    // Secondary descriptors for the same service type only emit method functions.
    let declares_lifecycle = desc.methods.iter().any(|m| {
        matches!(
            m.access,
            TauriAccess::LifecycleCreate | TauriAccess::LifecycleCreateFrom { .. }
        ) && !m.skip_targets.contains(&"tauri".to_string())
    });

    let mut command_fns = Vec::new();

    // For service mode, generate the registry type and the state alias
    // ONLY if this descriptor has lifecycle create (primary descriptor).
    let registry_def = if is_service && declares_lifecycle {
        let registry_ident = format_ident!("{}Registry", type_name);
        quote! {
            pub struct TauriRegistry<T: Send + Sync + 'static> {
                inner: parking_lot::RwLock<std::collections::HashMap<String, T>>,
            }

            impl<T: Send + Sync + 'static> TauriRegistry<T> {
                pub fn new() -> Self {
                    Self {
                        inner: parking_lot::RwLock::new(std::collections::HashMap::new()),
                    }
                }

                pub fn insert(&self, key: String, value: T) {
                    self.inner.write().insert(key, value);
                }

                pub fn remove(&self, key: &str) -> Option<T> {
                    self.inner.write().remove(key)
                }

                pub fn with_read<F, R>(&self, key: &str, f: F) -> Result<R, String>
                where
                    F: FnOnce(&T) -> R,
                {
                    let guard = self.inner.read();
                    let value = guard.get(key).ok_or_else(|| {
                        format!("instance not found: {}", key)
                    })?;
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        f(value)
                    }))
                    .map_err(|_| "Internal panic".to_string())
                }

                pub fn with_write<F, R>(&self, key: &str, f: F) -> Result<R, String>
                where
                    F: FnOnce(&mut T) -> R,
                {
                    let mut guard = self.inner.write();
                    let value = guard.get_mut(key).ok_or_else(|| {
                        format!("instance not found: {}", key)
                    })?;
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        f(value)
                    }))
                    .map_err(|_| "Internal panic".to_string())
                }

                /// Clone a service instance out of the registry for async use.
                ///
                /// The lock is acquired only long enough to clone the value, then
                /// released before the caller `.await`s — avoiding the `!Send`
                /// problem with `parking_lot::RwLock` guards across await points.
                pub fn clone_for_async(&self, key: &str) -> Result<T, String>
                where
                    T: Clone,
                {
                    let guard = self.inner.read();
                    let value = guard.get(key).ok_or_else(|| {
                        format!("instance not found: {}", key)
                    })?;
                    Ok(value.clone())
                }
            }

            pub type #registry_ident = TauriRegistry<#type_name>;
        }
    } else {
        TokenStream::new()
    };

    // Generate each method, collecting command function names for the handlers macro.
    let mut command_names: Vec<Ident> = Vec::new();

    for method in &desc.methods {
        if method.skip_targets.contains(&"tauri".to_string()) {
            continue;
        }
        let (fn_tokens, fn_name) = expand_method(desc, method, &effective_prefix);
        command_fns.push(fn_tokens);
        command_names.push(fn_name);
    }

    // For service mode, also generate a destroy command (only in primary descriptor)
    if is_service
        && declares_lifecycle
        && let Some(ref svc) = desc.service
    {
        let key_param_ident = format_ident!("{}", svc.key_param);
        let fn_name = if effective_prefix.is_empty() {
            format_ident!("destroy")
        } else {
            format_ident!("{}_{}", effective_prefix, "destroy")
        };
        let registry_ident = format_ident!("{}Registry", type_name);

        let destroy_fn = if let Some(ref level) = desc.security_level {
            let operation_str = fn_name.to_string();
            quote! {
                #[tauri::command]
                pub async fn #fn_name(
                    state: tauri::State<'_, #registry_ident>,
                    #key_param_ident: String,
                    __sec_timestamp: Option<u64>,
                    __sec_nonce: Option<String>,
                    __sec_signature: Option<String>,
                    window: tauri::Window,
                    app: tauri::AppHandle,
                ) -> Result<(), String> {
                    let _ctx = crate::security::verify_request(
                        crate::security::SecurityLevel::#level,
                        #operation_str,
                        __sec_timestamp.unwrap_or(0),
                        &__sec_nonce.as_deref().unwrap_or(""),
                        &__sec_signature.as_deref().unwrap_or(""),
                        &window,
                        &app,
                    ).await?;
                    state.remove(&#key_param_ident);
                    Ok(())
                }
            }
        } else {
            quote! {
                #[tauri::command]
                pub async fn #fn_name(
                    state: tauri::State<'_, #registry_ident>,
                    #key_param_ident: String,
                ) -> Result<(), String> {
                    state.remove(&#key_param_ident);
                    Ok(())
                }
            }
        };
        command_fns.push(destroy_fn);
        command_names.push(fn_name);
    }

    // Wrap all generated code in a module to isolate Tauri's internal
    // `__cmd__*` macro definitions which otherwise conflict at module scope.
    let mod_name = format_ident!("__bridge_{}_{}", type_snake, desc.group);

    // Emit a helper macro that expands to the comma-separated list of
    // fully-qualified command handler paths for `tauri::generate_handler![]`.
    let handlers_macro_name = format_ident!("__bridge_handlers_{}_{}", type_snake, desc.group);
    let qualified_names: Vec<TokenStream> = command_names
        .iter()
        .map(|name| quote! { #mod_name::#name })
        .collect();

    quote! {
        mod #mod_name {
            use super::*;
            #registry_def
            #(#command_fns)*
        }
        pub use #mod_name::*;

        #[doc(hidden)]
        #[macro_export]
        macro_rules! #handlers_macro_name {
            () => {
                #(#qualified_names),*
            };
        }
    }
}
