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

#[test]
fn transferable_format_read_patch_preserves_fidelity_clears_target_and_excludes_display_overlays() {
    use compute_cf::types::{CellCFResult, CfRenderStyle as CFStyle};
    use domain_types::CellFormat;
    use domain_types::domain::theme::{ThemeColor, ThemeData};
    use ooxml_types::styles::BorderStyle;
    use std::collections::BTreeMap;
    use value_types::Color;

    fn theme(accent1: &str) -> ThemeData {
        ThemeData {
            colors: vec![ThemeColor {
                name: "accent1".to_string(),
                color: accent1.to_string(),
                source: None,
            }],
            ..Default::default()
        }
    }

    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sid = sheet_id();
    engine.set_workbook_theme(theme("#123456")).unwrap();

    let extensions = BTreeMap::from([
        ("ignoreError".to_string(), serde_json::json!(true)),
        (
            "test.owner".to_string(),
            serde_json::json!("format-contract"),
        ),
    ]);
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 0, 0, 0)],
            &CellFormat {
                font_color: Some("theme:accent1".to_string()),
                font_charset: Some(128),
                font_family_type: Some(2),
                quote_prefix: Some(true),
                pivot_button: Some(true),
                extensions: Some(extensions.clone()),
                borders: Some(domain_types::CellBorders {
                    bottom: Some(domain_types::CellBorderSide {
                        style: Some(BorderStyle::Dashed),
                        color: Some("#112233".to_string()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();
    engine
        .set_format_for_ranges(
            &sid,
            &[(0, 1, 0, 1)],
            &CellFormat {
                background_color: Some("#FFF2CC".to_string()),
                borders: Some(domain_types::CellBorders {
                    top: Some(domain_types::CellBorderSide {
                        style: Some(BorderStyle::Thin),
                        color: Some("#445566".to_string()),
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();

    // A displayed-only CF overlay must never leak into the transferable source.
    let mut cf_results = rustc_hash::FxHashMap::default();
    cf_results.insert(
        (0u32, 1u32),
        CellCFResult {
            row: 0,
            col: 1,
            style: Some(CFStyle {
                italic: Some(true),
                background_color: Some(Color::from_hex("#FF0000").unwrap()),
                ..Default::default()
            }),
            ..Default::default()
        },
    );
    engine.stores.cf_cache.insert(
        sid,
        super::super::stores::CFCacheEntry {
            results: cf_results,
            dirty: false,
        },
    );

    let source = engine.get_transferable_format(&sid, 0, 0);
    assert_eq!(source.font_color.as_deref(), Some("theme:accent1"));
    assert_eq!(source.font_charset, Some(128));
    assert_eq!(source.font_family_type, Some(2));
    assert_eq!(source.quote_prefix, Some(true));
    assert_eq!(source.pivot_button, Some(true));
    assert_eq!(source.extensions.as_ref(), Some(&extensions));
    let source_borders = source.borders.as_ref().expect("source borders");
    assert!(source_borders.top.is_none());
    assert_eq!(
        source_borders.bottom.as_ref().and_then(|side| side.style),
        Some(BorderStyle::Dashed)
    );

    // Reproduce the public dense-read -> tri-state-write lowering: null fields
    // become explicit clears, while non-null fields become the patch payload.
    let source_json = serde_json::to_value(&source).unwrap();
    let clear_fields = source_json
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, value)| value.is_null())
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    let patch: CellFormat = serde_json::from_value(source_json).unwrap();
    engine
        .patch_format_for_ranges(&sid, &[(0, 1, 0, 1)], &patch, &clear_fields)
        .unwrap();

    let target = engine.get_transferable_format(&sid, 0, 1);
    assert_eq!(target.font_color.as_deref(), Some("theme:accent1"));
    assert_eq!(target.font_charset, Some(128));
    assert_eq!(target.font_family_type, Some(2));
    assert_eq!(target.quote_prefix, Some(true));
    assert_eq!(target.pivot_button, Some(true));
    assert_eq!(target.extensions.as_ref(), Some(&extensions));
    let target_borders = target.borders.as_ref().expect("transferred borders");
    assert!(
        target_borders.top.is_none(),
        "a supplied top-level borders value must replace target-only sides"
    );
    assert_eq!(
        target_borders.bottom.as_ref().and_then(|side| side.style),
        Some(BorderStyle::Dashed)
    );
    assert_eq!(
        target.background_color, None,
        "a source null must clear the target-only direct fill"
    );
    assert_ne!(
        target.italic,
        Some(true),
        "conditional-format overlays are displayed state, not transferable state"
    );

    let displayed_before_theme_change = engine.get_displayed_cell_properties(&sid, 0, 1);
    assert_eq!(
        displayed_before_theme_change.font_color.as_deref(),
        Some("#123456")
    );
    assert_eq!(displayed_before_theme_change.italic, Some(true));
    assert_eq!(
        displayed_before_theme_change.background_color.as_deref(),
        Some("#ff0000")
    );

    engine.set_workbook_theme(theme("#654321")).unwrap();
    let transferable_after_theme_change = engine.get_transferable_format(&sid, 0, 1);
    let displayed_after_theme_change = engine.get_displayed_cell_properties(&sid, 0, 1);
    assert_eq!(
        transferable_after_theme_change.font_color.as_deref(),
        Some("theme:accent1"),
        "read->set must retain symbolic theme linkage"
    );
    assert_eq!(
        displayed_after_theme_change.font_color.as_deref(),
        Some("#654321")
    );
}
