//! Sparse imported values and blank cells obey the same range-format contract.
use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
use domain_types::{
    AuthoredStyleRun, CellData, CellFormat, DocumentFormat, ParseOutput, SheetData,
};
use value_types::CellValue;

fn imported_dense_sheet() -> (ComputeEngine, SheetId) {
    let output = ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat::from(&CellFormat {
                strikethrough: Some(true),
                ..Default::default()
            }),
        ],
        sheets: vec![SheetData {
            name: "Dense".into(),
            rows: 514,
            cols: 240,
            cells: (0..512)
                .flat_map(|row| {
                    (0..240).map(move |col| CellData {
                        row,
                        col,
                        value: CellValue::number((row * 240 + col) as f64),
                        ..Default::default()
                    })
                })
                .collect(),
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 513,
                start_col: 10,
                end_row: 513,
                end_col: 12,
                style_id: 1,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&output).unwrap();
    let (engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let id = *engine.cell_store().sheet_ids().next().unwrap();
    assert!(
        engine
            .cell_store()
            .get_sheet(&id)
            .unwrap()
            .iter_ranges()
            .next()
            .is_some()
    );
    (engine, id)
}
fn check_formats(engine: &ComputeEngine, id: &SheetId) {
    let positions = [
        (0, 0),
        (3, 7),
        (4, 7),
        (4, 8),
        (513, 7),
        (513, 10),
        (513, 11),
    ];
    let bulk = engine.get_displayed_formats_for_cells(id, &positions);
    for (index, &(row, col)) in positions.iter().enumerate() {
        assert_eq!(
            engine.get_resolved_format(id, row, col),
            bulk.palette[bulk.format_ids[index] as usize].clone().into(),
            "scalar/bulk mismatch at {row},{col}"
        );
    }
    assert_eq!(engine.get_resolved_format(id, 0, 0).bold, Some(false));
    assert_eq!(engine.get_resolved_format(id, 0, 0).italic, Some(true));
    assert_eq!(engine.get_resolved_format(id, 3, 7).italic, Some(true));
    assert_eq!(
        engine
            .get_resolved_format(id, 3, 7)
            .number_format
            .as_deref(),
        Some("0.000")
    );
    assert_eq!(engine.get_resolved_format(id, 4, 7).italic, Some(false));
    assert_eq!(
        engine
            .get_resolved_format(id, 4, 7)
            .number_format
            .as_deref(),
        Some("0.000")
    );
    assert_eq!(
        engine
            .get_resolved_format(id, 4, 8)
            .number_format
            .as_deref(),
        Some("0.0")
    );
    assert_eq!(engine.get_resolved_format(id, 4, 8).italic, Some(true));
    assert_eq!(
        engine
            .get_resolved_format(id, 513, 7)
            .number_format
            .as_deref(),
        Some("0.000")
    );
    assert_eq!(engine.get_resolved_format(id, 513, 7).italic, Some(true));
    assert_eq!(
        engine.get_resolved_format(id, 513, 10).strikethrough,
        Some(false)
    );
    assert_eq!(engine.get_resolved_format(id, 513, 10).italic, Some(false));
    assert_eq!(
        engine.get_resolved_format(id, 513, 11).strikethrough,
        Some(true)
    );
    assert_eq!(engine.get_resolved_format(id, 513, 11).italic, Some(true));
    assert_eq!(engine.get_raw_value(id, 511, 239), "122879");
}

#[test]
fn large_edits_preserve_inheritance_partial_clears_and_xlsx_without_expanding_values() {
    let (mut engine, id) = imported_dense_sheet();
    engine
        .set_col_format(
            &id,
            7,
            CellFormat {
                number_format: Some("0.000".into()),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_row_format(
            &id,
            3,
            CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &id,
            &[(4, 8, 4, 8)],
            &CellFormat {
                number_format: Some("0.0".into()),
                ..Default::default()
            },
        )
        .unwrap();
    let eager_before = engine
        .cell_store()
        .get_sheet(&id)
        .unwrap()
        .cells_iter()
        .count();
    let cell_count = engine.get_cell_count(&id);
    let all = [(0, 0, 513, 239)];
    engine
        .register_viewport("visible", &id, 0, 0, 8, 10)
        .unwrap();
    let _ = engine
        .set_format_for_ranges(
            &id,
            &all,
            &CellFormat {
                bold: Some(true),
                italic: Some(true),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(engine.get_resolved_format(&id, 511, 239).bold, Some(true));
    engine
        .patch_format_for_ranges(&id, &all, &CellFormat::default(), &["bold".into()])
        .unwrap();
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&id)
            .unwrap()
            .cells_iter()
            .count(),
        eager_before,
        "formatting must not expand native values into per-cell entries"
    );
    assert_eq!(engine.get_cell_count(&id), cell_count);
    engine
        .patch_format_for_ranges(
            &id,
            &[(3, 7, 4, 7)],
            &CellFormat::default(),
            &["italic".into()],
        )
        .unwrap();
    engine
        .clear_format_for_ranges(&id, &[(513, 10, 513, 10)])
        .unwrap();
    check_formats(&engine, &id);
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let reloaded_id = *reloaded.cell_store().sheet_ids().next().unwrap();
    check_formats(&reloaded, &reloaded_id);
}

#[test]
fn large_toggle_and_direct_formats_override_table_styles_and_clear_back_to_them() {
    let (mut engine, id) = imported_dense_sheet();
    engine
        .create_table(
            &id,
            "Numbers".into(),
            0,
            0,
            3,
            1,
            vec!["First".into(), "Second".into()],
            true,
        )
        .unwrap();
    let inherited = engine.get_resolved_format(&id, 0, 0);
    assert_eq!(inherited.bold, Some(true), "table header supplies bold");
    let count = engine
        .cell_store()
        .get_sheet(&id)
        .unwrap()
        .cells_iter()
        .count();
    let all = [(0, 0, 513, 239)];
    engine
        .toggle_format_property(&id, &all, "bold", 0, 0)
        .unwrap();
    assert_eq!(engine.get_resolved_format(&id, 0, 0).bold, Some(false));
    assert_eq!(engine.get_resolved_format(&id, 400, 100).bold, Some(false));
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&id)
            .unwrap()
            .cells_iter()
            .count(),
        count
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let reloaded_id = *reloaded.cell_store().sheet_ids().next().unwrap();
    assert_eq!(
        reloaded.get_resolved_format(&reloaded_id, 0, 0).bold,
        Some(false)
    );
    engine
        .patch_format_for_ranges(&id, &all, &CellFormat::default(), &["bold".into()])
        .unwrap();
    assert_eq!(engine.get_resolved_format(&id, 0, 0).bold, inherited.bold);
    engine.register_viewport("clear", &id, 0, 0, 5, 5).unwrap();
    engine
        .set_format_for_ranges(
            &id,
            &all,
            &CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    let _ = engine
        .clear_range_with_mode(&id, 0, 0, 513, 239, "formats")
        .unwrap();

    assert_eq!(
        engine.get_resolved_format(&id, 400, 100).italic,
        Some(false)
    );
}

#[test]
fn large_border_clear_removes_only_the_requested_edge() {
    use compute_core::bridge_types::{BorderPatchField, BorderPatchOperation, BorderPatchTarget};
    use domain_types::{CellBorderSide, CellBorders};
    let (mut engine, id) = imported_dense_sheet();
    let edge = CellBorderSide {
        style: Some(ooxml_types::styles::BorderStyle::Thin),
        color: Some("#112233".into()),
        ..Default::default()
    };
    let target = BorderPatchTarget::Cells {
        start_row: 0,
        start_col: 0,
        end_row: 513,
        end_col: 239,
    };
    let count = engine
        .cell_store()
        .get_sheet(&id)
        .unwrap()
        .cells_iter()
        .count();
    engine
        .patch_borders(
            &id,
            vec![
                BorderPatchOperation {
                    target: target.clone(),
                    borders: CellBorders {
                        top: Some(edge.clone()),
                        left: Some(edge.clone()),
                        ..Default::default()
                    },
                    clear_fields: vec![],
                },
                BorderPatchOperation {
                    target,
                    borders: CellBorders::default(),
                    clear_fields: vec![BorderPatchField::Top],
                },
            ],
        )
        .unwrap();
    let borders = engine.get_resolved_format(&id, 400, 100).borders.unwrap();
    assert!(borders.top.is_none());
    assert_eq!(borders.left, Some(edge.clone()));
    assert_eq!(
        engine
            .cell_store()
            .get_sheet(&id)
            .unwrap()
            .cells_iter()
            .count(),
        count
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let restored = *reloaded.cell_store().sheet_ids().next().unwrap();
    let borders = reloaded
        .get_resolved_format(&restored, 513, 100)
        .borders
        .unwrap();
    assert!(
        borders.top.as_ref().is_none_or(|edge| edge.style.is_none()
            || edge.style == Some(ooxml_types::styles::BorderStyle::None))
    );
    assert_eq!(borders.left, Some(edge));
}
