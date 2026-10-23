//! Stored OOXML widths and unpadded base counts have different unit contracts.

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
use domain_types::{CellData, ParseOutput, SheetData, SheetDimensions, units::LayoutMetrics};
use snapshot_types::WorkbookSnapshot;
use value_types::CellValue;

fn metrics(mdw: f64) -> LayoutMetrics {
    LayoutMetrics::from_column_width_mdw(mdw).unwrap()
}

fn blank(mdw: f64) -> ComputeEngine {
    ComputeEngine::from_snapshot_with_layout_metrics(WorkbookSnapshot::default(), metrics(mdw))
        .unwrap()
        .0
}

fn fixture(dimensions: SheetDimensions) -> Vec<u8> {
    xlsx_parser::write::write_xlsx_from_parse_output(&ParseOutput {
        sheets: vec![SheetData {
            name: "Widths".to_string(),
            rows: 4,
            cols: 4,
            cells: vec![CellData {
                row: 0,
                col: 0,
                value: CellValue::Text("width probe".into()),
                ..Default::default()
            }],
            dimensions,
            ..Default::default()
        }],
        ..Default::default()
    })
    .unwrap()
}

fn import(bytes: &[u8], mdw: f64) -> (ComputeEngine, SheetId) {
    let mut engine = blank(mdw);
    engine.import_from_xlsx_bytes_no_recalc(bytes).unwrap();
    let sheet = *engine.cell_store().sheet_ids().next().unwrap();
    (engine, sheet)
}

fn import_with_custom_fallback() -> (ComputeEngine, SheetId) {
    let (mut engine, _) = ComputeEngine::from_snapshot_with_layout_metrics(
        WorkbookSnapshot::default(),
        LayoutMetrics {
            column_width_mdw: 9.0,
            default_column_width_px: 123.0,
            default_row_height_px: 20.0,
        },
    )
    .unwrap();
    engine
        .import_from_xlsx_bytes_no_recalc(&fixture(SheetDimensions::default()))
        .unwrap();
    let sheet = *engine.cell_store().sheet_ids().next().unwrap();
    (engine, sheet)
}

#[test]
fn base_only_queries_match_index_and_keep_original_metadata() {
    let bytes = fixture(SheetDimensions {
        base_col_width: Some(10),
        ..Default::default()
    });
    for (mdw, expected, raw) in [(7.0, 75.0, 10.7109375), (8.0, 85.0, 10.625)] {
        let (engine, sheet) = import(&bytes, mdw);
        assert_eq!(engine.get_col_width_query(&sheet, 0), expected);
        assert_eq!(engine.get_default_col_width(&sheet), expected);
        assert_eq!(engine.get_col_width_from_index(&sheet, 0), expected);
        assert_eq!(engine.get_col_width_chars_query(&sheet, 0), raw);
        assert_eq!(engine.get_default_col_width_chars(&sheet), raw);
        assert_eq!(
            engine.get_sheet_meta(&sheet).unwrap().default_col_width,
            raw
        );
        assert_eq!(
            engine.get_col_widths_batch(&sheet, 0, 1),
            vec![(0, expected), (1, expected)]
        );
        assert_eq!(
            engine.get_col_widths_batch_chars(&sheet, 0, 1),
            vec![(0, raw), (1, raw)]
        );
        let exported = engine.export_to_parse_output().unwrap().parse_output;
        assert_eq!(exported.sheets[0].dimensions.default_col_width, None);
        assert_eq!(exported.sheets[0].dimensions.base_col_width, Some(10));
    }
}

#[test]
fn explicit_raw_default_is_not_reinterpreted_as_a_base_count() {
    let bytes = fixture(SheetDimensions {
        default_col_width: Some(9.25),
        base_col_width: Some(10),
        ..Default::default()
    });
    for (mdw, expected) in [(7.0, 65.0), (8.0, 74.0)] {
        let (engine, sheet) = import(&bytes, mdw);
        assert_eq!(engine.get_col_width_query(&sheet, 0), expected);
        assert_eq!(engine.get_col_width_from_index(&sheet, 0), expected);
        assert_eq!(engine.get_default_col_width(&sheet), expected);
        assert_eq!(
            engine.get_sheet_meta(&sheet).unwrap().default_col_width,
            9.25
        );
        let exported = engine.export_to_parse_output().unwrap().parse_output;
        assert_eq!(exported.sheets[0].dimensions.default_col_width, Some(9.25));
        assert_eq!(exported.sheets[0].dimensions.base_col_width, Some(10));
    }
}

#[test]
fn pixel_setter_exports_raw_width_that_roundtrips_to_requested_pixels() {
    for (mdw, expected_raw) in [(7.0, 4.5703125), (8.0, 4.0)] {
        let mut engine = blank(mdw);
        engine.create_sheet("Widths").unwrap();
        let sheet = *engine.cell_store().sheet_ids().next().unwrap();
        engine.set_col_width(&sheet, 0, 32.0).unwrap();
        assert_eq!(engine.get_col_width_query(&sheet, 0), 32.0);
        let exported = engine.export_to_parse_output().unwrap().parse_output;
        assert_eq!(
            exported.sheets[0].dimensions.col_widths[0].width,
            expected_raw
        );
        let bytes = engine.export_to_xlsx_bytes().unwrap();
        let (reopened, reopened_sheet) = import(&bytes, mdw);
        assert_eq!(reopened.get_col_width_query(&reopened_sheet, 0), 32.0);
        assert_eq!(reopened.get_col_width_from_index(&reopened_sheet, 0), 32.0);
    }
}

