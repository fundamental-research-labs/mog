use super::super::GLOBAL_REGISTRY;
use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use cell_types::col_to_letter;
use compute_parser::{ASTNode, CellRefNode, RangeRef};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

fn areas_reference_count(node: &ASTNode) -> usize {
    match node {
        ASTNode::Union { ranges } => ranges.iter().map(areas_reference_count).sum(),
        ASTNode::Paren(inner)
        | ASTNode::SheetRef { inner, .. }
        | ASTNode::UnresolvedSheetRef { inner, .. }
        | ASTNode::ThreeDRef { inner, .. }
        | ASTNode::UnresolvedThreeDRef { inner, .. }
        | ASTNode::ExternalSheetRef { inner, .. }
        | ASTNode::ExternalThreeDRef { inner, .. } => areas_reference_count(inner),
        ASTNode::CellReference(_)
        | ASTNode::Range(_)
        | ASTNode::RangeOp { .. }
        | ASTNode::StructuredRef(_)
        | ASTNode::ExternalNameRef { .. } => 1,
        _ => 1,
    }
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) async fn eval_cell(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let info_type = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = info_type {
            return Ok(CellValue::Error(e, None));
        }
        let info_str = match &info_type {
            CellValue::Text(s) => s.to_lowercase(),
            _ => return Ok(CellValue::Error(CellError::Value, None)),
        };

        match info_str.as_str() {
            "row" | "col" | "address" => {
                // These need the REFERENCE (not value) from the second argument
                if args.len() < 2 {
                    return Ok(CellValue::Error(CellError::Na, None));
                }
                // Unwrap SheetRef if present (like ROW/COLUMN do)
                let inner = match &args[1] {
                    ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                    other => other,
                };
                let (row, col) = match inner {
                    ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                        CellRef::Positional { row, col, .. } => (*row, *col),
                        CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                            Some((_, r, c)) => (r, c),
                            None => return Ok(CellValue::Error(CellError::Ref, None)),
                        },
                    },
                    ASTNode::Range(RangeRef { start, .. }) => {
                        // For ranges, CELL returns info for the top-left cell
                        match start {
                            CellRef::Positional { row, col, .. } => (*row, *col),
                            CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                                Some((_, r, c)) => (r, c),
                                None => return Ok(CellValue::Error(CellError::Ref, None)),
                            },
                        }
                    }
                    _ => return Ok(CellValue::Error(CellError::Value, None)),
                };
                // row/col are 0-based internally; Excel uses 1-based
                match info_str.as_str() {
                    "row" => Ok(CellValue::number(row as f64 + 1.0)),
                    "col" => Ok(CellValue::number(col as f64 + 1.0)),
                    "address" => {
                        let col_letter = col_to_letter(col);
                        Ok(CellValue::Text(
                            format!("${}${}", col_letter, row + 1).into(),
                        ))
                    }
                    _ => unreachable!(),
                }
            }
            _ => {
                // Fall through to FunctionRegistry for value-based info types
                // ("type", "contents", etc.)
                let mut evaluated_args = Vec::with_capacity(args.len());
                for arg in args {
                    let v = self.eval_node_cv(arg).await?;
                    evaluated_args.push(v);
                }
                Ok(GLOBAL_REGISTRY.call("CELL", &evaluated_args))
            }
        }
    }
    pub(in crate::eval) async fn eval_row(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            // ROW() — return the current cell's row (1-based)
            let cell_id = self.meta.current_cell();
            match self.meta.resolve_position(&cell_id) {
                Some((_, row, _)) => Ok(CellValue::number(row as f64 + 1.0)),
                None => Ok(CellValue::Error(CellError::Ref, None)),
            }
        } else {
            // Unwrap SheetRef if present to get the inner reference node
            let inner = match &args[0] {
                ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                other => other,
            };
            match inner {
                ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                    CellRef::Positional { row, .. } => Ok(CellValue::number(*row as f64 + 1.0)),
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((_, row, _)) => Ok(CellValue::number(row as f64 + 1.0)),
                        None => Ok(CellValue::Error(CellError::Ref, None)),
                    },
                },
                ASTNode::Range(RangeRef { start, end, .. }) => {
                    // Extract start/end rows from the range references
                    let start_row = match start {
                        CellRef::Positional { row, .. } => *row,
                        CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                            Some((_, r, _)) => r,
                            None => return Ok(CellValue::Error(CellError::Ref, None)),
                        },
                    };
                    let end_row = match end {
                        CellRef::Positional { row, .. } => *row,
                        CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                            Some((_, r, _)) => r,
                            None => return Ok(CellValue::Error(CellError::Ref, None)),
                        },
                    };
                    let min_row = start_row.min(end_row);
                    let max_row = start_row.max(end_row);
                    if min_row == max_row {
                        // Single-row range: return a scalar
                        Ok(CellValue::number(min_row as f64 + 1.0))
                    } else {
                        // Multi-row range: return a column array of row numbers
                        let data: Vec<CellValue> = (min_row..=max_row)
                            .map(|r| CellValue::number(r as f64 + 1.0))
                            .collect();
                        Ok(CellValue::column_array(data))
                    }
                }
                ASTNode::Error(e) => Ok(CellValue::Error(*e, None)),
                _ => Ok(CellValue::Error(CellError::Value, None)),
            }
        }
    }
    pub(in crate::eval) async fn eval_column(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            // COLUMN() — return the current cell's column (1-based)
            let cell_id = self.meta.current_cell();
            match self.meta.resolve_position(&cell_id) {
                Some((_, _, col)) => Ok(CellValue::number(col as f64 + 1.0)),
                None => Ok(CellValue::Error(CellError::Ref, None)),
            }
        } else {
            // Unwrap SheetRef if present to get the inner reference node
            let inner = match &args[0] {
                ASTNode::SheetRef { inner, .. } => inner.as_ref(),
                other => other,
            };
            match inner {
                ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                    CellRef::Positional { col, .. } => Ok(CellValue::number(*col as f64 + 1.0)),
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((_, _, col)) => Ok(CellValue::number(col as f64 + 1.0)),
                        None => Ok(CellValue::Error(CellError::Ref, None)),
                    },
                },
                ASTNode::Range(RangeRef { start, end, .. }) => {
                    // Extract start/end cols from the range references
                    let start_col = match start {
                        CellRef::Positional { col, .. } => *col,
                        CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                            Some((_, _, c)) => c,
                            None => return Ok(CellValue::Error(CellError::Ref, None)),
                        },
                    };
                    let end_col = match end {
                        CellRef::Positional { col, .. } => *col,
                        CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                            Some((_, _, c)) => c,
                            None => return Ok(CellValue::Error(CellError::Ref, None)),
                        },
                    };
                    let min_col = start_col.min(end_col);
                    let max_col = start_col.max(end_col);
                    if min_col == max_col {
                        // Single-col range: return a scalar
                        Ok(CellValue::number(min_col as f64 + 1.0))
                    } else {
                        // Multi-col range: return a row array of column numbers
                        let data: Vec<CellValue> = (min_col..=max_col)
                            .map(|c| CellValue::number(c as f64 + 1.0))
                            .collect();
                        Ok(CellValue::row_array(data))
                    }
                }
                ASTNode::Error(e) => Ok(CellValue::Error(*e, None)),
                _ => Ok(CellValue::Error(CellError::Value, None)),
            }
        }
    }
    pub(in crate::eval) async fn eval_rows(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        // Try to extract row count from AST (range geometry) first
        let inner = match &args[0] {
            ASTNode::SheetRef { inner, .. } => inner.as_ref(),
            other => other,
        };
        match inner {
            ASTNode::Range(RangeRef { start, end, .. }) => {
                let start_row = match start {
                    CellRef::Positional { row, .. } => *row,
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((_, r, _)) => r,
                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                    },
                };
                let end_row = match end {
                    CellRef::Positional { row, .. } => *row,
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((_, r, _)) => r,
                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                    },
                };
                let count = (end_row as i64 - start_row as i64).unsigned_abs() + 1;
                Ok(CellValue::number(count as f64))
            }
            ASTNode::CellReference(..) => Ok(CellValue::number(1.0)),
            _ => {
                // Fallback: evaluate and count array rows
                let v = self.eval_node_cv(&args[0]).await?;
                match v {
                    CellValue::Array(arr) => Ok(CellValue::number(arr.rows() as f64)),
                    _ => Ok(CellValue::number(1.0)),
                }
            }
        }
    }
    pub(in crate::eval) async fn eval_columns(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        // Try to extract column count from AST (range geometry) first
        let inner = match &args[0] {
            ASTNode::SheetRef { inner, .. } => inner.as_ref(),
            other => other,
        };
        match inner {
            ASTNode::Range(RangeRef { start, end, .. }) => {
                let start_col = match start {
                    CellRef::Positional { col, .. } => *col,
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((_, _, c)) => c,
                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                    },
                };
                let end_col = match end {
                    CellRef::Positional { col, .. } => *col,
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((_, _, c)) => c,
                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                    },
                };
                let count = (end_col as i64 - start_col as i64).unsigned_abs() + 1;
                Ok(CellValue::number(count as f64))
            }
            ASTNode::CellReference(..) => Ok(CellValue::number(1.0)),
            _ => {
                // Fallback: evaluate and count array columns
                let v = self.eval_node_cv(&args[0]).await?;
                match v {
                    CellValue::Array(arr) => Ok(CellValue::number(arr.cols() as f64)),
                    _ => Ok(CellValue::number(1.0)),
                }
            }
        }
    }
    pub(in crate::eval) async fn eval_sheets(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            Ok(CellValue::number(self.meta.sheet_count() as f64))
        } else {
            // SHEETS(ref) — count sheets in a 3-D reference. Not yet
            // supported; propagate errors, otherwise return 1.
            let v = self.eval_node_cv(&args[0]).await?;
            if let CellValue::Error(e, _) = v {
                Ok(CellValue::Error(e, None))
            } else {
                Ok(CellValue::number(1.0))
            }
        }
    }
    pub(in crate::eval) async fn eval_isformula(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        // Unwrap SheetRef if present
        let (sheet_override, inner) = match &args[0] {
            ASTNode::SheetRef { sheet, inner, .. } => (Some(*sheet), inner.as_ref()),
            other => (None, other),
        };
        match inner {
            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                let (sheet, row, col) = match reference {
                    CellRef::Positional { sheet, row, col } => {
                        (sheet_override.unwrap_or(*sheet), *row, *col)
                    }
                    CellRef::Resolved(id) => match self.meta.resolve_position(id) {
                        Some((s, r, c)) => (s, r, c),
                        None => return Ok(CellValue::Error(CellError::Ref, None)),
                    },
                };
                Ok(CellValue::Boolean(
                    self.meta.cell_has_formula(&sheet, row, col),
                ))
            }
            _ => {
                // ISFORMULA on a non-reference (literal, expression) => #VALUE!
                Ok(CellValue::Error(CellError::Value, None))
            }
        }
    }
    pub(in crate::eval) fn eval_areas(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let count = areas_reference_count(&args[0]);
        Ok(CellValue::number(count as f64))
    }
}
