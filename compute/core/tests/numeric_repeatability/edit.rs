use cell_types::{SheetId, SheetPos};
use compute_core::storage::engine::YrsComputeEngine;
use value_types::{CellValue, FiniteF64};

use crate::support::fixtures::SHEET1_UUID;

pub(crate) fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET1_UUID).expect("valid sheet uuid")
}

/// Overwrite a value cell via the raw `import_values` path, bypassing string
/// input parsing for numeric seeds.
pub(crate) fn overwrite_number(
    engine: &mut YrsComputeEngine,
    sid: &SheetId,
    row: u32,
    col: u32,
    value: f64,
) -> Result<(), String> {
    let fin = FiniteF64::new(value).ok_or_else(|| format!("non-finite seed value {}", value))?;
    engine
        .import_values(sid, vec![(row, col, CellValue::Number(fin), None)])
        .map_err(|e| format!("import_values failed: {:?}", e))?;
    Ok(())
}

pub(crate) fn read_number_at(
    engine: &YrsComputeEngine,
    sid: &SheetId,
    pos: SheetPos,
) -> Option<f64> {
    engine
        .mirror()
        .get_cell_value_at(sid, pos)
        .and_then(|v| v.as_number())
}

pub(crate) fn read_value_at(
    engine: &YrsComputeEngine,
    sid: &SheetId,
    pos: SheetPos,
) -> Option<CellValue> {
    engine.mirror().get_cell_value_at(sid, pos).cloned()
}

/// Apply one forward/inverse pair on (row, col) and compare the dependent
/// value before and after the inverse. Numeric values use exact `to_bits()`.
pub(crate) fn op_inverse_pair(
    engine: &mut YrsComputeEngine,
    sid: &SheetId,
    root_row: u32,
    root_col: u32,
    seed: f64,
    delta: f64,
    dependent: SheetPos,
) -> Result<(), String> {
    let before = read_value_at(engine, sid, dependent).ok_or_else(|| {
        format!(
            "dependent at ({}, {}) missing before op",
            dependent.row(),
            dependent.col()
        )
    })?;

    overwrite_number(engine, sid, root_row, root_col, seed + delta)?;
    overwrite_number(engine, sid, root_row, root_col, seed)?;

    let after = read_value_at(engine, sid, dependent).ok_or_else(|| {
        format!(
            "dependent at ({}, {}) missing after inverse",
            dependent.row(),
            dependent.col()
        )
    })?;

    match (&before, &after) {
        (CellValue::Number(b), CellValue::Number(a)) => {
            let (bb, ab) = (b.get().to_bits(), a.get().to_bits());
            if bb == ab {
                Ok(())
            } else {
                Err(format!(
                    "drift: before={} (bits=0x{:016x}) after={} (bits=0x{:016x}) delta={}",
                    b.get(),
                    bb,
                    a.get(),
                    ab,
                    a.get() - b.get(),
                ))
            }
        }
        (b, a) if b == a => Ok(()),
        (b, a) => Err(format!(
            "non-numeric dependent changed: before={:?} after={:?}",
            b, a
        )),
    }
}
