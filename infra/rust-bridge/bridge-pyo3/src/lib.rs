/// Re-export the proc macros so `bridge_pyo3::__expand` resolves.
pub use bridge_pyo3_macros::__expand;

/// Re-export the class-based proc macro so `bridge_pyo3::__expand_class` resolves.
pub use bridge_pyo3_macros::__expand_class;

/// Re-export the class generator proc macro so `bridge_pyo3::__generate_class` resolves.
pub use bridge_pyo3_macros::__generate_class;

/// Re-export bridge_types so generated code can reference `bridge_types::BridgeParse`.
pub use bridge_types;

/// Generate PyO3 `#[pyfunction]` free functions from bridge descriptor macros.
///
/// # Usage
///
/// ```ignore
/// bridge_pyo3::generate!(
///     compute_core::__bridge_descriptor_FormatBridge_format,
///     compute_core::__bridge_descriptor_SchemaBridge_schema_utils,
/// );
/// ```
///
/// Each descriptor macro is invoked with `bridge_pyo3::__expand` as the callback,
/// which parses the descriptor tokens and emits PyO3-specific code including:
///
/// - `#[pyfunction]` functions for each bridge method
/// - Parameter deserialization from Python types
/// - Return value serialization to Python types
#[macro_export]
macro_rules! generate {
    ($($desc:path),+ $(,)?) => {
        $($desc!(bridge_pyo3::__expand);)*
    };
}

/// Generate class-based PyO3 bindings from bridge descriptor macros.
///
/// Emits a `#[pyclass]` struct wrapper and `#[pymethods] impl` blocks with instance methods.
/// Rust `Drop` handles cleanup automatically.
///
/// # Usage
///
/// ```ignore
/// bridge_pyo3::generate_class!(
///     struct ComputeEngine(compute_core::storage::engine::YrsComputeEngine);
///     compute_core::__bridge_descriptor_YrsComputeEngine_core,
///     compute_core::__bridge_descriptor_YrsComputeEngine_viewport,
/// );
/// ```
///
/// This generates:
/// - `#[pyclass] pub struct ComputeEngine { pub(crate) inner: YrsComputeEngine }`
/// - `#[pymethods] impl ComputeEngine { ... }` blocks with `&self` / `&mut self` methods
/// - Pure methods stay as free functions
#[macro_export]
macro_rules! generate_class {
    ($($tt:tt)*) => {
        bridge_pyo3::__generate_class!{ $($tt)* }
    };
}
