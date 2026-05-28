use super::evaluator::Evaluator;
use super::operators::{eval_binary_op, eval_unary_op};
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use compute_parser::{ASTNode, BinOp, UnaryOp};
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) async fn eval_operator_function_alias(
        &mut self,
        upper: &str,
        args: &[ASTNode],
    ) -> Result<Option<CellValue>, ComputeError> {
        if let Some(op) = binary_operator_alias(upper) {
            if args.len() != 2 {
                return Ok(Some(CellValue::Error(CellError::Value, None)));
            }
            let left = self.eval_node_cv(&args[0]).await?;
            let right = self.eval_node_cv(&args[1]).await?;
            return Ok(Some(eval_binary_op(op, &left, &right)));
        }

        if let Some(op) = unary_operator_alias(upper) {
            if args.len() != 1 {
                return Ok(Some(CellValue::Error(CellError::Value, None)));
            }
            let value = self.eval_node_cv(&args[0]).await?;
            return Ok(Some(eval_unary_op(op, &value)));
        }

        Ok(None)
    }
}

fn binary_operator_alias(name: &str) -> Option<BinOp> {
    match name {
        "ADD" => Some(BinOp::Add),
        "MINUS" => Some(BinOp::Sub),
        "MULTIPLY" => Some(BinOp::Mul),
        "DIVIDE" => Some(BinOp::Div),
        "POW" => Some(BinOp::Pow),
        "EQ" => Some(BinOp::Eq),
        "NE" => Some(BinOp::Neq),
        "GT" => Some(BinOp::Gt),
        "GTE" => Some(BinOp::Gte),
        "LT" => Some(BinOp::Lt),
        "LTE" => Some(BinOp::Lte),
        _ => None,
    }
}

fn unary_operator_alias(name: &str) -> Option<UnaryOp> {
    match name {
        "UMINUS" => Some(UnaryOp::Minus),
        "UPLUS" => Some(UnaryOp::Plus),
        "UNARY_PERCENT" => Some(UnaryOp::Percent),
        _ => None,
    }
}
