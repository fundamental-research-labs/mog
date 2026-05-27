use crate::snapshot::{CalculationSettings, ChangeKind};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::mutation::CellInput;
use cell_types::{SheetId, SheetPos};
use snapshot_types::{RecalcOptions, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

fn build_engine() -> YrsComputeEngine {
    let snap = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 10,
            cols: 10,
            cells: vec![],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
    engine
}

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).expect("test sheet id")
}

fn parse_input(text: &str) -> CellInput {
    CellInput::Parse {
        text: text.to_string(),
    }
}

fn number_at(engine: &YrsComputeEngine, row: u32, col: u32) -> f64 {
    match engine
        .mirror()
        .get_cell_value_at(&sheet_id(), SheetPos::new(row, col))
    {
        Some(CellValue::Number(n)) => n.get(),
        other => panic!("expected numeric value at ({row}, {col}), got {other:?}"),
    }
}

fn assert_close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: expected {expected} +/- {tolerance}, got {actual}"
    );
}

#[test]
fn validate_formula_syntax_accepts_valid_and_runtime_error_formulas() {
    let engine = build_engine();
    let sheet_id = sheet_id();

    assert_eq!(
        engine.validate_formula_syntax(&sheet_id, "=SUM(A1:A3)"),
        None
    );
    assert_eq!(
        engine.validate_formula_syntax(&sheet_id, "=UNKNOWN_FN(1)"),
        None,
        "unknown functions are semantic/runtime errors, not syntax errors"
    );
    assert_eq!(
        engine.validate_formula_syntax(&sheet_id, "=1/0"),
        None,
        "runtime errors must still commit and evaluate to spreadsheet errors"
    );
}

#[test]
fn validate_formula_syntax_rejects_raw_unclosed_paren_before_normalization() {
    let engine = build_engine();
    let sheet_id = sheet_id();

    let result = engine
        .validate_formula_syntax(&sheet_id, "=SUM(1,2")
        .expect("unclosed formula should be rejected");

    assert!(
        result.0.contains("close") || result.0.contains("unexpected end"),
        "expected parser syntax error, got {result:?}"
    );
    assert!(result.1.is_some(), "parser should provide an error offset");
}

#[test]
fn set_workbook_settings_returns_workbook_settings_change() {
    let mut engine = build_engine();
    let pre = engine.get_workbook_settings();
    let mut next = pre.clone();
    next.show_horizontal_scrollbar = !pre.show_horizontal_scrollbar;
    next.theme_id = "dark".to_string();

    let (_patches, result) = engine
        .set_workbook_settings(next)
        .expect("set_workbook_settings");
    assert_eq!(result.workbook_settings_changes.len(), 1);
    let change = &result.workbook_settings_changes[0];
    assert_eq!(change.kind, ChangeKind::Set);
    assert!(
        change
            .changed_keys
            .iter()
            .any(|k| k == "showHorizontalScrollbar"),
        "changed_keys must include showHorizontalScrollbar; got {:?}",
        change.changed_keys
    );
    assert!(
        change.changed_keys.iter().any(|k| k == "themeId"),
        "changed_keys must include themeId; got {:?}",
        change.changed_keys
    );
    assert!(change.settings.is_object());
    assert_eq!(
        change.settings.get("themeId").and_then(|v| v.as_str()),
        Some("dark")
    );
}

#[test]
fn reset_workbook_settings_returns_workbook_settings_change() {
    let mut engine = build_engine();
    let mut next = engine.get_workbook_settings();
    next.theme_id = "dark".to_string();
    next.show_formula_bar = false;
    engine
        .set_workbook_settings(next)
        .expect("seed non-defaults");

    let (_patches, result) = engine
        .reset_workbook_settings()
        .expect("reset_workbook_settings");
    assert_eq!(result.workbook_settings_changes.len(), 1);
    let change = &result.workbook_settings_changes[0];
    assert_eq!(
        change.kind,
        ChangeKind::Removed,
        "reset must signal Removed kind"
    );
    assert!(
        !change.changed_keys.is_empty(),
        "reset must enumerate the keys that diverged from defaults"
    );
    assert!(change.settings.is_object());
    assert_eq!(
        change.settings.get("themeId").and_then(|v| v.as_str()),
        Some("office"),
        "post-reset themeId must be the default 'office'"
    );
}

