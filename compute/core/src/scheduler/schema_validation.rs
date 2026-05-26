//! Post-recalc schema validation -- validates dirty cells against column schemas.
//!
//! Two validation passes:
//! 1. **Direct validation**: validate each dirty cell against its column schema,
//!    including formula constraints via the compute engine evaluator.
//! 2. **Transitive revalidation**: for schemas with formula constraints, find
//!    cells in those columns that may be affected by dirty-cell changes and
//!    revalidate them. This catches cases where changing cell A1 invalidates
//!    a formula constraint on column B that references A1.

use super::*;
use crate::schema::inference;
use crate::schema::schema_map::SchemaMap;
use crate::schema::validator;
use crate::snapshot::{RecalcValidationAnnotation, RecalcValidationError};

impl ComputeCore {
    /// Validate recomputed cells against their column schemas.
    ///
    /// Returns IPC-friendly validation annotations for ALL validated cells
    /// (both pass and fail). Passed cells have an empty errors array.
    /// Called after recalc completes, before returning results.
    ///
    /// Performs two passes:
    /// 1. Validate directly-changed cells against their column schemas
    ///    (including formula constraints).
    /// 2. For schemas with formula constraints, check if any dirty cells
    ///    are on the same sheet and revalidate populated cells in those
    ///    columns (transitive revalidation).
    pub(crate) fn validate_dirty_cells(
        &self,
        mirror: &CellMirror,
        dirty: &[CellId],
        schemas: &SchemaMap,
    ) -> Vec<RecalcValidationAnnotation> {
        let mut annotations = Vec::new();

        // Build lookup structures for pass 2 (transitive revalidation).
        let mut dirty_sheet_ids: FxHashSet<SheetId> = FxHashSet::default();
        let dirty_set: FxHashSet<CellId> = dirty.iter().copied().collect();

        // --- Pass 1: Validate directly-changed cells ---
        for &cell_id in dirty {
            let compute_graph::CellPosition {
                sheet: sheet_id,
                row,
                col,
            } = match compute_graph::PositionResolver::resolve(mirror, &cell_id) {
                Some(pos) => pos,
                None => continue,
            };
            dirty_sheet_ids.insert(sheet_id);

            let column_schema = match schemas.get_column_schema(sheet_id, col) {
                Some(s) => s,
                None => continue,
            };

            let value = match mirror.get_cell_value(&cell_id) {
                Some(v) => v,
                None => continue,
            };

            // Skip null/empty values -- they are not validation errors
            // (required constraint is a separate concern)
            if matches!(value, CellValue::Null) {
                continue;
            }

            // Validate (with formula constraint support)
            let result =
                self.validate_cell_value_at(mirror, value, column_schema, cell_id, sheet_id);
            let inferred = result
                .inferred_type
                .unwrap_or_else(|| inference::infer_type(value));

            // Emit annotation for ALL validated cells (both pass and fail).
            // Passed cells have an empty errors array; TS uses this to detect
            // "now-valid" transitions and clear previously stored errors.
            annotations.push(Self::make_annotation(
                cell_id,
                sheet_id,
                row,
                col,
                &result,
                &inferred,
                column_schema,
            ));
        }

        // --- Pass 2: Transitive revalidation for formula constraints ---
        // Scan all schemas for those with formula constraints. For each such
        // schema on a sheet that has dirty cells, revalidate all populated cells
        // in that column (they may reference the changed cells).
        for (key, column_schema) in schemas.iter() {
            let has_formula = column_schema
                .constraints
                .as_ref()
                .and_then(|c| c.formula.as_ref())
                .map(|f| !f.is_empty())
                .unwrap_or(false);
            if !has_formula {
                continue;
            }

            // Only revalidate if any dirty cell is on the same sheet.
            //
            // TODO(P1): Cross-sheet formula constraints are not detected here.
            // If a formula constraint on Sheet2 references a cell on Sheet1 that
            // changed (e.g., `=Sheet1!A1 > 0`), this check skips revalidation
            // because Sheet2 is not in `dirty_sheet_ids`. To fix this properly:
            // 1. Parse each formula constraint string via `parse_formula`.
            // 2. Walk the AST to collect referenced SheetIds (SheetRef/UnresolvedSheetRef nodes).
            // 3. Expand `dirty_sheet_ids` (or use a separate set) to include sheets whose
            //    formula constraints reference any dirty sheet.
            // This requires building an AST-walking utility for sheet reference extraction,
            // which does not exist yet. Until then, cross-sheet formula constraint
            // invalidation is missed.
            if !dirty_sheet_ids.contains(&key.sheet_id) {
                continue;
            }

            // Find all populated cells in this column on this sheet.
            //
            // Instead of scanning 0..sheet.rows (which touches every row even
            // when the sheet is mostly empty), iterate only over cells that
            // actually exist in the sheet. This is O(populated_cells) instead
            // of O(rows), a significant win for large sparse sheets.
            let sheet = match mirror.get_sheet(&key.sheet_id) {
                Some(s) => s,
                None => continue,
            };

            for (&cell_id, _entry) in sheet.cells_iter() {
                // Resolve position; skip if not in the target column.
                let pos = match sheet.position_of(&cell_id) {
                    Some(p) => p,
                    None => continue,
                };
                if pos.col() != key.column {
                    continue;
                }

                // Skip cells already validated in pass 1.
                if dirty_set.contains(&cell_id) {
                    continue;
                }

                let value = match mirror.get_cell_value(&cell_id) {
                    Some(v) => v,
                    None => continue,
                };

                if matches!(value, CellValue::Null) {
                    continue;
                }

                let result = self.validate_cell_value_at(
                    mirror,
                    value,
                    column_schema,
                    cell_id,
                    key.sheet_id,
                );
                let inferred = result
                    .inferred_type
                    .unwrap_or_else(|| inference::infer_type(value));
                annotations.push(Self::make_annotation(
                    cell_id,
                    key.sheet_id,
                    pos.row(),
                    key.column,
                    &result,
                    &inferred,
                    column_schema,
                ));
            }
        }

        annotations
    }

