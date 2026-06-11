use super::helpers::*;
use crate::bridge_types::CellInput;
use domain_types::CellFormat;
use value_types::{CellError, CellValue};

#[test]
fn typed_number_in_percent_cell_is_not_reparsed_as_user_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = crate::storage::engine::YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    let percent_format = CellFormat {
        number_format: Some("#,##0.0%".to_string()),
        ..Default::default()
    };
    engine
        .set_format_for_ranges(&sid, &[(0, 9, 0, 10)], &percent_format)
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0u32,
                    9u32,
                    CellInput::Value {
                        value: CellValue::from(0.185),
                    },
                ),
                (
                    sid,
                    0u32,
                    10u32,
                    CellInput::Parse {
                        text: "0.185".to_string(),
                    },
                ),
            ],
            true,
        )
        .unwrap();

    match engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 9))
    {
        Some(CellValue::Number(n)) => {
            assert!((n.get() - 0.185).abs() < 1e-12, "got {}", n.get());
        }
        other => panic!("expected Number(0.185), got {:?}", other),
    }
    assert_eq!(engine.format_cell_display(&sid, 0, 9), "18.5%");

    match engine
        .mirror()
        .get_cell_value_at(&sid, cell_types::SheetPos::new(0, 10))
    {
        Some(CellValue::Number(n)) => {
            assert!((n.get() - 0.00185).abs() < 1e-12, "got {}", n.get());
        }
        other => panic!("expected Number(0.00185), got {:?}", other),
    }
    assert_eq!(engine.format_cell_display(&sid, 0, 10), "0.2%");
}

#[test]
fn formulas_recalculate_after_writing_previously_blank_direct_reference() {
    let snap = empty_bulk_snapshot();
    let (mut engine, _) = crate::storage::engine::YrsComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0,
                1,
                CellInput::Parse {
                    text: "10".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    engine
        .batch_set_cells_by_position(
            vec![
                (
                    sid,
                    0,
                    2,
                    CellInput::Parse {
                        text: "=A1/B1".to_string(),
                    },
                ),
                (
                    sid,
                    0,
                    3,
                    CellInput::Parse {
                        text: "=B1/A1-1".to_string(),
                    },
                ),
            ],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 2), num(0.0));
    assert!(matches!(
        cell_value_at(&engine, &sid, 0, 3),
        CellValue::Error(CellError::Div0, _)
    ));

    engine
        .batch_set_cells_by_position(vec![(sid, 0, 0, CellInput::Clear)], true)
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 2), num(0.0));
    assert!(matches!(
        cell_value_at(&engine, &sid, 0, 3),
        CellValue::Error(CellError::Div0, _)
    ));

    engine
        .batch_set_cells_by_position(
            vec![(
                sid,
                0,
                0,
                CellInput::Parse {
                    text: "50".to_string(),
                },
            )],
            true,
        )
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 2), num(5.0));
    assert_eq!(cell_value_at(&engine, &sid, 0, 3), num(-0.8));

    engine
        .batch_set_cells_by_position(vec![(sid, 0, 0, CellInput::Clear)], true)
        .unwrap();

    assert_eq!(cell_value_at(&engine, &sid, 0, 2), num(0.0));
    assert!(matches!(
        cell_value_at(&engine, &sid, 0, 3),
        CellValue::Error(CellError::Div0, _)
    ));
}
