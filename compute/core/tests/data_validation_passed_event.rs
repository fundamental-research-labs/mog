//! Regression test for the validation:passed event gap.
//!
//! Symptom (right-fix/rust-event-emit, Hack A):
//!   When a cell with a data-validation rule transitioned from invalid to
//!   valid, the renderer's validation circle stayed on screen. The TS layer
//!   compensated by re-running `validations.validate()` for every
//!   `cell:changed` event. Root cause: Rust's `prepare_recalc_for_flush`
//!   only emitted `RecalcValidationAnnotation`s for **column schemas** —
//!   never for the `dataValidations` Y.Array used by Excel-style data
//!   validation rules. So a cell that was previously flagged invalid (and
//!   had a circle drawn) and was now edited to a valid value would never
//!   appear in the post-recalc annotation payload, and the TS bridge had
//!   nothing to translate into a `validation:passed` event.
//!
//! Fix: After running column-schema validation, also iterate every
//! `changed_cell` and check it against the sheet's `dataValidations` rules.
//! Emit an annotation for both pass (`errors: []`) and fail. The TS bridge
//! treats empty errors as a `validation:passed` transition.
//!
//! Run:
//!   cargo test -p compute-core --test data_validation_passed_event

use cell_types::{CellId, SheetId};
use compute_core::storage::engine::YrsComputeEngine;
use compute_core::storage::sheet::schemas::{
    EnforcementLevel, IdentityRangeSchemaRef, RangeSchema, RangeSchemaDefinition,
    SchemaConstraints, SchemaType,
};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "00000000-0000-0000-0000-000000000001";
const CELL_A1_UUID: &str = "00000000-0000-0000-0000-000000000010";
const CELL_A2_UUID: &str = "00000000-0000-0000-0000-000000000011";

fn snapshot_with_one_cell() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.into(),
            name: "Sheet1".into(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: CELL_A1_UUID.into(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::new(50.0).unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: CELL_A2_UUID.into(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::new(50.0).unwrap()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Build a RangeSchema covering A1:A10 with a Number constraint between 0 and 100.
///
/// Uses the lightweight "row:col" range encoding accepted by
/// `compute_core::storage::sheet::schemas::position_in_range`.
fn dv_schema_a1_a10() -> RangeSchema {
    RangeSchema {
        id: "rs-test-1".to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: "0:0".to_string(),
            end_id: "9:0".to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Number),
            constraints: Some(SchemaConstraints {
                min: Some(0.0),
                max: Some(100.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}

#[test]
fn invalid_to_valid_transition_emits_passed_annotation() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_one_cell()).expect("from_snapshot");
    let sid = SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // Install a data-validation rule: A1:A10 must be between 0 and 100.
    engine
        .set_range_schema(&sid, &dv_schema_a1_a10())
        .expect("set_range_schema");

    let cell_a1 = CellId::from_uuid_str(CELL_A1_UUID).unwrap();

    // Step 1: set A1 to an invalid value (200, exceeds max=100).
    let result_invalid = engine
        .set_cell(&sid, cell_a1, 0, 0, "200".into())
        .expect("set_cell invalid")
        .1;
    let recalc = &result_invalid.recalc;
    let a1_anns: Vec<_> = recalc
        .validation_annotations
        .iter()
        .filter(|a| a.row == 0 && a.column == 0)
        .collect();
    assert_eq!(
        a1_anns.len(),
        1,
        "exactly one annotation should be emitted for A1 on invalid value"
    );
    assert!(
        !a1_anns[0].errors.is_empty(),
        "invalid value should produce an annotation with non-empty errors, got {:?}",
        a1_anns[0].errors
    );

    // Step 2: set A1 to a valid value (50, in range).
    // The bug pre-fix: NO annotation was produced because the engine only
    // checked column schemas, not data-validation rules. The TS layer never
    // saw a transition event and the validation circle stayed visible.
    let result_valid = engine
        .set_cell(&sid, cell_a1, 0, 0, "50".into())
        .expect("set_cell valid")
        .1;
    let recalc = &result_valid.recalc;
    let a1_anns: Vec<_> = recalc
        .validation_annotations
        .iter()
        .filter(|a| a.row == 0 && a.column == 0)
        .collect();
    assert_eq!(
        a1_anns.len(),
        1,
        "the invalid→valid transition must emit exactly one annotation \
         so the TS bridge can fire validation:passed and clear the circle"
    );
    assert!(
        a1_anns[0].errors.is_empty(),
        "valid value should produce an annotation with empty errors (which \
         the TS bridge translates to validation:passed), got {:?}",
        a1_anns[0].errors
    );
    assert_eq!(a1_anns[0].cell_id, cell_a1.to_uuid_string());
}

#[test]
fn cell_outside_data_validation_range_produces_no_annotation() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_one_cell()).expect("from_snapshot");
    let sid = SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // Schema covers A1:A10 (col 0 only). A cell at B2 (col 1) is outside.
    engine
        .set_range_schema(&sid, &dv_schema_a1_a10())
        .expect("set_range_schema");

    // Set B2 — outside the range. Adds a new cell.
    let cell_b2 = CellId::from_uuid_str("00000000-0000-0000-0000-0000000000B2").unwrap();
    let result = engine
        .set_cell(&sid, cell_b2, 1, 1, "999".into())
        .expect("set_cell outside range")
        .1;
    let recalc = &result.recalc;
    let b2_anns: Vec<_> = recalc
        .validation_annotations
        .iter()
        .filter(|a| a.row == 1 && a.column == 1)
        .collect();
    assert!(
        b2_anns.is_empty(),
        "cells outside any DV range should produce no annotation, got {:?}",
        b2_anns
    );
}

#[test]
fn valid_to_invalid_transition_emits_failed_annotation() {
    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(snapshot_with_one_cell()).expect("from_snapshot");
    let sid = SheetId::from_uuid_str(SHEET_UUID).unwrap();

    engine
        .set_range_schema(&sid, &dv_schema_a1_a10())
        .expect("set_range_schema");

    let cell_a2 = CellId::from_uuid_str(CELL_A2_UUID).unwrap();

    // Set A2 to a valid value first.
    let result_valid = engine
        .set_cell(&sid, cell_a2, 1, 0, "75".into())
        .expect("set_cell valid")
        .1;
    let recalc = &result_valid.recalc;
    let a2_anns: Vec<_> = recalc
        .validation_annotations
        .iter()
        .filter(|a| a.row == 1 && a.column == 0)
        .collect();
    assert_eq!(a2_anns.len(), 1, "valid value emits an annotation");
    assert!(a2_anns[0].errors.is_empty(), "valid → empty errors");

    // Now set A2 to an invalid value.
    let result_invalid = engine
        .set_cell(&sid, cell_a2, 1, 0, "-50".into())
        .expect("set_cell invalid")
        .1;
    let recalc = &result_invalid.recalc;
    let a2_anns: Vec<_> = recalc
        .validation_annotations
        .iter()
        .filter(|a| a.row == 1 && a.column == 0)
        .collect();
    assert_eq!(a2_anns.len(), 1, "invalid value emits an annotation");
    assert!(!a2_anns[0].errors.is_empty(), "invalid → non-empty errors");
}
