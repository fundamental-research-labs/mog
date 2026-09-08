/// Re-export the proc macro so `bridge_delegate::__expand` resolves.
pub use bridge_delegate_macros::__expand;

/// Generate Rust delegate methods on a target type from bridge descriptor macros.
///
/// # Usage
///
/// ```ignore
/// bridge_delegate::delegate!(
///     target = ComputeService,
///     dispatch = dispatch,
///     compute_core::__bridge_descriptor_YrsComputeEngine_core,
///     compute_core::__bridge_descriptor_YrsComputeEngine_features,
/// );
/// ```
///
/// # With tests / custom import sets
///
/// ```ignore
/// bridge_delegate::delegate!(
///     target = StubService,
///     dispatch = dispatch,
///     skip_default_imports = true,           // suppresses `use compute_core::*`
///     crate::__bridge_descriptor_stub,
/// );
/// ```
///
/// `skip_default_imports = true` tells the macro not to emit the default
/// `use compute_core::...` import block. Callers that don't depend on
/// `compute-core` (e.g. the bridge-delegate crate's own tests) need this; the
/// production path leaves the flag off and keeps the imports.
///
/// This generates:
/// 1. `impl ComputeService { ... }` with delegate methods for each descriptor method
/// 2. New descriptor macros `__bridge_descriptor_ComputeService_*` that WASM/NAPI can consume
///
/// Delegates preserve the original parameters and return type. Borrowed inputs
/// are owned before dispatching to the engine thread.
///
/// Lifecycle (create) and pure (stateless) methods are skipped — they need hand-written
/// implementations or separate handling.
#[macro_export]
macro_rules! delegate {
    // Custom import sets.
    (
        target = $target:ident,
        dispatch = $dispatch:ident,
        skip_default_imports = $skip:literal,
        $($desc:path),+ $(,)?
    ) => {
        $(
            $desc!(
                bridge_delegate::__expand,
                delegate_target = $target;
                delegate_dispatch = $dispatch;
                delegate_skip_default_imports = $skip;
            );
        )*
    };
    // Default imports.
    (
        target = $target:ident,
        dispatch = $dispatch:ident,
        $($desc:path),+ $(,)?
    ) => {
        $(
            $desc!(
                bridge_delegate::__expand,
                delegate_target = $target;
                delegate_dispatch = $dispatch;
            );
        )*
    };
}
