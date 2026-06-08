//! CopyRange format contract regressions.

use super::super::*;
use super::helpers::*;
use crate::storage::engine::mutation::MutationOutput;
use value_types::{CellValue, FiniteF64};

fn stored_format_at(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<domain_types::CellFormat> {
    let cell_id = engine
        .stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|g| g.cell_id_at(row, col))?;
    let cell_hex = id_to_hex(cell_id.as_u128());
    crate::storage::properties::get_cell_format(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        engine.stores.storage.sheets(),
        sheet_id,
        &cell_hex,
    )
}

fn set_stored_format_at(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    format: &domain_types::CellFormat,
) {
    engine
        .set_cell_value_parsed(sheet_id, row, col, "999")
        .expect("set target value before formatting");
    let cell_id = engine
        .mirror()
        .resolve_cell_id(sheet_id, SheetPos::new(row, col))
        .expect("formatted target should have a cell id");
    let cell_hex = id_to_hex(cell_id.as_u128());
    crate::storage::properties::set_cell_format(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        engine.stores.storage.sheets(),
        sheet_id,
        &cell_hex,
        format,
    );
}

#[test]
fn test_copy_range_values_preserves_target_format() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    set_stored_format_at(
        &mut engine,
        &sid,
        4,
        0,
        &domain_types::CellFormat {
            bold: Some(true),
            background_color: Some("#FFEE00".to_string()),
            number_format: Some("$#,##0.00".to_string()),
            ..Default::default()
        },
    );

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 0,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 0,
            copy_type: domain_types::CopyType::Values,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    let a5_fmt = stored_format_at(&engine, &sid, 4, 0)
        .expect("A5 should keep its stored format after values copy");
    assert_eq!(a5_fmt.bold, Some(true));
    assert_eq!(a5_fmt.background_color.as_deref(), Some("#FFEE00"));
    assert_eq!(a5_fmt.number_format.as_deref(), Some("$#,##0.00"));
}

#[test]
fn test_copy_range_formats_only() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();
    let _ = engine.register_viewport("main", &sid, 0, 0, 10, 5);

    let cell_hex = id_to_hex(cell_id_a1().as_u128());
    crate::storage::properties::set_cell_format(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        engine.stores.storage.sheets(),
        &sid,
        &cell_hex,
        &domain_types::CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    let output = engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 0,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 0,
            copy_type: domain_types::CopyType::Formats,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();
    let result = match output {
        MutationOutput::Recalc(result) => result,
        _ => panic!("expected Recalc output"),
    };

    let a5_change = result
        .recalc
        .changed_cells
        .iter()
        .find(|change| change.position.as_ref().map(|pos| (pos.row, pos.col)) == Some((4, 0)));
    assert!(
        a5_change.is_some(),
        "formats-only copy should report A5 in changed_cells so viewport patches refresh it"
    );

    let patches = engine.flush_viewport_patches();
    let mutation_bytes =
        extract_first_viewport_mutation(&patches).expect("formats-only copy should emit patches");
    let patch_positions = extract_patch_positions(&mutation_bytes);
    assert!(
        patch_positions.contains(&(4, 0)),
        "formats-only copy should emit a viewport patch for A5, got {patch_positions:?}"
    );

    let a5_fmt = stored_format_at(&engine, &sid, 4, 0).expect("A5 should have copied format");
    assert_eq!(
        a5_fmt.bold,
        Some(true),
        "A5 should have bold=true copied from A1"
    );

    let a5_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 0))
        .cloned()
        .unwrap_or(CellValue::Null);
    assert_eq!(
        a5_val,
        CellValue::Null,
        "A5 should have no value (formats-only copy)"
    );
}

#[test]
fn test_copy_range_all() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    let cell_hex = id_to_hex(cell_id_a1().as_u128());
    crate::storage::properties::set_cell_format(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        engine.stores.storage.sheets(),
        &sid,
        &cell_hex,
        &domain_types::CellFormat {
            bold: Some(true),
            ..Default::default()
        },
    );

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 0,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 0,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    let a5_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 0))
        .cloned();
    assert_eq!(
        a5_val.unwrap(),
        CellValue::Number(FiniteF64::must(10.0)),
        "A5 should have value 10 copied from A1"
    );

    let a5_fmt = stored_format_at(&engine, &sid, 4, 0).expect("A5 should have copied format");
    assert_eq!(
        a5_fmt.bold,
        Some(true),
        "A5 should have bold=true copied from A1"
    );
}

#[test]
fn test_copy_range_all_replaces_target_format_with_source_snapshot() {
    let snap = copy_range_snapshot();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).unwrap();

    let sid = sheet_id();

    set_stored_format_at(
        &mut engine,
        &sid,
        4,
        0,
        &domain_types::CellFormat {
            bold: Some(true),
            background_color: Some("#FFEE00".to_string()),
            number_format: Some("$#,##0.00".to_string()),
            ..Default::default()
        },
    );

    engine
        .apply_mutation(EngineMutation::CopyRange {
            source_sheet_id: sid,
            src_start_row: 0,
            src_start_col: 0,
            src_end_row: 0,
            src_end_col: 0,
            target_sheet_id: sid,
            target_row: 4,
            target_col: 0,
            copy_type: domain_types::CopyType::All,
            skip_blanks: false,
            transpose: false,
        })
        .unwrap();

    let a5_val = engine
        .mirror()
        .get_cell_value_at(&sid, SheetPos::new(4, 0))
        .cloned();
    assert_eq!(
        a5_val.unwrap(),
        CellValue::Number(FiniteF64::must(10.0)),
        "A5 should have copied A1's value"
    );

    let a5_fmt =
        stored_format_at(&engine, &sid, 4, 0).expect("A5 should have a stored format snapshot");
    assert_eq!(
        a5_fmt.bold,
        Some(false),
        "Copy All should replace target bold with source default"
    );
    assert!(
        a5_fmt.background_color.is_none(),
        "Copy All should clear target-only fill"
    );
    assert!(
        a5_fmt.number_format.is_none(),
        "Copy All should clear target-only number format"
    );
}
