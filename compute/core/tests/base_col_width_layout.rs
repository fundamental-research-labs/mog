//! Production-path layout regressions for OOXML `baseColWidth`.
//!
//! These tests deliberately enter through XLSX parsing/hydration and inspect
//! both the `LayoutIndex` and the binary viewport payload.  The same fixture
//! is exercised with explicit MDW profiles so a sheet's character-unit base
//! width is converted using the active renderer profile rather than the
//! platform fallback.

use compute_core::storage::engine::YrsComputeEngine;
use compute_wire::constants::{
    CELL_STRIDE, DATA_BAR_ENTRY_STRIDE, DIM_STRIDE, ICON_ENTRY_STRIDE, MERGE_STRIDE,
    VIEWPORT_HEADER_SIZE,
};
use domain_types::{CellData, ParseOutput, SheetData, SheetDimensions};
use snapshot_types::WorkbookSnapshot;
use value_types::CellValue;

const SHEET_ROWS: u32 = 4;
const SHEET_COLS: u32 = 4;

fn xlsx_fixture(dimensions: SheetDimensions) -> Vec<u8> {
    // Equivalent to the prepared baseColWidth fixture: the worksheet has a
    // real cell so the viewport path emits a normal cell record as well as
    // the default column dimensions.
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "BaseWidth".to_string(),
            rows: SHEET_ROWS,
            cols: SHEET_COLS,
            cells: vec![CellData {
                row: 0,
                col: 0,
                value: CellValue::Text("layout probe".into()),
                ..Default::default()
            }],
            dimensions,
            ..Default::default()
        }],
        ..Default::default()
    };

    xlsx_parser::write::write_xlsx_from_parse_output(&output)
        .expect("baseColWidth regression fixture should be writable")
}

fn base_only_xlsx() -> Vec<u8> {
    xlsx_fixture(SheetDimensions {
        base_col_width: Some(10),
        ..Default::default()
    })
}

fn explicit_and_base_xlsx() -> Vec<u8> {
    xlsx_fixture(SheetDimensions {
        default_col_width: Some(9.25),
        base_col_width: Some(10),
        ..Default::default()
    })
}

fn profile_fallback_xlsx() -> Vec<u8> {
    xlsx_fixture(SheetDimensions::default())
}

fn metrics(mdw: f64) -> domain_types::units::LayoutMetrics {
    domain_types::units::LayoutMetrics::from_column_width_mdw(mdw)
        .expect("regression MDW should produce valid layout metrics")
}

fn import_directly(xlsx: &[u8], mdw: f64) -> YrsComputeEngine {
    let (mut engine, _) = YrsComputeEngine::from_snapshot_with_layout_metrics(
        WorkbookSnapshot::default(),
        metrics(mdw),
    )
    .expect("blank engine should initialize with explicit layout metrics");
    engine
        .import_from_xlsx_bytes_no_recalc(xlsx)
        .expect("XLSX import should rebuild the production engine path");
    engine
}

fn first_sheet(engine: &YrsComputeEngine) -> cell_types::SheetId {
    *engine
        .mirror()
        .sheet_ids()
        .next()
        .expect("fixture should contain one sheet")
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(
        bytes[offset..offset + 2]
            .try_into()
            .expect("viewport u16 should be in bounds"),
    )
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("viewport u32 should be in bounds"),
    )
}

fn read_f32(bytes: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("viewport f32 should be in bounds"),
    )
}

fn read_f64(bytes: &[u8], offset: usize) -> f64 {
    f64::from_le_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("viewport f64 should be in bounds"),
    )
}

/// Read the column dimensions and cumulative column positions from the
/// production binary viewport response.  This mirrors the documented wire
/// section order without reaching into engine state or mutating anything.
fn viewport_columns(bytes: &[u8]) -> (Vec<(u32, f32, bool)>, Vec<f64>) {
    assert!(
        bytes.len() >= VIEWPORT_HEADER_SIZE,
        "viewport response must contain its header"
    );

    let cell_count = read_u32(bytes, 8) as usize;
    let palette_bytes = read_u32(bytes, 12) as usize;
    let string_pool_bytes = read_u32(bytes, 16) as usize;
    let viewport_rows = read_u16(bytes, 20) as usize;
    let viewport_cols = read_u16(bytes, 22) as usize;
    let merge_count = read_u16(bytes, 24) as usize;
    let row_dim_count = read_u16(bytes, 26) as usize;
    let col_dim_count = read_u16(bytes, 28) as usize;
    let data_bar_count = read_u16(bytes, 32) as usize;
    let icon_count = read_u16(bytes, 34) as usize;

    let mut cursor = VIEWPORT_HEADER_SIZE
        + cell_count * CELL_STRIDE
        + string_pool_bytes
        + merge_count * MERGE_STRIDE
        + row_dim_count * DIM_STRIDE;
    let col_dimensions = (0..col_dim_count)
        .map(|_| {
            let col = read_u32(bytes, cursor);
            let width = read_f32(bytes, cursor + 4);
            let hidden = read_u32(bytes, cursor + 8) != 0;
            cursor += DIM_STRIDE;
            (col, width, hidden)
        })
        .collect();

    cursor +=
        palette_bytes + data_bar_count * DATA_BAR_ENTRY_STRIDE + icon_count * ICON_ENTRY_STRIDE;

    let position_bytes = (if viewport_rows == 0 {
        0
    } else {
        viewport_rows + 1
    } + if viewport_cols == 0 {
        0
    } else {
        viewport_cols + 1
    }) * 8;
    assert_eq!(
        bytes.len(),
        cursor + position_bytes,
        "viewport response should contain only the documented sections"
    );

    let col_positions_start = if viewport_cols == 0 {
        bytes.len()
    } else {
        bytes.len() - (viewport_cols + 1) * 8
    };
    let col_positions = (0..=viewport_cols)
        .map(|index| read_f64(bytes, col_positions_start + index * 8))
        .collect();

    (col_dimensions, col_positions)
}

