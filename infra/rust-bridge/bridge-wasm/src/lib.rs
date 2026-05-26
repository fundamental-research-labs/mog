/// Re-export the proc macro so `bridge_wasm::__expand` resolves.
pub use bridge_wasm_macros::__expand;

/// Re-export bridge_types so generated code can reference `bridge_types::BridgeParse`.
pub use bridge_types;

/// Generate WASM `#[wasm_bindgen]` functions from bridge descriptor macros.
///
/// # Usage
///
/// ```ignore
/// bridge_wasm::generate!(
///     kv::__bridge_descriptor_KvUtils_0,
///     kv::__bridge_descriptor_KvStore_ops,
///     kv::__bridge_descriptor_KvStore_admin,
/// );
/// ```
///
/// Each descriptor macro is invoked with `bridge_wasm::__expand` as the callback,
/// which parses the descriptor tokens and emits WASM-specific code including:
///
/// - `#[wasm_bindgen]` functions for each bridge method
/// - Thread-local registries for stateful services
/// - `__with_read_*` / `__with_write_*` helper functions
/// - `*_destroy` functions for service cleanup
#[macro_export]
macro_rules! generate {
    ($($desc:path),+ $(,)?) => {
        $($desc!(bridge_wasm::__expand);)*
    };
}