#[test]
fn set_workbook_settings_syncs_iterative_runtime_before_formula_recalc() {
    let mut engine = build_engine();
    let sid = sheet_id();
    let mut settings = engine.get_workbook_settings();
    settings.calculation_settings = Some(CalculationSettings {
        enable_iterative_calculation: true,
        max_iterations: 100,
        ..CalculationSettings::default()
    });

    engine
        .set_workbook_settings(settings)
        .expect("set workbook settings");

    let (_patches, result) = engine
        .batch_set_cells_by_position(
            vec![
                (sid, 0, 0, parse_input("=B1+1")),
                (sid, 0, 1, parse_input("=A1*0.5")),
            ],
            true,
        )
        .expect("batch set circular formulas");

    assert!(
        result.recalc.metrics.iterative_iterations > 1,
        "formula mutation should use iterative runtime settings; metrics = {:?}",
        result.recalc.metrics
    );
    assert_close(number_at(&engine, 0, 0), 2.0, 0.01, "A1");
    assert_close(number_at(&engine, 0, 1), 1.0, 0.01, "B1");
}

#[test]
fn set_calculation_settings_marks_dirty_for_existing_circular_recalc() {
    let mut engine = build_engine();
    let sid = sheet_id();

    engine
        .batch_set_cells_by_position(
            vec![
                (sid, 0, 0, parse_input("=B1+1")),
                (sid, 0, 1, parse_input("=A1*0.5")),
            ],
            true,
        )
        .expect("batch set circular formulas");

    engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("non-iterative recalc should run");
    assert!(
        (number_at(&engine, 0, 0) - 2.0).abs() > 0.01,
        "test setup should leave A1 non-converged before iterative calc is enabled"
    );

    engine
        .set_calculation_settings(CalculationSettings {
            enable_iterative_calculation: true,
            max_iterations: 100,
            ..CalculationSettings::default()
        })
        .expect("set calculation settings");

    let result = engine
        .recalculate_with_options(&RecalcOptions::default())
        .expect("bare recalculate after settings change");
    assert!(
        result.metrics.iterative_iterations > 1,
        "settings-only change must dirty compute and use iterative runtime settings; metrics = {:?}",
        result.metrics
    );
    assert_close(number_at(&engine, 0, 0), 2.0, 0.01, "A1");
    assert_close(number_at(&engine, 0, 1), 1.0, 0.01, "B1");
}

#[test]
fn from_yrs_state_hydrates_runtime_calculation_settings() {
    let mut engine_a = build_engine();
    let mut settings = engine_a.get_workbook_settings();
    settings.calculation_settings = Some(CalculationSettings {
        enable_iterative_calculation: true,
        max_iterations: 100,
        ..CalculationSettings::default()
    });
    engine_a
        .set_workbook_settings(settings)
        .expect("set workbook settings");

    let state = compute_collab::encode_full_state(engine_a.storage().doc());
    let (mut engine_b, _) = YrsComputeEngine::from_yrs_state(&state).expect("from_yrs_state");
    let sid = sheet_id();
    let (_patches, result) = engine_b
        .batch_set_cells_by_position(
            vec![
                (sid, 0, 0, parse_input("=B1+1")),
                (sid, 0, 1, parse_input("=A1*0.5")),
            ],
            true,
        )
        .expect("batch set circular formulas");

    assert!(
        result.recalc.metrics.iterative_iterations > 1,
        "from_yrs_state must hydrate iterative runtime settings; metrics = {:?}",
        result.recalc.metrics
    );
    assert_close(number_at(&engine_b, 0, 0), 2.0, 0.01, "A1");
    assert_close(number_at(&engine_b, 0, 1), 1.0, 0.01, "B1");
}

#[test]
fn apply_sync_update_syncs_remote_runtime_calculation_settings_before_cell_recalc() {
    let mut engine_a = build_engine();
    let full_state = compute_collab::encode_full_state(engine_a.storage().doc());
    let (mut engine_b, _) = YrsComputeEngine::from_yrs_state(&full_state).expect("from_yrs_state");
    let engine_b_state_vector = engine_b.encode_state_vector();

    let mut settings = engine_a.get_workbook_settings();
    settings.calculation_settings = Some(CalculationSettings {
        enable_iterative_calculation: true,
        max_iterations: 100,
        ..CalculationSettings::default()
    });
    engine_a
        .set_workbook_settings(settings)
        .expect("set workbook settings");
    let sid = sheet_id();
    engine_a
        .batch_set_cells_by_position(
            vec![
                (sid, 0, 0, parse_input("=B1+1")),
                (sid, 0, 1, parse_input("=A1*0.5")),
            ],
            true,
        )
        .expect("batch set circular formulas");

    let delta = engine_a
        .encode_diff(&engine_b_state_vector)
        .expect("encode A to B diff");
    let (_patches, result) = engine_b
        .apply_sync_update(&delta)
        .expect("apply A to B diff");

    assert!(
        result.recalc.metrics.iterative_iterations > 1,
        "remote settings must sync before remote formulas recalc; metrics = {:?}",
        result.recalc.metrics
    );
    assert_close(number_at(&engine_b, 0, 0), 2.0, 0.01, "A1");
    assert_close(number_at(&engine_b, 0, 1), 1.0, 0.01, "B1");
}
