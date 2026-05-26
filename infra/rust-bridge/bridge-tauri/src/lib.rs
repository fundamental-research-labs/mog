/// Re-export the proc macro so `bridge_tauri::__expand` resolves.
pub use bridge_tauri_macros::__expand;

/// Re-export bridge_types so generated code can reference `bridge_types::BridgeParse`.
pub use bridge_types;

/// Generate Tauri `#[tauri::command]` functions from bridge descriptor macros.
///
/// # Usage
///
/// ```ignore
/// // Without security:
/// bridge_tauri::generate!(
///     kv::__bridge_descriptor_KvUtils_0,
///     kv::__bridge_descriptor_KvStore_ops,
///     kv::__bridge_descriptor_KvStore_admin,
/// );
///
/// // With security level:
/// bridge_tauri::generate!(
///     xlsx_api::__bridge_descriptor_XlsxParser_0;
///     security_level = Sensitive
/// );
/// ```
///
/// When `security_level` is specified, each generated command gets extra parameters
/// (`__sec_timestamp`, `__sec_nonce`, `__sec_signature`, `window`, `app`) and a
/// `verify_request()` call is prepended to enforce the security level.
///
/// Each descriptor macro is invoked with `bridge_tauri::__expand` as the callback,
/// which parses the descriptor tokens and emits Tauri-specific code including:
///
/// - `#[tauri::command]` async functions for each bridge method
/// - A `TauriRegistry<T>` struct for stateful services (using `parking_lot::RwLock`)
/// - A `commands()` function returning `tauri::generate_handler![...]`
/// - `catch_unwind` wrapping for panic safety
#[macro_export]
macro_rules! generate {
    // Descriptor paths only (no security).
    ($($desc:path),+ $(,)?) => {
        $($desc!(bridge_tauri::__expand);)*
    };
    // Descriptor paths + security_level option.
    // The security_level tokens are forwarded through the descriptor macro's
    // second arm and prepended to the token stream that __expand receives.
    ($($desc:path),+ ; security_level = $level:ident) => {
        $($desc!(bridge_tauri::__expand, security_level = $level;);)*
    };
}