    /// Validate a single cell value against a column schema, using the formula
    /// evaluator callback if the schema has a formula constraint.
    fn validate_cell_value_at(
        &self,
        mirror: &CellMirror,
        value: &CellValue,
        column_schema: &crate::schema::types::ColumnSchema,
        cell_id: CellId,
        sheet_id: SheetId,
    ) -> crate::schema::types::ValidationResult {
        let has_formula_constraint = column_schema
            .constraints
            .as_ref()
            .and_then(|c| c.formula.as_ref())
            .map(|f| !f.is_empty())
            .unwrap_or(false);

        if has_formula_constraint {
            validator::validate_with_formula_evaluator(value, column_schema, |formula_str| {
                self.evaluate_formula_for_validation(mirror, formula_str, cell_id, sheet_id)
            })
        } else {
            validator::validate(value, column_schema)
        }
    }

    /// Evaluate a formula string for validation purposes.
    ///
    /// The formula is evaluated in the context of the given cell (so that
    /// relative references like A1 resolve correctly relative to that cell's
    /// position). Returns the computed CellValue, or None if parsing/evaluation
    /// fails.
    fn evaluate_formula_for_validation(
        &self,
        mirror: &CellMirror,
        formula_str: &str,
        cell_id: CellId,
        sheet_id: SheetId,
    ) -> Option<CellValue> {
        // parse_formula handles leading '=' internally.
        let spanned = parse_formula(formula_str, None).ok()?;
        let ctx = crate::eval_bridge::MirrorContext::new(mirror, cell_id, sheet_id);
        crate::eval::sync_block_on(crate::eval::Evaluator::evaluate(&spanned.node, &ctx, &ctx)).ok()
    }

