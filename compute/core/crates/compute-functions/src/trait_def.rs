//! PureFunction trait — the core abstraction for all Excel-compatible functions.

use value_types::CellValue;

/// Trait implemented by every Excel-compatible function.
///
/// Functions receive pre-evaluated, flattened arguments as `&[CellValue]`.
/// Pure functions are stateless transformations from values to a value.
pub trait PureFunction: Send + Sync {
    /// Execute the function with the given arguments.
    fn call(&self, args: &[CellValue]) -> CellValue;

    /// The canonical (uppercase) name of the function.
    fn name(&self) -> &'static str;

    /// Minimum number of arguments required.
    fn min_args(&self) -> usize;

    /// Maximum number of arguments allowed, or `None` for unlimited (variadic).
    fn max_args(&self) -> Option<usize>;

    /// Whether this function is volatile (must recalculate every time).
    fn is_volatile(&self) -> bool {
        false
    }

    /// Whether this function returns an array (dynamic array formula).
    fn returns_array(&self) -> bool {
        false
    }

    /// Default value for an omitted optional argument at the given index.
    fn default_for_arg(&self, _index: usize) -> Option<CellValue> {
        None
    }

    /// Whether the argument at `index` is scalar (should be auto-lifted
    /// element-wise when an array value arrives).
    ///
    /// Default `false` means the function handles arrays natively (e.g.
    /// LARGE, STDEV, MEDIAN use `flatten_values`).  Override with `true`
    /// for scalar functions (ABS, TEXT, ROUND, etc.) so the registry's
    /// `try_array_lift` broadcasts them automatically.
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
}
