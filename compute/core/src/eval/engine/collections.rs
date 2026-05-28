//! Array literal and union collection evaluation.

use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use compute_parser::ASTNode;
use value_types::{CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(super) async fn eval_array_literal(
        &mut self,
        rows: &[Vec<ASTNode>],
    ) -> Result<EvalValue, ComputeError> {
        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            let mut row_vals = Vec::with_capacity(row.len());
            for cell in row {
                row_vals.push(self.eval_node(cell).await?.into_cell_value());
            }
            result.push(row_vals);
        }
        Ok(EvalValue::Cell(CellValue::from_rows(result)))
    }

    pub(super) async fn eval_union(
        &mut self,
        ranges: &[ASTNode],
    ) -> Result<EvalValue, ComputeError> {
        let mut all_values: Vec<CellValue> = Vec::new();
        for range in ranges {
            let val = self.eval_node(range).await?.into_cell_value();
            match val {
                CellValue::Array(arr) => {
                    all_values.extend(arr.data().iter().cloned());
                }
                other => all_values.push(other),
            }
        }
        let rows: Vec<Vec<CellValue>> = all_values.into_iter().map(|v| vec![v]).collect();
        Ok(EvalValue::Cell(CellValue::from_rows(rows)))
    }
}