    /// Build a RecalcValidationAnnotation from a validation result.
    fn make_annotation(
        cell_id: CellId,
        sheet_id: SheetId,
        row: u32,
        col: u32,
        result: &crate::schema::types::ValidationResult,
        inferred: &crate::schema::types::SchemaType,
        column_schema: &crate::schema::types::ColumnSchema,
    ) -> RecalcValidationAnnotation {
        RecalcValidationAnnotation {
            cell_id: cell_id.to_uuid_string(),
            sheet_id: sheet_id.to_uuid_string(),
            row,
            column: col,
            errors: result
                .errors
                .iter()
                .map(|e| RecalcValidationError {
                    code: e.code,
                    message: e.message.clone(),
                    severity: e.severity,
                })
                .collect(),
            expected_type: column_schema.schema_type,
            actual_type: *inferred,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::schema::schema_map::SchemaKey;
    use crate::schema::types::{ColumnSchema, SchemaType, ValidationErrorCode};
    use crate::snapshot::CellData;

    fn make_schema(name: &str, t: SchemaType) -> ColumnSchema {
        ColumnSchema {
            id: name.into(),
            name: name.into(),
            schema_type: t,
            constraints: None,
            distribution: None,
            description: None,
        }
    }

    fn make_constrained_schema(
        name: &str,
        t: SchemaType,
        constraints: crate::schema::types::SchemaConstraints,
    ) -> ColumnSchema {
        ColumnSchema {
            id: name.into(),
            name: name.into(),
            schema_type: t,
            constraints: Some(constraints),
            distribution: None,
            description: None,
        }
    }

    #[test]
    fn value_violating_constraint_produces_annotation() {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "00000000-0000-0000-0000-000000000001".into(),
                name: "Sheet1".into(),
                rows: 10,
                cols: 5,
                cells: vec![CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".into(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(100.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
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
        };
        let _result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        // Set column 0 to Number schema with min=100 -- value 42 violates this
        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();
        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_constrained_schema(
                "num_col",
                SchemaType::Number,
                crate::schema::types::SchemaConstraints {
                    min: Some(100.0),
                    ..Default::default()
                },
            ),
        );
        core.load_schema_map(schemas, 1);

        // Set cell A1 to 42, which is below min=100
        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "42")
            .unwrap();

        // The result should contain validation annotations for column 0
        assert!(
            !result.validation_annotations.is_empty(),
            "Expected validation annotations for value below min constraint"
        );
        assert_eq!(result.validation_annotations[0].column, 0);
        assert_eq!(
            result.validation_annotations[0].expected_type,
            SchemaType::Number
        );
    }

