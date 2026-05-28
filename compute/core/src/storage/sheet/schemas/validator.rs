use std::sync::Arc;

use cell_types::{CellId, SheetId, SheetPos};
use compute_parser::parse_formula;
use value_types::CellValue;
use yrs::{Doc, MapRef, Transact};

use super::{
    CellValidationResult, ColumnSchema, EnforcementLevel, IdentityRangeSchemaRef, SchemaType,
    columns, range_geometry, range_store, range_view,
};
use crate::eval::sync_block_on;
use crate::eval_bridge::MirrorContext;
use crate::eval_bridge::mirror_access::PendingCellOverride;
use crate::identity::GridIndex;
use crate::mirror::CellMirror;
use crate::scheduler::ast_transform::shift_ast_for_cf;

pub(in crate::storage::sheet) fn str_to_cell_value(s: &str) -> value_types::CellValue {
    if s.is_empty() {
        return value_types::CellValue::Text(Arc::from(""));
    }
    if let Ok(n) = s.parse::<f64>()
        && let Some(f) = value_types::FiniteF64::new(n)
    {
        return value_types::CellValue::Number(f);
    }
    match s {
        "true" => value_types::CellValue::Boolean(true),
        "false" => value_types::CellValue::Boolean(false),
        _ => value_types::CellValue::Text(Arc::from(s)),
    }
}

fn schema_has_formula_constraint(schema: &ColumnSchema) -> bool {
    schema
        .constraints
        .as_ref()
        .and_then(|c| c.formula.as_ref())
        .map(|f| !f.is_empty())
        .unwrap_or(false)
}

fn validate_with_optional_formula(
    cell_value: &CellValue,
    schema: &ColumnSchema,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    anchor_row: u32,
    anchor_col: u32,
    grid_index: Option<&GridIndex>,
) -> compute_schema::types::ValidationResult {
    if !schema_has_formula_constraint(schema) {
        return compute_schema::validator::validate(cell_value, schema);
    }

    let row_delta = row as i64 - anchor_row as i64;
    let col_delta = col as i64 - anchor_col as i64;
    let current_cell_id = grid_index
        .and_then(|g| g.cell_id_at(row, col))
        .unwrap_or_else(|| CellId::from_raw(0));
    let pending = PendingCellOverride {
        sheet: *sheet_id,
        pos: SheetPos::new(row, col),
        value: cell_value.clone(),
    };

    compute_schema::validator::validate_with_formula_evaluator(cell_value, schema, |formula_str| {
        let spanned = parse_formula(formula_str, None).ok()?;
        let shifted = shift_ast_for_cf(&spanned.node, row_delta, col_delta, *sheet_id);
        let ctx = MirrorContext::with_pending_override(
            mirror,
            current_cell_id,
            *sheet_id,
            pending.clone(),
        );
        sync_block_on(crate::eval::Evaluator::evaluate(&shifted, &ctx, &ctx)).ok()
    })
}

fn validation_cell_value_to_string(value: &CellValue) -> Option<String> {
    match value {
        CellValue::Null => None,
        CellValue::Text(s) => Some(s.to_string()),
        CellValue::Number(n) => {
            let value = n.get();
            if value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
                Some(format!("{}", value as i64))
            } else {
                Some(format!("{value}"))
            }
        }
        CellValue::Boolean(b) => Some(b.to_string()),
        CellValue::Error(..) => None,
        CellValue::Array(arr) => arr.get(0, 0).and_then(validation_cell_value_to_string),
        CellValue::Control(control) => Some(control.value.to_string()),
        CellValue::Image(image) => Some(image.fallback_text().to_string()),
    }
}

fn resolve_enum_source_values(
    source: &IdentityRangeSchemaRef,
    default_sheet_id: &SheetId,
    mirror: &CellMirror,
) -> Option<Vec<String>> {
    let sheet_id = match source.sheet_id.as_deref() {
        Some(raw) => SheetId::from_uuid_str(raw).ok()?,
        None => *default_sheet_id,
    };
    let ((sr, sc), (er, ec)) = range_geometry::parse_range_corners(source)?;
    let min_row = sr.min(er);
    let max_row = sr.max(er);
    let min_col = sc.min(ec);
    let max_col = sc.max(ec);
    let mut values = Vec::new();
    for row in min_row..=max_row {
        for col in min_col..=max_col {
            if let Some(value) = mirror.get_cell_value_at(&sheet_id, SheetPos::new(row, col))
                && let Some(display) = validation_cell_value_to_string(value)
            {
                values.push(display);
            }
        }
    }
    Some(values)
}

fn with_resolved_enum_source(
    schema: &ColumnSchema,
    sheet_id: &SheetId,
    mirror: &CellMirror,
) -> ColumnSchema {
    let mut schema = schema.clone();
    let Some(constraints) = schema.constraints.as_mut() else {
        return schema;
    };
    if constraints.enum_values.is_none()
        && let Some(source) = constraints.enum_source.as_ref()
        && let Some(values) = resolve_enum_source_values(source, sheet_id, mirror)
    {
        constraints.enum_values = Some(values);
    }
    schema
}

