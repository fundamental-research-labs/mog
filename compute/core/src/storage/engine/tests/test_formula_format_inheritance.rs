use super::helpers::*;
use crate::storage::engine::YrsComputeEngine;
use compute_wire::constants::{MUTATION_HEADER_SIZE, PATCH_STRIDE};
use domain_types::{CellFormat, ColStyleRange, DocumentFormat, FontFormat, ParseOutput, SheetData};

fn patch_display_text_at(mutation_bytes: &[u8], row: u32, col: u32) -> Option<String> {
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let string_pool_start = patches_start + patch_count * PATCH_STRIDE;

    for i in 0..patch_count {
        let patch_off = patches_start + i * PATCH_STRIDE;
        let patch_row = u32::from_le_bytes([
            mutation_bytes[patch_off],
            mutation_bytes[patch_off + 1],
            mutation_bytes[patch_off + 2],
            mutation_bytes[patch_off + 3],
        ]);
        let patch_col = u32::from_le_bytes([
            mutation_bytes[patch_off + 4],
            mutation_bytes[patch_off + 5],
            mutation_bytes[patch_off + 6],
            mutation_bytes[patch_off + 7],
        ]);
        if patch_row != row || patch_col != col {
            continue;
        }

        let record_off = patch_off + 8;
        let display_off = u32::from_le_bytes([
            mutation_bytes[record_off + 8],
            mutation_bytes[record_off + 9],
            mutation_bytes[record_off + 10],
            mutation_bytes[record_off + 11],
        ]);
        let display_len = u16::from_le_bytes([
            mutation_bytes[record_off + 20],
            mutation_bytes[record_off + 21],
        ]);
        if display_off == compute_wire::constants::NO_STRING || display_len == 0 {
            return None;
        }
        let start = string_pool_start + display_off as usize;
        let end = start + display_len as usize;
        return Some(String::from_utf8_lossy(&mutation_bytes[start..end]).to_string());
    }

    None
}

#[test]
fn bulk_parsed_formula_edit_copies_single_referenced_number_format() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
fn formula_format_inheritance_flushes_format_only_viewport_patch() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
    let patches = engine.flush_viewport_patches();
    let mutation = extract_first_viewport_mutation(&patches).expect("format patch");

    assert!(
        result.property_changes.iter().any(|change| change
            .position
            .as_ref()
            .is_some_and(|position| position.row == 1 && position.col == 0)),
        "formula format inheritance should report A2 as a property change; got {:?}",
        result.property_changes
    );
    assert_eq!(
        patch_display_text_at(&mutation, 1, 0).as_deref(),
        Some("$30.00")
    );
}

#[test]
fn formula_format_inheritance_is_undone_with_formula_edit() {
    let snap = simple_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();
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
        .set_cell_values_parsed(&sid, vec![(1, 1, "=A1*2".to_string())])
        .unwrap();
    assert_eq!(engine.get_raw_value(&sid, 1, 1), "=A1*2");
    assert_eq!(
        engine
            .get_resolved_format(&sid, 1, 1)
            .number_format
            .as_deref(),
        Some("$#,##0.00")
    );

    engine.undo().expect("undo formula edit");

    assert_eq!(engine.get_raw_value(&sid, 1, 1), "");
    assert_ne!(
        engine
            .get_resolved_format(&sid, 1, 1)
            .number_format
            .as_deref(),
        Some("$#,##0.00"),
        "one undo should remove both the formula and its automatic inherited format"
    );
}

#[test]
fn bulk_value_paste_formats_formula_dependents_with_sparse_column_style_range() {
    let output = ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat {
                number_format: Some("\"$\"#,##0.0_);\\(\"$\"#,##0.0\\)".to_string()),
                font: Some(FontFormat {
                    bold: Some(true),
                    ..Default::default()
                }),
                ..Default::default()
            },
        ],
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 64,
            cols: 8,
            col_style_ranges: vec![ColStyleRange {
                start_col: 2,
                end_col: 3,
                style_id: 1,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let mut engine = engine_from_parse_output_normal(&output);
    let sid = *engine
        .mirror()
        .sheet_ids()
        .next()
        .expect("hydrated sheet id");

    engine
        .register_viewport("main", &sid, 0, 0, 40, 8)
        .expect("register viewport");
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

    let (patches, _) = engine
        .set_cell_values_parsed(
            &sid,
            vec![(10, 2, "899.4".to_string()), (10, 3, "773.8".to_string())],
        )
        .expect("seed source values");
    let mutation = extract_first_viewport_mutation(&patches).expect("mutation patch");

    assert_eq!(engine.format_cell_display(&sid, 24, 2), "$15.3 ");
    assert_eq!(engine.format_cell_display(&sid, 31, 3), "($0.1)");
    assert_eq!(
        patch_display_text_at(&mutation, 24, 2).as_deref(),
        Some("$15.3 ")
    );
    assert_eq!(
        patch_display_text_at(&mutation, 31, 3).as_deref(),
        Some("($0.1)")
    );
}
