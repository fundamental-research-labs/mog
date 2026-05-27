//! Class I iterative-recalc identity harness support.

use cell_types::{CellId, SheetId};
use snapshot_types::CellData;
use value_types::{CellValue, FiniteF64};

pub(crate) mod cases;
pub(crate) mod formulas;
pub(crate) mod runner;
pub(crate) mod workbooks;

const SHEET1_UUID: &str = "a0000000000000000000000000000001";
const SHEET2_UUID: &str = "a0000000000000000000000000000002";
const SHEET3_UUID: &str = "a0000000000000000000000000000003";

fn sheet_id(uuid: &str) -> SheetId {
    SheetId::from_uuid_str(uuid).expect("valid sheet uuid")
}

fn cell_uuid(sheet_prefix: u8, row: u32, col: u32) -> String {
    // sheet_prefix shifts the top nibble so cell ids across sheets don't
    // collide. Stage 1 uses 0xc000... for sheet 1; we offset for 2/3.
    format!(
        "c{:01x}000000{:04x}{:04x}0000000000000000",
        sheet_prefix, row, col
    )
}

fn cell_id_for(sheet_prefix: u8, row: u32, col: u32) -> CellId {
    CellId::from_uuid_str(&cell_uuid(sheet_prefix, row, col)).expect("valid cell uuid")
}

fn make_cell(
    sheet_prefix: u8,
    row: u32,
    col: u32,
    value: CellValue,
    formula: Option<&str>,
) -> CellData {
    CellData {
        cell_id: cell_uuid(sheet_prefix, row, col),
        row,
        col,
        value,
        formula: formula.map(|s| s.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

fn value_cell(sheet_prefix: u8, row: u32, col: u32, n: f64) -> CellData {
    make_cell(
        sheet_prefix,
        row,
        col,
        CellValue::Number(FiniteF64::must(n)),
        None,
    )
}

fn formula_cell(sheet_prefix: u8, row: u32, col: u32, formula: &str) -> CellData {
    make_cell(sheet_prefix, row, col, CellValue::Null, Some(formula))
}

fn text_cell(sheet_prefix: u8, row: u32, col: u32, s: &str) -> CellData {
    make_cell(sheet_prefix, row, col, CellValue::Text(s.into()), None)
}
