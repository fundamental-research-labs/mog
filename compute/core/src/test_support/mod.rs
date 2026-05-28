//! Test-support surface for integration tests.
//!
//! This module exists to expose shared case tables and test-only helpers
//! to integration tests under `compute/core/tests/`.
//!
//! It is `pub` (so integration tests can reach it) but `#[doc(hidden)]`
//! at the crate root — it is **not** part of the stable public API.

pub mod class_iv;
pub mod yrs_canonical;

/// Re-export of the XLSX-import snapshot builder for integration tests that
/// need to drive the engine through the real parse → snapshot → from_snapshot
/// init path (e.g. the `nxnOekSc` iterative-recalc reducer). The underlying
/// `import` module is `pub(crate)` in default builds; this re-export keeps
/// the production crate boundary tight while giving `tests/` access through
/// the designated test-support surface.
pub use crate::import::parse_output_to_snapshot::{
    DefaultIdAllocator, parse_output_to_workbook_snapshot,
};

use value_types::CellValue;

/// Render a `CellValue` back to the kind of input string a user would type.
///
/// This is the *lossy* rendering — `Text("42")` → `"42"` (which re-parses to
/// `Number(42)`), `Error(..)` → `""`, `Array(..)` → `""`. Used by Class IV
/// integration tests to simulate the user-typing path (`engine.set_cell(render(v))`),
/// where the lossiness is inherent to the path under test.
///
/// Production code that needs to move typed values through the engine must
/// use the value-typed entry points (`set_cells_raw`, `import_values`) —
/// there is no production caller for this rendering anymore.
pub fn cell_value_to_input_string(value: &CellValue) -> String {
    match value {
        CellValue::Number(n) => format!("{}", n),
        CellValue::Text(s) => s.to_string(),
        CellValue::Boolean(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        CellValue::Null => String::new(),
        CellValue::Error(..) => String::new(),
        CellValue::Array(_) => String::new(),
        CellValue::Control(c) => if c.value { "TRUE" } else { "FALSE" }.to_string(),
        CellValue::Image(image) => image.fallback_text().to_string(),
    }
}
