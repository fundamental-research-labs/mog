//! Formula number-format inheritance is visible in explicit render reads.

use super::helpers::*;
use crate::storage::engine::ComputeEngine;
use domain_types::CellFormat;

fn rendered_text_at(engine: &ComputeEngine, row: u32, col: u32) -> Option<String> {
    engine
        .build_viewport_render_data(&sheet_id(), row, col, row + 1, col + 1)
        .cells
        .first()
        .and_then(|cell| cell.formatted.clone())
}

#[test]
fn bulk_parsed_formula_edit_copies_single_referenced_number_format() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    engine
        .set_cell_values_parsed(&sid, vec![(0, 1, "=A1*2".to_string())])
        .unwrap();

    let resolved = engine.get_resolved_format(&sid, 0, 1);
    assert_eq!(resolved.number_format.as_deref(), Some("$#,##0.00"));
    assert_eq!(engine.format_cell_display(&sid, 0, 1), "$20.00");
}

#[test]
fn formula_format_inheritance_updates_rendered_text() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 10, 10)
        .expect("register viewport");
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                number_format: Some("$#,##0.00".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

    let result = engine
        .apply_formula_inherited_number_formats(&[(sid, 1, 0)])
        .expect("inherit formula format");

    assert!(
        result.property_changes.iter().any(|change| change
            .position
            .as_ref()
            .is_some_and(|position| position.row == 1 && position.col == 0)),
        "formula format inheritance should report A2 as a property change; got {:?}",
        result.property_changes
    );
    assert_eq!(rendered_text_at(&engine, 1, 0).as_deref(), Some("$30.00"));
}

#[test]
fn bulk_value_paste_formats_formula_dependents_with_sparse_column_style_range() {
    let snap = simple_snapshot();
    let (mut engine, _) = ComputeEngine::from_snapshot(snap).unwrap();
    let sid = sheet_id();

    engine
        .register_viewport("main", &sid, 0, 0, 40, 8)
        .expect("register viewport");
    engine
        .set_col_format_range(
            &sid,
            2,
            3,
            CellFormat {
                number_format: Some("\"$\"#,##0.0_);\\(\"$\"#,##0.0\\)".to_string()),
                bold: Some(true),
                ..Default::default()
            },
        )
        .expect("set sparse column format range");
    engine
        .set_cell_values_parsed(&sid, vec![(17, 2, "58.8".to_string())])
        .expect("seed denominator");
    engine
        .set_cell_values_parsed(
            &sid,
            vec![
                (24, 2, "=C11/C18".to_string()),
                (31, 3, "=D11/C11-1".to_string()),
            ],
        )
        .expect("seed formulas");

    let _ = engine
        .set_cell_values_parsed(
            &sid,
            vec![(10, 2, "899.4".to_string()), (10, 3, "773.8".to_string())],
        )
        .expect("seed source values");

    assert_eq!(engine.format_cell_display(&sid, 24, 2), "$15.3 ");
    assert_eq!(engine.format_cell_display(&sid, 31, 3), "($0.1)");
    assert_eq!(rendered_text_at(&engine, 24, 2).as_deref(), Some("$15.3 "));
    assert_eq!(rendered_text_at(&engine, 31, 3).as_deref(), Some("($0.1)"));
}