fn validate_with_resolved_constraints(
    cell_value: &CellValue,
    schema: &ColumnSchema,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    anchor_row: u32,
    anchor_col: u32,
    grid_index: Option<&GridIndex>,
) -> compute_schema::types::ValidationResult {
    let resolved_schema = with_resolved_enum_source(schema, sheet_id, mirror);
    validate_with_optional_formula(
        cell_value,
        &resolved_schema,
        mirror,
        sheet_id,
        row,
        col,
        anchor_row,
        anchor_col,
        grid_index,
    )
}

pub(crate) fn validate_cell_value(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
    grid_index: Option<&GridIndex>,
    mirror: &CellMirror,
) -> CellValidationResult {
    let cell_value = str_to_cell_value(value);

    if let Some(cs) = columns::get_column_schema(doc, sheets, sheet_id, col, grid_index) {
        let result = validate_with_resolved_constraints(
            &cell_value,
            &cs,
            mirror,
            sheet_id,
            row,
            col,
            row,
            col,
            grid_index,
        );
        if !result.valid {
            let err_msg = result.errors.first().map(|e| e.message.clone());
            return CellValidationResult {
                valid: false,
                error_message: err_msg,
                error_title: Some("Validation Error".to_string()),
                enforcement: EnforcementLevel::Strict,
            };
        }
        return CellValidationResult {
            valid: true,
            error_message: None,
            error_title: None,
            enforcement: EnforcementLevel::Strict,
        };
    }

    let txn = doc.transact();
    let specs = range_store::read_range_backed_validation_specs(&txn, sheets, sheet_id);
    drop(txn);

    for (idx, spec) in specs.iter().enumerate() {
        let Some(rs) =
            range_view::spec_to_range_schema(spec, range_view::range_schema_id_for(spec, idx))
        else {
            continue;
        };
        let Some((anchor_row, anchor_col)) =
            range_geometry::anchor_of_first_containing_range(&rs.ranges, row, col)
        else {
            continue;
        };
        let enforcement = rs.enforcement.unwrap_or(EnforcementLevel::Strict);

        let col_schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: rs.schema.schema_type.unwrap_or(SchemaType::Any),
            constraints: rs.schema.constraints.clone(),
            distribution: None,
            description: None,
        };
        let result = validate_with_resolved_constraints(
            &cell_value,
            &col_schema,
            mirror,
            sheet_id,
            row,
            col,
            anchor_row,
            anchor_col,
            grid_index,
        );

        if !result.valid {
            let default_err_msg = result.errors.first().map(|e| e.message.clone());
            let (error_title, error_message) = match rs.ui.as_ref() {
                Some(ui) => {
                    let title = ui.error_message.as_ref().and_then(|em| em.title.clone());
                    let msg = ui
                        .error_message
                        .as_ref()
                        .and_then(|em| em.message.clone())
                        .or(default_err_msg);
                    (title, msg)
                }
                None => (None, default_err_msg),
            };
            return CellValidationResult {
                valid: false,
                error_message,
                error_title,
                enforcement,
            };
        }
        return CellValidationResult {
            valid: true,
            error_message: None,
            error_title: None,
            enforcement,
        };
    }

    CellValidationResult {
        valid: true,
        error_message: None,
        error_title: None,
        enforcement: EnforcementLevel::None,
    }
}

pub(crate) enum DataValidationOutcome {
    NoRule,
    Pass,
    Fail { message: String },
}

pub(crate) fn validate_cell_value_against_data_validations(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &CellValue,
    grid_index: Option<&GridIndex>,
    mirror: &CellMirror,
) -> DataValidationOutcome {
    let txn = doc.transact();
    let specs = range_store::read_range_backed_validation_specs(&txn, sheets, sheet_id);
    drop(txn);

    for (idx, spec) in specs.iter().enumerate() {
        let Some(rs) =
            range_view::spec_to_range_schema(spec, range_view::range_schema_id_for(spec, idx))
        else {
            continue;
        };
        let Some((anchor_row, anchor_col)) =
            range_geometry::anchor_of_first_containing_range(&rs.ranges, row, col)
        else {
            continue;
        };

        let col_schema = ColumnSchema {
            id: String::new(),
            name: String::new(),
            schema_type: rs.schema.schema_type.unwrap_or(SchemaType::Any),
            constraints: rs.schema.constraints.clone(),
            distribution: None,
            description: None,
        };
        let result = validate_with_resolved_constraints(
            value,
            &col_schema,
            mirror,
            sheet_id,
            row,
            col,
            anchor_row,
            anchor_col,
            grid_index,
        );

        if !result.valid {
            let message = result
                .errors
                .first()
                .map(|e| e.message.clone())
                .or_else(|| {
                    rs.ui
                        .as_ref()
                        .and_then(|ui| ui.error_message.as_ref())
                        .and_then(|em| em.message.clone())
                })
                .unwrap_or_else(|| "Validation failed".to_string());
            return DataValidationOutcome::Fail { message };
        }
        return DataValidationOutcome::Pass;
    }

    DataValidationOutcome::NoRule
}
