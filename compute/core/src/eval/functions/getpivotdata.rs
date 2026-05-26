//! GETPIVOTDATA evaluator — reads values from rendered pivot table cells.
//!
//! GETPIVOTDATA(data_field, pivot_table_ref, [field1, item1], [field2, item2], ...)
//!
//! The function locates a pivot table by the cell reference in arg[1], then
//! finds the value at the intersection of the specified data field and row
//! criteria. It reads from already-rendered cells in the mirror — it does NOT
//! invoke the pivot compute engine.

use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::evaluator::Evaluator;

use cell_types::SheetId;
use compute_parser::{ASTNode, CellRefNode};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

/// Sentinel error indicating GETPIVOTDATA cannot resolve the cell reference.
fn ref_error() -> ComputeError {
    ComputeError::Eval {
        message: "GETPIVOTDATA: cannot resolve cell reference".into(),
    }
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// Evaluate GETPIVOTDATA(data_field, pivot_table, [field1, item1], ...)
    pub(in crate::eval) async fn eval_getpivotdata(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        // Minimum 2 args: data_field, pivot_table_ref
        if args.len() < 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        // Criteria come in pairs after the first two args
        if args.len() > 2 && !(args.len() - 2).is_multiple_of(2) {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // 1. Evaluate data_field name
        let data_field_val = self.eval_node_cv(&args[0]).await?;
        let data_field = match &data_field_val {
            CellValue::Text(s) => s.clone(),
            CellValue::Error(e, _) => return Ok(CellValue::Error(*e, None)),
            _ => return Ok(CellValue::Error(CellError::Value, None)),
        };

        // 2. Resolve pivot_table_ref to (SheetId, row, col)
        // Follow the ISFORMULA pattern: unwrap SheetRef, extract CellRefNode
        let (sheet, row, col) = self.resolve_cell_ref_arg(&args[1])?;

        // 3. Find pivot table containing that cell
        let pivot_def = match self.meta.find_pivot_table_at(&sheet, row, col) {
            Some(pt) => pt,
            None => return Ok(CellValue::Error(CellError::Ref, None)),
        };

        // Clone the fields we need so we don't hold a borrow on meta
        let pt_start_row = pivot_def.start_row;
        let pt_start_col = pivot_def.start_col;
        let pt_end_row = pivot_def.end_row;
        let pt_end_col = pivot_def.end_col;
        let pt_first_data_row = pivot_def.first_data_row;
        let pt_first_data_col = pivot_def.first_data_col;
        let data_field_names = pivot_def.data_field_names.clone();
        let cache_field_names = pivot_def.cache_field_names.clone();
        let row_field_indices = pivot_def.row_field_indices.clone();

        // 4. Find data_field column offset
        let data_field_offset = data_field_names
            .iter()
            .position(|name| name.eq_ignore_ascii_case(&data_field));
        let data_field_offset = match data_field_offset {
            Some(i) => i as u32,
            None => return Ok(CellValue::Error(CellError::Ref, None)),
        };
        let abs_data_col = pt_start_col + pt_first_data_col + data_field_offset;

        // Ensure the computed column is within the pivot range
        if abs_data_col > pt_end_col {
            return Ok(CellValue::Error(CellError::Ref, None));
        }

        // 5. If no criteria → return grand total (last row)
        if args.len() == 2 {
            let ref_ = CellRef::Positional {
                sheet,
                row: pt_end_row,
                col: abs_data_col,
            };
            return Ok(self.data.get_cell_value_by_ref(&ref_).await);
        }

        // 6. Parse criteria pairs
        let mut criteria: Vec<(String, CellValue)> = Vec::new();
        let mut i = 2;
        while i + 1 < args.len() {
            let field_val = self.eval_node_cv(&args[i]).await?;
            let field_name = match &field_val {
                CellValue::Text(s) => s.to_string(),
                CellValue::Error(e, _) => return Ok(CellValue::Error(*e, None)),
                _ => return Ok(CellValue::Error(CellError::Value, None)),
            };
            let item_val = self.eval_node_cv(&args[i + 1]).await?;
            if let CellValue::Error(e, _) = &item_val {
                return Ok(CellValue::Error(*e, None));
            }
            criteria.push((field_name, item_val));
            i += 2;
        }

        // 7. Resolve each criterion field_name to a label column offset
        let mut label_columns: Vec<(u32, CellValue)> = Vec::new();
        for (field_name, item_value) in &criteria {
            // Find which row field index matches this field name
            let label_col_offset = row_field_indices
                .iter()
                .enumerate()
                .find(|(_, field_idx)| {
                    cache_field_names
                        .get(**field_idx as usize)
                        .map(|n| n.eq_ignore_ascii_case(field_name))
                        .unwrap_or(false)
                })
                .map(|(i, _)| i as u32);

            match label_col_offset {
                Some(offset) => {
                    let abs_label_col = pt_start_col + offset;
                    label_columns.push((abs_label_col, item_value.clone()));
                }
                None => return Ok(CellValue::Error(CellError::Ref, None)),
            }
        }

        // 8. Scan rows to find matching row
        let first_data_abs_row = pt_start_row + pt_first_data_row;
        for r in first_data_abs_row..=pt_end_row {
            let mut all_match = true;
            for (label_col, expected_value) in &label_columns {
                let ref_ = CellRef::Positional {
                    sheet,
                    row: r,
                    col: *label_col,
                };
                let cell_val = self.data.get_cell_value_by_ref(&ref_).await;
                if !cell_values_match(&cell_val, expected_value) {
                    all_match = false;
                    break;
                }
            }
            if all_match {
                // Found matching row — return the data value
                let ref_ = CellRef::Positional {
                    sheet,
                    row: r,
                    col: abs_data_col,
                };
                return Ok(self.data.get_cell_value_by_ref(&ref_).await);
            }
        }

        // No matching row found
        Ok(CellValue::Error(CellError::Ref, None))
    }

    /// Resolve a cell reference argument from its AST node to (SheetId, row, col).
    ///
    /// Handles both direct CellReference nodes and SheetRef-wrapped references.
    /// Follows the same pattern as ISFORMULA's reference resolution.
    fn resolve_cell_ref_arg(&self, arg: &ASTNode) -> Result<(SheetId, u32, u32), ComputeError> {
        let (sheet_override, inner) = match arg {
            ASTNode::SheetRef { sheet, inner, .. } => (Some(*sheet), inner.as_ref()),
            other => (None, other),
        };
        match inner {
            ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                CellRef::Positional { sheet, row, col } => {
                    Ok((sheet_override.unwrap_or(*sheet), *row, *col))
                }
                CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                    Some((s, r, c)) => Ok((sheet_override.unwrap_or(s), r, c)),
                    None => Err(ref_error()),
                },
            },
            _ => Err(ref_error()),
        }
    }
}

/// Compare two CellValues for GETPIVOTDATA matching.
///
/// Case-insensitive for text, exact for numbers/booleans.
/// Null matches Null. Text-to-number coercion: if the expected value is text
/// that parses as a number, compare against the cell's numeric value.
fn cell_values_match(cell: &CellValue, expected: &CellValue) -> bool {
    match (cell, expected) {
        (CellValue::Text(a), CellValue::Text(b)) => a.eq_ignore_ascii_case(b),
        (CellValue::Number(a), CellValue::Number(b)) => (a.get() - b.get()).abs() < 1e-10,
        (CellValue::Boolean(a), CellValue::Boolean(b)) => a == b,
        (CellValue::Null, CellValue::Null) => true,
        // Text-to-number coercion: if expected is text that looks numeric, compare as number
        (CellValue::Number(n), CellValue::Text(s)) => s
            .parse::<f64>()
            .map(|v| (n.get() - v).abs() < 1e-10)
            .unwrap_or(false),
        (CellValue::Text(s), CellValue::Number(n)) => s
            .parse::<f64>()
            .map(|v| (n.get() - v).abs() < 1e-10)
            .unwrap_or(false),
        _ => false,
    }
}