#[test]
fn profile_fallback_pixels_and_created_sheet_defaults_are_preserved() {
    for (mdw, expected, raw) in [(7.0, 64.0, 9.140625), (8.0, 72.0, 9.0)] {
        let (imported, sheet) = import(&fixture(SheetDimensions::default()), mdw);
        assert_eq!(imported.get_col_width_query(&sheet, 0), expected);
        assert_eq!(imported.get_col_width_from_index(&sheet, 0), expected);
        assert_eq!(
            imported.get_sheet_meta(&sheet).unwrap().default_col_width,
            raw
        );
        let mut created = blank(mdw);
        created.create_sheet("Created").unwrap();
        let sheet = *created.cell_store().sheet_ids().next().unwrap();
        assert_eq!(created.get_col_width_query(&sheet, 0), expected);
        assert_eq!(created.get_col_width_from_index(&sheet, 0), expected);
        assert_eq!(
            created.get_sheet_meta(&sheet).unwrap().default_col_width,
            raw
        );
    }
}

#[test]
fn runtime_sheet_metadata_uses_custom_profile_fallback() {
    let (engine, sheet) = import_with_custom_fallback();
    assert_eq!(engine.get_default_col_width(&sheet), 123.0);
    assert_eq!(engine.get_col_width_from_index(&sheet, 0), 123.0);
    assert_eq!(engine.get_default_col_width_chars(&sheet), 13.6640625);
    assert_eq!(
        engine.get_sheet_meta(&sheet).unwrap().default_col_width,
        13.6640625
    );
}

#[test]
fn width_setters_use_the_active_default_when_removing_redundant_overrides() {
    let base = fixture(SheetDimensions {
        base_col_width: Some(10),
        ..Default::default()
    });
    for ((mut engine, sheet), raw, pixels, pixel_raw) in [
        (import(&base, 8.0), 10.7109375, 86.0, 10.75),
        (import_with_custom_fallback(), 9.140625, 82.0, 9.109375),
    ] {
        // These raw widths match the metadata-only MDW-7 fallback, but differ
        // from the actual runtime default. They must remain authored widths.
        engine.set_col_width_chars(&sheet, 0, raw).unwrap();
        engine.set_col_widths_chars(&sheet, &[(1, raw)]).unwrap();
        engine.set_col_width(&sheet, 2, pixels).unwrap();
        engine.set_col_widths(&sheet, &[(3, pixels)]).unwrap();
        let exported = engine.export_to_parse_output().unwrap().parse_output;
        for col in 0..4 {
            assert_eq!(engine.get_col_width_query(&sheet, col), pixels);
            assert_eq!(engine.get_col_width_from_index(&sheet, col), pixels);
            let expected_raw = if col < 2 { raw } else { pixel_raw };
            assert_eq!(engine.get_col_width_chars_query(&sheet, col), expected_raw);
            let dimension = exported.sheets[0]
                .dimensions
                .col_widths
                .iter()
                .find(|dimension| dimension.col == col)
                .unwrap();
            assert_eq!(dimension.width, expected_raw);
            assert_eq!(dimension.width_present, Some(true));
        }
    }
}

#[test]
fn undo_dimension_notification_uses_active_default_pixels() {
    let base = fixture(SheetDimensions {
        base_col_width: Some(10),
        ..Default::default()
    });
    for ((mut engine, sheet), expected) in [
        (import(&base, 8.0), 85.0),
        (import_with_custom_fallback(), 123.0),
    ] {
        engine.set_col_width(&sheet, 0, 160.0).unwrap();
        let result = engine.undo().unwrap();
        let change = result
            .dimension_changes
            .iter()
            .find(|change| change.index == 0)
            .unwrap();
        assert_eq!(change.size.as_ref().unwrap().get(), expected);
        assert_eq!(engine.get_col_width_query(&sheet, 0), expected);
        assert_eq!(engine.get_col_width_from_index(&sheet, 0), expected);
        engine.redo().unwrap();
        assert_eq!(engine.get_col_width_query(&sheet, 0), 160.0);
    }
}

#[test]
fn hidden_column_export_uses_custom_profile_fallback_without_changing_metadata() {
    let (mut engine, sheet) = import_with_custom_fallback();
    engine.hide_columns(&sheet, &[0]).unwrap();
    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let dimensions = &exported.sheets[0].dimensions;
    assert_eq!(dimensions.default_col_width, None);
    assert_eq!(dimensions.base_col_width, None);
    let hidden = dimensions
        .col_widths
        .iter()
        .find(|dimension| dimension.col == 0)
        .unwrap();
    assert!(hidden.hidden);
    assert_eq!(hidden.width, 13.6640625);
    engine.unhide_columns(&sheet, &[0]).unwrap();
    assert_eq!(engine.get_col_width_query(&sheet, 0), 123.0);
    assert_eq!(engine.get_col_width_from_index(&sheet, 0), 123.0);
}