fn assert_layout_and_viewport_width(engine: &YrsComputeEngine, expected_width: f64) {
    let sheet = first_sheet(engine);
    let layout = engine
        .layout_index(&sheet)
        .expect("import should build a LayoutIndex");

    assert_eq!(
        layout.get_col_width(0).0,
        expected_width,
        "LayoutIndex default width"
    );
    assert_eq!(
        engine.get_col_width_from_index(&sheet, 0),
        expected_width,
        "engine layout width query"
    );
    assert_eq!(
        engine.get_col_position(&sheet, 1),
        expected_width,
        "first column position"
    );
    assert_eq!(
        engine.get_col_position(&sheet, 2),
        expected_width * 2.0,
        "second column position"
    );

    let viewport = engine.get_viewport_binary(&sheet, 0, 0, 1, 3, false);
    let (columns, positions) = viewport_columns(&viewport);
    assert_eq!(
        columns,
        vec![
            (0, expected_width as f32, false),
            (1, expected_width as f32, false),
            (2, expected_width as f32, false),
        ],
        "viewport column dimensions must use the resolved default width"
    );
    assert_eq!(
        positions,
        vec![
            0.0,
            expected_width,
            expected_width * 2.0,
            expected_width * 3.0
        ],
        "viewport cumulative column positions must use the resolved width"
    );
}

#[test]
fn base_col_width_drives_layout_and_viewport_for_mdw_profiles() {
    let xlsx = base_only_xlsx();

    for (mdw, expected_width) in [(7.0, 75.0), (8.0, 85.0)] {
        let mut engine = import_directly(&xlsx, mdw);
        assert_layout_and_viewport_width(&engine, expected_width);

        // The Yrs-backed rebuild uses round-trip sheet metadata, so the same
        // base-derived default must survive a production rebuild as well.
        engine
            .rebuild_compute_core()
            .expect("compute-core rebuild should preserve baseColWidth layout");
        assert_layout_and_viewport_width(&engine, expected_width);
    }
}

#[test]
fn base_col_width_survives_sync_reload_and_deferred_hydration() {
    let xlsx = base_only_xlsx();

    for (mdw, expected_width) in [(7.0, 75.0), (8.0, 85.0)] {
        let source = import_directly(&xlsx, mdw);
        let state = source.sync_full_state();
        let (mut reloaded, _) =
            YrsComputeEngine::from_yrs_state_with_layout_metrics(&state, metrics(mdw))
                .expect("synced Yrs state should reload with explicit layout metrics");
        assert_layout_and_viewport_width(&reloaded, expected_width);
        reloaded
            .rebuild_compute_core()
            .expect("reloaded compute core should rebuild its layout");
        assert_layout_and_viewport_width(&reloaded, expected_width);

        let (mut deferred, _) = YrsComputeEngine::from_snapshot_with_layout_metrics(
            WorkbookSnapshot::default(),
            metrics(mdw),
        )
        .expect("deferred target engine should initialize");
        deferred
            .import_from_xlsx_bytes_deferred(&xlsx)
            .expect("deferred XLSX import should build first-paint indexes");
        assert_layout_and_viewport_width(&deferred, expected_width);
        deferred
            .complete_deferred_hydration()
            .expect("deferred hydration should commit the Yrs document");
        assert_layout_and_viewport_width(&deferred, expected_width);
    }
}

#[test]
fn explicit_default_col_width_wins_over_base_and_missing_values_use_profile_fallback() {
    for (mdw, explicit_width, fallback_width) in [(7.0, 70.0, 64.0), (8.0, 79.0, 72.0)] {
        let explicit = explicit_and_base_xlsx();
        let mut explicit_engine = import_directly(&explicit, mdw);
        assert_layout_and_viewport_width(&explicit_engine, explicit_width);
        explicit_engine
            .rebuild_compute_core()
            .expect("explicit default width should survive rebuild");
        assert_layout_and_viewport_width(&explicit_engine, explicit_width);

        let fallback = profile_fallback_xlsx();
        let fallback_engine = import_directly(&fallback, mdw);
        assert_layout_and_viewport_width(&fallback_engine, fallback_width);

        // Exercise the parse-output index builder as well as the Yrs metadata
        // index builder for both precedence cases.
        for (fixture, expected_width, label) in [
            (&explicit, explicit_width, "explicit default"),
            (&fallback, fallback_width, "profile fallback"),
        ] {
            let (mut deferred, _) = YrsComputeEngine::from_snapshot_with_layout_metrics(
                WorkbookSnapshot::default(),
                metrics(mdw),
            )
            .expect("deferred target engine should initialize");
            deferred
                .import_from_xlsx_bytes_deferred(fixture)
                .unwrap_or_else(|error| panic!("{label} deferred import failed: {error}"));
            assert_layout_and_viewport_width(&deferred, expected_width);
            deferred
                .complete_deferred_hydration()
                .unwrap_or_else(|error| panic!("{label} deferred hydration failed: {error}"));
            assert_layout_and_viewport_width(&deferred, expected_width);
        }
    }
}
