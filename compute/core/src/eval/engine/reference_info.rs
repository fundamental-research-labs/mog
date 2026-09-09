use super::super::GLOBAL_REGISTRY;
use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use cell_types::col_to_letter;
use compute_parser::{ASTNode, BinOp, CellRefNode, RangeRef};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

fn areas_reference_count(node: &ASTNode) -> Option<usize> {
    match node {
        ASTNode::Union { ranges } => ranges
            .iter()
            .map(areas_reference_count)
            .try_fold(0usize, |acc, count| count.map(|count| acc + count)),
        ASTNode::Paren(inner)
        | ASTNode::SheetRef { inner, .. }
        | ASTNode::UnresolvedSheetRef { inner, .. }
        | ASTNode::ThreeDRef { inner, .. }
        | ASTNode::UnresolvedThreeDRef { inner, .. }
        | ASTNode::ExternalSheetRef { inner, .. }
        | ASTNode::ExternalThreeDRef { inner, .. } => areas_reference_count(inner),
        ASTNode::RangeOp { start, end } => {
            if areas_reference_count(start).is_some() && areas_reference_count(end).is_some() {
                Some(1)
            } else {
                None
            }
        }
        ASTNode::BinaryOp {
            op: BinOp::Intersect,
            left,
            right,
        } => {
            if areas_reference_count(left).is_some() && areas_reference_count(right).is_some() {
                Some(1)
            } else {
                None
            }
        }
        ASTNode::CellReference(_)
        | ASTNode::Range(_)
        | ASTNode::StructuredRef(_)
        | ASTNode::ExternalNameRef { .. } => Some(1),
        _ => None,
    }
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) async fn eval_cell(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() || args.len() > 2 {
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
            "type" | "contents" if args.len() == 2 => {
                let value =
                    if let Ok((sheet, row, col, _, _)) = self.eval_node_as_area(&args[1]).await {
                        self.data
                            .get_cell_value_by_ref(&CellRef::Positional { sheet, row, col })
                            .await
                    } else {
                        self.eval_node_cv(&args[1]).await?
                    };
                if info_str == "contents" && matches!(value, CellValue::Null) {
                    Ok(CellValue::number(0.0))
                } else {
                    Ok(GLOBAL_REGISTRY.call("CELL", &[info_type, value]))
                }
            }
            "color" | "format" | "parentheses" | "prefix" | "protect" | "width" | "filename" => {
                let Some(reference) = args.get(1) else {
                    return Ok(CellValue::Error(CellError::Na, None));
                };
                if let ASTNode::Error(error) = reference {
                    return Ok(CellValue::Error(*error, None));
                }
                let (sheet, row, col, _, _) = match self.eval_node_as_area(reference).await {
                    Ok(area) => area,
                    Err(ComputeError::Eval { .. }) => {
                        return Ok(CellValue::Error(CellError::Value, None));
                    }
                    Err(error) => return Err(error),
                };
                // Byte-based imports have no saved filesystem identity. Excel
                // uses empty text for an unsaved workbook, never a guessed path.
                if info_str == "filename" {
                    return Ok(CellValue::Text("".into()));
                }
                let Some(metadata) = self.meta.cell_reference_metadata(&sheet, row, col) else {
                    return Ok(CellValue::Error(CellError::Na, None));
                };
                let info = compute_formats::cell_format_info(
                    metadata
                        .format
                        .number_format
                        .as_deref()
                        .unwrap_or("General"),
                );
                Ok(match info_str.as_str() {
                    "color" => CellValue::number(u8::from(info.colored_negative) as f64),
                    "format" => CellValue::Text(info.code.into()),
                    "parentheses" => CellValue::number(u8::from(info.parentheses) as f64),
                    "protect" => {
                        CellValue::number(u8::from(metadata.format.locked.unwrap_or(true)) as f64)
                    }
                    "width" => CellValue::row_array(vec![
                        CellValue::number(metadata.column_width.round()),
                        CellValue::Boolean(metadata.column_width_is_default),
                    ]),
                    "prefix" => {
                        let value = self
                            .data
                            .get_cell_value_by_ref(&CellRef::Positional { sheet, row, col })
                            .await;
                        let prefix = if matches!(value, CellValue::Text(_))
                            && !self.meta.cell_has_formula(&sheet, row, col)
                        {
                            use ooxml_types::styles::HorizontalAlign;
                            match metadata.format.horizontal_align {
                                None | Some(HorizontalAlign::General | HorizontalAlign::Left) => {
                                    "'"
                                }
                                Some(HorizontalAlign::Right) => "\"",
                                Some(HorizontalAlign::Center) => "^",
                                Some(HorizontalAlign::Fill) => "\\",
                                _ => "",
                            }
                        } else {
                            ""
                        };
                        CellValue::Text(prefix.into())
                    }
                    _ => unreachable!(),
                })
            }
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
    pub(in crate::eval) async fn eval_isref(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        // Flatten only unions/parentheses here; each member must remain a
        // valid reference. Never evaluate referenced cells just to test ISREF.
        let mut pending = vec![&args[0]];
        while let Some(node) = pending.pop() {
            match node {
                ASTNode::Union { ranges } => pending.extend(ranges),
                ASTNode::Paren(inner) => pending.push(inner),
                ASTNode::StructuredRef(reference) => {
                    if self.meta.resolve_structured_ref(reference).is_err() {
                        return Ok(CellValue::Boolean(false));
                    }
                }
                _ => match self.eval_node_as_area(node).await {
                    Ok(_) => {}
                    Err(ComputeError::Eval { .. }) => return Ok(CellValue::Boolean(false)),
                    Err(error) => return Err(error),
                },
            }
        }
        Ok(CellValue::Boolean(true))
    }

    pub(in crate::eval) async fn eval_row(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        self.eval_row_column(args, true).await
    }

    pub(in crate::eval) async fn eval_column(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        self.eval_row_column(args, false).await
    }

    async fn eval_row_column(
        &mut self,
        args: &[ASTNode],
        rows: bool,
    ) -> Result<CellValue, ComputeError> {
        if args.len() > 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let (start, end) = if let Some(reference) = args.first() {
            match self.eval_node_as_area(reference).await {
                Ok((_, start_row, start_col, end_row, end_col)) => {
                    if rows {
                        (start_row, end_row)
                    } else {
                        (start_col, end_col)
                    }
                }
                Err(ComputeError::Eval { .. }) => {
                    // Invalid reference-producing functions preserve their
                    // error; scalar expressions still produce #VALUE!.
                    let value = self.eval_node_cv(reference).await?;
                    return Ok(match value {
                        CellValue::Error(..) => value,
                        _ => CellValue::Error(CellError::Value, None),
                    });
                }
                Err(error) => return Err(error),
            }
        } else {
            let Some((_, row, col)) = self.meta.resolve_position(&self.meta.current_cell()) else {
                return Ok(CellValue::Error(CellError::Ref, None));
            };
            let index = if rows { row } else { col };
            (index, index)
        };
        if start == end {
            return Ok(CellValue::number(f64::from(start) + 1.0));
        }
        let values = (start..=end)
            .map(|index| CellValue::number(f64::from(index) + 1.0))
            .collect();
        Ok(if rows {
            CellValue::column_array(values)
        } else {
            CellValue::row_array(values)
        })
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
        let Some(count) = areas_reference_count(&args[0]) else {
            return Ok(CellValue::Error(CellError::Value, None));
        };
        Ok(CellValue::number(count as f64))
    }
}
