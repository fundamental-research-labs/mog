/// Re-export the proc macros so `bridge_napi::__expand` resolves.
pub use bridge_napi_macros::__expand;

/// Re-export the class-based proc macro so `bridge_napi::__expand_class` resolves.
pub use bridge_napi_macros::__expand_class;

/// Re-export the class generator proc macro so `bridge_napi::__generate_class` resolves.
pub use bridge_napi_macros::__generate_class;

/// Re-export bridge_types so generated code can reference `bridge_types::BridgeParse`.
pub use bridge_types;

/// Generate napi-rs `#[napi]` functions from bridge descriptor macros.
///
/// # Usage
///
/// ```ignore
/// bridge_napi::generate!(
///     compute_core::__bridge_descriptor_YrsComputeEngine_core,
///     compute_core::__bridge_descriptor_YrsComputeEngine_viewport,
/// );
/// ```
///
/// Each descriptor macro is invoked with `bridge_napi::__expand` as the callback,
/// which parses the descriptor tokens and emits napi-specific code including:
///
/// - `#[napi]` functions for each bridge method
/// - `DashMap` registries for stateful services
/// - `__with_read_*` / `__with_write_*` helper functions
/// - `*_destroy` functions for service cleanup
#[macro_export]
macro_rules! generate {
    ($($desc:path),+ $(,)?) => {
        $($desc!(bridge_napi::__expand);)*
    };
}

/// Generate class-based napi-rs bindings from bridge descriptor macros.
///
/// Emits a `#[napi]` struct wrapper and `#[napi] impl` blocks with instance methods.
/// No registry, no destroy function — Rust `Drop` handles cleanup automatically.
///
/// # Usage
///
/// ```ignore
/// bridge_napi::generate_class!(
///     struct ComputeEngine(compute_core::storage::engine::YrsComputeEngine);
///     compute_core::__bridge_descriptor_YrsComputeEngine_core,
///     compute_core::__bridge_descriptor_YrsComputeEngine_viewport,
/// );
/// ```
///
/// This generates:
/// - `#[napi] pub struct ComputeEngine { pub(crate) inner: YrsComputeEngine }`
/// - `#[napi] impl ComputeEngine { ... }` blocks with `&self` / `&mut self` methods
/// - Pure methods stay as free functions
#[macro_export]
macro_rules! generate_class {
    ($($tt:tt)*) => {
        bridge_napi::__generate_class!{ $($tt)* }
    };
}