    #[test]
    fn no_schema_map_means_no_annotations() {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "00000000-0000-0000-0000-000000000001".into(),
                name: "Sheet1".into(),
                rows: 10,
                cols: 5,
                cells: vec![CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".into(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(100.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
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
        };
        let _result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();
        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "hello")
            .unwrap();
        assert!(result.validation_annotations.is_empty());
    }

    #[test]
    fn valid_value_produces_annotation_with_empty_errors() {
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "00000000-0000-0000-0000-000000000001".into(),
                name: "Sheet1".into(),
                rows: 10,
                cols: 5,
                cells: vec![CellData {
                    cell_id: "00000000-0000-0000-0000-000000000010".into(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(100.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
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
        };
        let _result = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();
        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_schema("num_col", SchemaType::Number),
        );
        core.load_schema_map(schemas, 1);

        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "42")
            .unwrap();
        // Valid cells now produce an annotation with empty errors (for TS pass/fail diffing)
        assert_eq!(
            result.validation_annotations.len(),
            1,
            "Valid cells should produce an annotation with empty errors"
        );
        let ann = &result.validation_annotations[0];
        assert!(ann.errors.is_empty(), "Valid cell should have no errors");
        assert_eq!(ann.row, 0);
        assert_eq!(ann.column, 0);
        assert_eq!(ann.expected_type, SchemaType::Number);
    }

    // -----------------------------------------------------------------------
    // Integration tests
    // -----------------------------------------------------------------------

    /// Helper: create a single-sheet workbook snapshot with one cell at (0,0).
    fn one_cell_snapshot(sheet_uuid: &str, cell_uuid: &str) -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_uuid.into(),
                name: "Sheet1".into(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: cell_uuid.into(),
                    row: 0,
                    col: 0,
                    value: CellValue::number(0.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
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

    /// Helper: create a two-sheet workbook snapshot with one cell per sheet at (0,0).
    fn two_sheet_snapshot(
        sheet1_uuid: &str,
        cell1_uuid: &str,
        sheet2_uuid: &str,
        cell2_uuid: &str,
    ) -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![
                SheetSnapshot {
                    id: sheet1_uuid.into(),
                    name: "Sheet1".into(),
                    rows: 100,
                    cols: 26,
                    cells: vec![CellData {
                        cell_id: cell1_uuid.into(),
                        row: 0,
                        col: 0,
                        value: CellValue::number(0.0),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    }],
                    ranges: vec![],
                },
                SheetSnapshot {
                    id: sheet2_uuid.into(),
                    name: "Sheet2".into(),
                    rows: 100,
                    cols: 26,
                    cells: vec![CellData {
                        cell_id: cell2_uuid.into(),
                        row: 0,
                        col: 0,
                        value: CellValue::number(0.0),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    }],
                    ranges: vec![],
                },
            ],
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

    #[test]
    fn formula_producing_decimal_violates_integer_schema() {
        // A formula that produces a non-integer result should fail Integer schema validation.
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = one_cell_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();

        // Set column 0 to Integer schema
        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_schema("int_col", SchemaType::Integer),
        );
        core.load_schema_map(schemas, 1);

        // Set cell to formula =1/3 which produces 0.3333...
        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "=1/3")
            .unwrap();

        assert!(
            !result.validation_annotations.is_empty(),
            "Formula =1/3 produces a decimal; should violate Integer schema"
        );
        let ann = &result.validation_annotations[0];
        assert_eq!(ann.column, 0);
        assert_eq!(ann.expected_type, SchemaType::Integer);
        // The error code should be InvalidInteger
        assert!(
            ann.errors
                .iter()
                .any(|e| e.code == ValidationErrorCode::InvalidInteger),
            "Expected InvalidInteger error, got: {:?}",
            ann.errors
        );
    }

    #[test]
    fn schema_load_mid_session_triggers_validation_on_next_recalc() {
        // Initially no schema => no annotations. After loading a schema, the
        // next cell edit should produce annotations if the value violates.
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = one_cell_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();
        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();

        // Set cell to "hello" with no schema -- should have no annotations
        let r1 = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "hello")
            .unwrap();
        assert!(
            r1.validation_annotations.is_empty(),
            "No schema loaded, should have no annotations"
        );

        // Now load a Number schema for column 0
        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_schema("num_col", SchemaType::Number),
        );
        core.load_schema_map(schemas, 1);

        // Re-set the same text value -- should now produce a type mismatch annotation
        let r2 = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "hello")
            .unwrap();
        assert!(
            !r2.validation_annotations.is_empty(),
            "After loading Number schema, text 'hello' should produce annotations"
        );
        assert_eq!(
            r2.validation_annotations[0].expected_type,
            SchemaType::Number
        );
    }

    #[test]
    fn schema_removal_stops_producing_annotations() {
        // Load schema, set violating value (annotations). Clear schemas, set again (no annotations).
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = one_cell_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();
        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();

        // Load Integer schema
        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_schema("int_col", SchemaType::Integer),
        );
        core.load_schema_map(schemas, 1);

        // Set cell to decimal -- should produce annotation
        let r1 = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "3.14")
            .unwrap();
        assert!(
            !r1.validation_annotations.is_empty(),
            "3.14 should violate Integer schema"
        );

        // Clear all schemas
        core.clear_schemas();

        // Set cell to decimal again -- should have no annotations now
        let r2 = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "2.71")
            .unwrap();
        assert!(
            r2.validation_annotations.is_empty(),
            "After clearing schemas, no annotations should be produced"
        );
    }

    #[test]
    fn multiple_sheets_validated_independently() {
        // Sheet1 has Currency column (col 0), Sheet2 has Integer column (col 0).
        // Each sheet validates its own cells against its own schemas.
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = two_sheet_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-000000000020",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet1 = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();
        let sheet2 = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000002").unwrap();
        let cell_s1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();
        let cell_s2 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000020").unwrap();

        // Sheet1 col 0: Currency, Sheet2 col 0: Integer
        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id: sheet1,
                column: 0,
            },
            make_schema("currency_col", SchemaType::Currency),
        );
        schemas.insert(
            SchemaKey {
                sheet_id: sheet2,
                column: 0,
            },
            make_schema("int_col", SchemaType::Integer),
        );
        core.load_schema_map(schemas, 1);

        // Sheet1: set a number (valid for Currency since numbers are accepted)
        let r1 = core
            .set_cell(&mut mirror, &sheet1, cell_s1, 0, 0, "100")
            .unwrap();
        assert_eq!(
            r1.validation_annotations.len(),
            1,
            "Valid cell should produce annotation with empty errors"
        );
        assert!(
            r1.validation_annotations[0].errors.is_empty(),
            "Number 100 should be valid for Currency schema"
        );

        // Sheet2: set a decimal (violates Integer schema)
        let r2 = core
            .set_cell(&mut mirror, &sheet2, cell_s2, 0, 0, "3.14")
            .unwrap();
        assert!(
            !r2.validation_annotations.is_empty(),
            "3.14 should violate Integer schema on Sheet2"
        );
        assert_eq!(
            r2.validation_annotations[0].sheet_id,
            "00000000000000000000000000000002"
        );
        assert_eq!(
            r2.validation_annotations[0].expected_type,
            SchemaType::Integer
        );
    }

    #[test]
    fn min_max_constraint_violation_via_formula() {
        // Column with min=0 max=100 constraints; formula produces out-of-range value.
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = one_cell_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();

        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_constrained_schema(
                "bounded_col",
                SchemaType::Number,
                crate::schema::types::SchemaConstraints {
                    min: Some(0.0),
                    max: Some(100.0),
                    ..Default::default()
                },
            ),
        );
        core.load_schema_map(schemas, 1);

        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();

        // Formula =200 produces 200, which exceeds max=100
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "=100+101")
            .unwrap();
        assert!(
            !result.validation_annotations.is_empty(),
            "Formula =100+101 produces 201, exceeding max=100"
        );
        assert!(
            result.validation_annotations[0]
                .errors
                .iter()
                .any(|e| e.code == ValidationErrorCode::MaxValue),
            "Expected MaxValue error, got: {:?}",
            result.validation_annotations[0].errors
        );
    }

    #[test]
    fn valid_formula_result_produces_annotation_with_empty_errors() {
        // Column with Number schema; formula produces a valid number.
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = one_cell_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();

        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_schema("num_col", SchemaType::Number),
        );
        core.load_schema_map(schemas, 1);

        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();

        // Formula =2+3 produces 5, valid for Number schema
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "=2+3")
            .unwrap();
        // Valid cells produce an annotation with empty errors
        assert_eq!(
            result.validation_annotations.len(),
            1,
            "Formula =2+3 produces 5; should produce annotation with empty errors"
        );
        let ann = &result.validation_annotations[0];
        assert!(
            ann.errors.is_empty(),
            "Valid formula result should have no errors"
        );
        assert_eq!(ann.row, 0);
        assert_eq!(ann.column, 0);
        assert_eq!(ann.expected_type, SchemaType::Number);
    }

    #[test]
    fn null_cell_skipped_even_with_required_constraint() {
        // validate_dirty_cells explicitly skips Null values (line 42).
        // This means the "required" constraint is not enforced at the recalc level.
        // This test documents that behavior.
        let mut core = ComputeCore::new();
        let mut mirror = CellMirror::new();
        let snapshot = one_cell_snapshot(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000010",
        );
        let _init = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

        let sheet_id = SheetId::from_uuid_str("00000000-0000-0000-0000-000000000001").unwrap();

        let mut schemas = std::collections::HashMap::new();
        schemas.insert(
            SchemaKey {
                sheet_id,
                column: 0,
            },
            make_constrained_schema(
                "required_col",
                SchemaType::String,
                crate::schema::types::SchemaConstraints {
                    required: Some(true),
                    ..Default::default()
                },
            ),
        );
        core.load_schema_map(schemas, 1);

        let cell_a1 = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();

        // Clear cell (sets to Null) -- validate_dirty_cells skips Null values,
        // so no annotation even though required=true.
        let result = core
            .set_cell(&mut mirror, &sheet_id, cell_a1, 0, 0, "")
            .unwrap();
        assert!(
            result.validation_annotations.is_empty(),
            "Null/empty cells are skipped by validate_dirty_cells (required is a separate concern)"
        );
    }
}
