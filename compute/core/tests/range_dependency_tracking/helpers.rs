use cell_types::{CellId, SheetId};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, SheetSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------
// Test file local helpers (plan's coordination rule: do NOT extend
// fixtures.rs / assertions.rs while parallel agents are running; keep
// additions local).
// ---------------------------------------------------------------------

pub(crate) fn sheet_uuid(idx: u32) -> String {
    format!("a0000000000000000000{:012x}", idx as u64)
}

pub(crate) fn cell_uuid(sheet_idx: u32, row: u32, col: u32) -> String {
    format!("c{:07x}{:04x}{:04x}0000000000000000", sheet_idx, row, col)
}

pub(crate) fn sheet_id(idx: u32) -> SheetId {
    SheetId::from_uuid_str(&sheet_uuid(idx)).expect("valid sheet uuid")
}

pub(crate) fn cell_id(sheet_idx: u32, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_idx, row, col)).expect("valid cell uuid")
}

/// A pre-populated cell carrying a literal number.
pub(crate) fn value_cell(sheet_idx: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// A pre-populated cell carrying an arbitrary value.
pub(crate) fn raw_cell(sheet_idx: u32, row: u32, col: u32, v: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: v,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// A pre-seeded formula cell — `value` is `Null`, engine fills it in on
/// `from_snapshot`.
pub(crate) fn formula_cell(sheet_idx: u32, row: u32, col: u32, formula: &str) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_idx, row, col),
        row,
        col,
        value: CellValue::Null,
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

pub(crate) fn sheet_snap(idx: u32, name: &str, cells: Vec<CellData>) -> SheetSnapshot {
    SheetSnapshot {
        id: sheet_uuid(idx),
        name: name.to_string(),
        // Plenty of room for row 50_000 writes without off-by-ones.
        rows: 100_000,
        cols: 64,
        cells,
        ranges: vec![],
    }
}

/// Read the (cloned) value at a specific cell directly from the mirror.
pub(crate) fn read_value(engine: &YrsComputeEngine, cell: &CellId) -> CellValue {
    engine
        .mirror()
        .get_cell_value(cell)
        .cloned()
        .unwrap_or(CellValue::Null)
}

/// Forward write + inverse write *as a single Class II step*.
///
/// Forward uses `set_cell` (production input path). Inverse uses
/// `import_values` with the *captured* raw [`CellValue`] so the parser
/// can't clobber the round-trip (Class IV / FINDINGS.md Class-A concern).
/// Returns `Err` if either the forward or the inverse failed — those
/// are always real failures, distinct from "dependent drifted."
pub(crate) fn op_then_inverse(
    engine: &mut YrsComputeEngine,
    sheet: &SheetId,
    target: &CellId,
    row: u32,
    col: u32,
    prior: CellValue,
    new_input: &str,
) -> Result<(), String> {
    engine
        .set_cell(sheet, *target, row, col, new_input.into())
        .map_err(|e| format!("forward set_cell err: {:?}", e))?;
    engine
        .import_values(sheet, vec![(row, col, prior, None)])
        .map_err(|e| format!("inverse import_values err: {:?}", e))?;
    Ok(())
}

/// Assert the dependent formula's value is identical before and after
/// the op+inverse pair. Returns `Ok(())` on match, `Err(msg)` on drift.
pub(crate) fn assert_dependent_identity(
    before: &CellValue,
    after: &CellValue,
    context: &str,
) -> Result<(), String> {
    if before == after {
        Ok(())
    } else {
        Err(format!(
            "{ctx}: dependent drift: before={before:?} after={after:?}",
            ctx = context,
            before = before,
            after = after,
        ))
    }
}
