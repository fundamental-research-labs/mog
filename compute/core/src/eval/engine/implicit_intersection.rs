//! Excel implicit-intersection (`@` / `SINGLE`) evaluation.

use super::evaluator::Evaluator;
use super::operators::eval_unary_op;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use cell_types::col_to_letter;
use compute_parser::ASTNode;
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) fn eval_implicit_intersection<'b>(
        &'b mut self,
        operand: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EvalValue, ComputeError>> + 'b>>
    {
        Box::pin(async move {
            let caller_id = self.meta.current_cell();
            let Some((caller_sheet, caller_row, caller_col)) =
                self.meta.resolve_position(&caller_id)
            else {
                let val = self.eval_node(operand).await?.into_cell_value();
                return Ok(EvalValue::Cell(eval_unary_op(
                    compute_parser::UnaryOp::ImplicitIntersection,
                    &val,
                )));
            };

            if Self::is_referenceable_for_intersection(operand) {
                match self.eval_node_as_area(operand).await {
                    Ok((area_sheet, sr, sc, er, ec)) => {
                        if sr == er && sc == ec {
                            let cv = self
                                .data
                                .get_cell_value_by_ref(&CellRef::Positional {
                                    sheet: area_sheet,
                                    row: sr,
                                    col: sc,
                                })
                                .await;
                            return Ok(EvalValue::Cell(cv));
                        }

                        let single_row = sr == er;
                        let single_col = sc == ec;

                        let pick_row = if single_row {
                            sr
                        } else if caller_row >= sr && caller_row <= er {
                            caller_row
                        } else {
                            return Ok(EvalValue::Cell(CellValue::error_with_message(
                                CellError::Value,
                                format!(
                                    "@: caller row {} not in range rows {}..={}",
                                    caller_row + 1,
                                    sr + 1,
                                    er + 1
                                ),
                            )));
                        };

                        let pick_col = if single_col {
                            sc
                        } else if caller_col >= sc && caller_col <= ec {
                            caller_col
                        } else {
                            return Ok(EvalValue::Cell(CellValue::error_with_message(
                                CellError::Value,
                                format!(
                                    "@: caller column {} not in range cols {}..={}",
                                    col_to_letter(caller_col),
                                    col_to_letter(sc),
                                    col_to_letter(ec)
                                ),
                            )));
                        };

                        let _ = caller_sheet;
                        let cv = self
                            .data
                            .get_cell_value_by_ref(&CellRef::Positional {
                                sheet: area_sheet,
                                row: pick_row,
                                col: pick_col,
                            })
                            .await;
                        return Ok(EvalValue::Cell(cv));
                    }
                    Err(_) => {}
                }
            }

            let val = self.eval_node(operand).await?.into_cell_value();
            Ok(EvalValue::Cell(eval_unary_op(
                compute_parser::UnaryOp::ImplicitIntersection,
                &val,
            )))
        })
    }
}
