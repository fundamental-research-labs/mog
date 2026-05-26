//! Shared test helpers for the compute-parser crate.
//!
//! Provides a canonical `TestResolver` that maps common sheet names to `SheetId`s,
//! plus convenience functions for parsing formulas in tests.

use cell_types::SheetId;
use formula_types::CellRef;

use crate::CellRefResolver;

/// A test resolver that maps a superset of sheet names used across all test files.
///
/// Sheet mapping:
/// - `"Sheet1"` → `SheetId(1)` (current sheet)
/// - `"Sheet2"` → `SheetId(2)`
/// - `"Data"`   → `SheetId(3)`
/// - `"My Sheet"` → `SheetId(4)`
/// - `"Sheet's Name"` → `SheetId(5)`
pub(crate) struct TestResolver {
    sheet: SheetId,
}

impl TestResolver {
    pub fn new() -> Self {
        Self {
            sheet: SheetId::from_raw(1),
        }
    }
}

impl CellRefResolver for TestResolver {
    fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> CellRef {
        CellRef::Positional {
            sheet: *sheet,
            row,
            col,
        }
    }

    fn resolve_sheet_name(&self, name: &str) -> Option<SheetId> {
        match name {
            "Sheet1" => Some(SheetId::from_raw(1)),
            "Sheet2" => Some(SheetId::from_raw(2)),
            "Data" => Some(SheetId::from_raw(3)),
            "My Sheet" => Some(SheetId::from_raw(4)),
            "Sheet's Name" => Some(SheetId::from_raw(5)),
            _ => None,
        }
    }

    fn current_sheet(&self) -> SheetId {
        self.sheet
    }
}
