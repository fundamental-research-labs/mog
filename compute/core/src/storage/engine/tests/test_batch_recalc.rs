//! Recalculation coverage for batch position writes.

use super::super::*;
use super::helpers::*;
use value_types::CellValue;

fn parse_input(text: &str) -> crate::storage::engine::mutation::CellInput {
    crate::storage::engine::mutation::CellInput::Parse {
        text: text.to_string(),
    }
}

fn assert_number_close(value: CellValue, expected: f64) {
    let actual = match value {
        CellValue::Number(n) => n.get(),
        other => panic!("expected number {expected}, got {other:?}"),
    };
    assert!(
        (actual - expected).abs() < 0.000_001,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn batch_position_writes_recalculate_formulas_below_inputs() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(vec![(sid, 10, 2, parse_input("899.4"))], true)
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![
                (sid, 24, 2, parse_input("=C11/C18")),
                (sid, 38, 3, parse_input("=D18/C18-1")),
            ],
            true,
        )
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![
                (sid, 17, 2, parse_input("58.8")),
                (sid, 17, 3, parse_input("66.1")),
            ],
            true,
        )
        .unwrap();

    assert_number_close(cell_value_at(&engine, &sid, 24, 2), 899.4 / 58.8);
    assert_number_close(cell_value_at(&engine, &sid, 38, 3), 66.1 / 58.8 - 1.0);

    engine
        .batch_set_cells_by_position(vec![(sid, 17, 2, parse_input("66.1"))], true)
        .unwrap();

    assert_number_close(cell_value_at(&engine, &sid, 24, 2), 899.4 / 66.1);
    assert_number_close(cell_value_at(&engine, &sid, 38, 3), 0.0);
}
