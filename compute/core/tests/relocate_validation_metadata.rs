//! Regression coverage for data-validation metadata during CellId-preserving
//! relocate/cut-paste.
//!
//! `relocate_cells_yrs` is the production cut-paste primitive. Cell values and
//! CellIds move through the GridIndex, but range-backed validation rules are
//! position-owned metadata and must be explicitly transformed.

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use compute_core::storage::sheet::schemas::{
    EnforcementLevel, IdentityRangeSchemaRef, RangeSchema, RangeSchemaDefinition,
    SchemaConstraints, SchemaType,
};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::CellValue;

const SHEET_UUID: &str = "00000000000000000000000000000001";

fn cell_uuid(row: u32, col: u32) -> String {
    format!("000000000000000000000000{:04x}{:04x}", row, col)
}

fn make_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn engine_with(cells: Vec<CellData>) -> (YrsComputeEngine, SheetId) {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet uuid");
    (engine, sheet_id)
}

fn whole_number_schema(id: &str, start: &str, end: &str) -> RangeSchema {
    RangeSchema {
        id: id.to_string(),
        created_at: 1700000000,
        ranges: vec![IdentityRangeSchemaRef {
            start_id: start.to_string(),
            end_id: end.to_string(),
            sheet_id: None,
        }],
        schema: RangeSchemaDefinition {
            schema_type: Some(SchemaType::Integer),
            constraints: Some(SchemaConstraints {
                min: Some(1.0),
                max: Some(10.0),
                ..Default::default()
            }),
        },
        enforcement: Some(EnforcementLevel::Strict),
        ui: None,
    }
}

fn schema_covers(schema: &RangeSchema, row: u32, col: u32) -> bool {
    schema.ranges.iter().any(|range| {
        let Some((start_row, start_col)) = parse_ref(&range.start_id) else {
            return false;
        };
        let Some((end_row, end_col)) = parse_ref(&range.end_id) else {
            return false;
        };
        row >= start_row.min(end_row)
            && row <= start_row.max(end_row)
            && col >= start_col.min(end_col)
            && col <= start_col.max(end_col)
    })
}

fn parse_ref(value: &str) -> Option<(u32, u32)> {
    let (row, col) = value.split_once(':')?;
    Some((row.parse().ok()?, col.parse().ok()?))
}

#[test]
fn relocate_cells_yrs_moves_single_cell_validation_rule() {
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, CellValue::number(5.0))]);

    engine
        .set_range_schema(&sheet_id, &whole_number_schema("rs-a1", "0:0", "0:0"))
        .expect("set_range_schema");

    engine
        .relocate_cells_yrs(&sheet_id, 0, 0, 0, 0, &sheet_id, 0, 1)
        .expect("relocate_cells_yrs");

    let schemas = engine.get_range_schemas_for_sheet(&sheet_id);
    assert!(
        schemas.iter().any(|schema| schema_covers(schema, 0, 1)),
        "B1 must inherit A1's validation rule after cut-paste; schemas={schemas:?}",
    );
    assert!(
        !schemas.iter().any(|schema| schema_covers(schema, 0, 0)),
        "A1 must lose validation after the rule moves away; schemas={schemas:?}",
    );
}

#[test]
fn relocate_cells_yrs_splits_partially_moved_validation_range() {
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, CellValue::number(5.0))]);

    engine
        .set_range_schema(&sheet_id, &whole_number_schema("rs-a1-a3", "0:0", "2:0"))
        .expect("set_range_schema");

    engine
        .relocate_cells_yrs(&sheet_id, 0, 0, 0, 0, &sheet_id, 0, 1)
        .expect("relocate_cells_yrs");

    let schemas = engine.get_range_schemas_for_sheet(&sheet_id);
    assert!(
        !schemas.iter().any(|schema| schema_covers(schema, 0, 0)),
        "moved source cell A1 must be removed from the original validation range",
    );
    assert!(
        schemas.iter().any(|schema| schema_covers(schema, 1, 0)),
        "unmoved source-adjacent cell A2 must keep the original validation rule",
    );
    assert!(
        schemas.iter().any(|schema| schema_covers(schema, 2, 0)),
        "unmoved source-adjacent cell A3 must keep the original validation rule",
    );
    assert!(
        schemas.iter().any(|schema| schema_covers(schema, 0, 1)),
        "destination B1 must receive the moved validation fragment",
    );
}
