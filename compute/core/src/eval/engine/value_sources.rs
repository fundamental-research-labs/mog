//! Identifier, defined-name, and structured-reference value sources.

use super::evaluator::Evaluator;
use super::reference_resolution::parse_defined_name_formula;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use crate::table::structured_refs::ResolvedStructuredRef;
use formula_types::{
    CellRef, RangeType, ResolvedName, SpecialItem, StructuredRef, StructuredRefSpecifier,
};
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(super) async fn eval_identifier(&mut self, name: &str) -> Result<EvalValue, ComputeError> {
        if let Some(v) = self.get_variable(name) {
            return Ok(v.clone());
        }
        match self.meta.resolve_defined_name(name) {
            Some(ResolvedName::Formula { raw_expression }) => {
                match parse_defined_name_formula(&raw_expression, self.meta) {
                    Some(ast) => match self.eval_node(&ast).await {
                        Ok(val) => Ok(val),
                        Err(ComputeError::DepthLimit) => {
                            Ok(EvalValue::Cell(CellValue::error_with_message(
                                CellError::Ref,
                                format!("Circular reference in name '{}'", name),
                            )))
                        }
                        Err(e) => Err(e),
                    },
                    None => Ok(EvalValue::Cell(CellValue::error_with_message(
                        CellError::Name,
                        format!("Undefined name '{}'", name),
                    ))),
                }
            }
            Some(resolved) => Ok(EvalValue::Cell(
                self.fetch_defined_name_value(&resolved).await,
            )),
            None => Ok(EvalValue::Cell(CellValue::error_with_message(
                CellError::Name,
                format!("Undefined name '{}'", name),
            ))),
        }
    }

    pub(super) async fn eval_structured_ref(
        &mut self,
        ref_: &StructuredRef,
    ) -> Result<EvalValue, ComputeError> {
        match self.meta.resolve_structured_ref(ref_) {
            Ok(resolved) => {
                let rows = self.fetch_structured_ref_values(&resolved).await;
                let is_this_row = ref_.specifiers.iter().any(|s| {
                    matches!(
                        s,
                        StructuredRefSpecifier::ThisRow
                            | StructuredRefSpecifier::Special {
                                item: SpecialItem::ThisRow
                            }
                    )
                });
                if is_this_row && rows.len() == 1 && rows[0].len() == 1 {
                    Ok(EvalValue::Cell(
                        rows.into_iter().next().unwrap().into_iter().next().unwrap(),
                    ))
                } else {
                    Ok(EvalValue::Cell(CellValue::from_rows(rows)))
                }
            }
            Err(e) => Ok(EvalValue::Cell(CellValue::Error(e, None))),
        }
    }

    pub(in crate::eval) async fn fetch_defined_name_value(
        &self,
        resolved: &ResolvedName,
    ) -> CellValue {
        match resolved {
            ResolvedName::Error(err) => CellValue::Error(*err, None),
            ResolvedName::Cell { sheet, row, col } => {
                let cell_ref = CellRef::Positional {
                    sheet: *sheet,
                    row: *row,
                    col: *col,
                };
                self.data.get_cell_value_by_ref(&cell_ref).await
            }
            ResolvedName::Range {
                sheet,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let start = CellRef::Positional {
                    sheet: *sheet,
                    row: *start_row,
                    col: *start_col,
                };
                let end = CellRef::Positional {
                    sheet: *sheet,
                    row: *end_row,
                    col: *end_col,
                };
                match self
                    .data
                    .get_range_values(&start, &end, &RangeType::CellRange)
                    .await
                {
                    Ok(arr) => CellValue::Array(arr),
                    Err(e) => CellValue::Error(e, None),
                }
            }
            ResolvedName::Constant(cv) => cv.clone(),
            ResolvedName::Formula { raw_expression } => {
                let _ = raw_expression;
                CellValue::Error(CellError::Name, None)
            }
        }
    }

    pub(in crate::eval) async fn fetch_structured_ref_values(
        &self,
        resolved: &ResolvedStructuredRef,
    ) -> Vec<Vec<CellValue>> {
        if resolved.ranges.is_empty() {
            return vec![];
        }
        let mut all_rows: Vec<Vec<CellValue>> = Vec::new();
        for range in &resolved.ranges {
            for r in range.start_row..=range.end_row {
                let mut row = Vec::new();
                for &c in &range.columns {
                    let cell_ref = CellRef::Positional {
                        sheet: resolved.sheet,
                        row: r,
                        col: c,
                    };
                    row.push(self.data.get_cell_value_by_ref(&cell_ref).await);
                }
                all_rows.push(row);
            }
        }
        all_rows
    }
}
