//! Evaluator struct — recursive AST evaluator with safety limits and variable scoping.

use rustc_hash::FxHashMap;

use crate::eval::cache::lambda_cache::LambdaExprCache;
use crate::eval::cache::subexpr_cache;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::engine::reference_resolution::cell_ref_to_a1;
use crate::eval::eval_value::EvalValue;
use compute_parser::{ASTNode, CellRefNode, RangeRef};
use value_types::{CellError, CellValue, ComputeError};

use super::operators::{eval_binary_op, eval_unary_op};

/// Recursive AST evaluator with safety limits and variable scoping.
pub struct Evaluator<'a, D: EvalDataAccess, M: EvalMetadata> {
    pub(in crate::eval) data: &'a D,
    pub(in crate::eval) meta: &'a M,
    pub(in crate::eval) operations: u32,
    pub(in crate::eval) depth: u32,
    /// Variable scope stack for LET/LAMBDA bindings.
    /// Each frame is a map of variable names to their values.
    /// Scopes are searched top-to-bottom (innermost first).
    pub(in crate::eval) scope_stack: Vec<FxHashMap<String, EvalValue>>,
    /// Lambda expression cache -- active during BYROW/MAP/BYCOL/SCAN/REDUCE
    /// iteration loops to cache constant sub-expression results.
    pub(in crate::eval) lambda_expr_cache: Option<LambdaExprCache>,
    /// Optional per-formula deadline. When set, `tick()` checks wall-clock
    /// time every `DEADLINE_CHECK_INTERVAL` operations.
    pub deadline: Option<crate::time_compat::WasmSafeInstant>,
}

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    /// Top-level entry point.
    pub async fn evaluate(
        node: &ASTNode,
        data: &'a D,
        meta: &'a M,
    ) -> Result<CellValue, ComputeError> {
        let mut eval = Evaluator {
            data,
            meta,
            operations: 0,
            depth: 0,
            scope_stack: Vec::new(),
            lambda_expr_cache: None,
            deadline: None,
        };
        eval.eval_node(node).await.map(|ev| ev.into_cell_value())
    }

    /// Top-level entry point with a per-formula deadline.
    pub async fn evaluate_with_deadline(
        node: &ASTNode,
        data: &'a D,
        meta: &'a M,
        deadline: crate::time_compat::WasmSafeInstant,
    ) -> Result<CellValue, ComputeError> {
        let mut eval = Evaluator {
            data,
            meta,
            operations: 0,
            depth: 0,
            scope_stack: Vec::new(),
            lambda_expr_cache: None,
            deadline: Some(deadline),
        };
        eval.eval_node(node).await.map(|ev| ev.into_cell_value())
    }

    pub(in crate::eval) fn eval_node<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EvalValue, ComputeError>> + 'b>>
    {
        Box::pin(async move {
            self.tick()?;
            self.push_depth()?;
            let result = self.eval_node_inner(node).await;
            self.pop_depth();
            result
        })
    }

    /// Convenience wrapper: evaluate a node and collapse to `CellValue`.
    /// Used by eval_primitives and other sites that don't need lambda propagation.
    pub(in crate::eval) fn eval_node_cv<'b>(
        &'b mut self,
        node: &'b ASTNode,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<CellValue, ComputeError>> + 'b>>
    {
        Box::pin(async move { self.eval_node(node).await.map(|ev| ev.into_cell_value()) })
    }

    async fn eval_node_inner(&mut self, node: &ASTNode) -> Result<EvalValue, ComputeError> {
        if let Some(ref cache) = self.lambda_expr_cache {
            let ptr = node as *const ASTNode;
            if let Some(cached) = cache.values.get(&ptr) {
                return Ok(cached.clone());
            }
        }

        let subexpr_key =
            if matches!(node, ASTNode::Function { .. }) && subexpr_cache::is_cacheable(node) {
                let key = subexpr_cache::hash_ast(node);
                if let Some(cached) = subexpr_cache::get(key, node) {
                    return Ok(EvalValue::Cell(cached));
                }
                Some(key)
            } else {
                None
            };

        let result = match node {
            ASTNode::Number(n) => Ok(EvalValue::Cell(CellValue::number(*n))),
            ASTNode::Text(s) => Ok(EvalValue::Cell(CellValue::Text(s.clone().into()))),
            ASTNode::Boolean(b) => Ok(EvalValue::Cell(CellValue::Boolean(*b))),
            ASTNode::Error(e) => Ok(EvalValue::Cell(CellValue::Error(*e, None))),
            ASTNode::Omitted => Ok(EvalValue::Cell(CellValue::Null)),
            ASTNode::OptionalLambdaParam(_) => {
                Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)))
            }

            ASTNode::CellReference(CellRefNode { reference, .. }) => {
                if !self.scope_stack.is_empty() {
                    let a1 = cell_ref_to_a1(reference);
                    if let Some(v) = self.get_variable_case_insensitive(&a1) {
                        return Ok(v.clone());
                    }
                }
                Ok(EvalValue::Cell(
                    self.data.get_cell_value_by_ref(reference).await,
                ))
            }

            ASTNode::Range(RangeRef {
                start,
                end,
                range_type,
                ..
            }) => match self.data.get_range_values(start, end, range_type).await {
                Ok(arr) => Ok(EvalValue::Cell(CellValue::Array(arr))),
                Err(e) => Ok(EvalValue::Cell(CellValue::Error(e, None))),
            },

            ASTNode::SheetRef { sheet, inner } => self.eval_sheet_ref(*sheet, inner).await,
            ASTNode::UnresolvedSheetRef { sheet_name, inner } => {
                self.eval_unresolved_sheet_ref(sheet_name, inner).await
            }
            ASTNode::ThreeDRef {
                start_sheet,
                end_sheet,
                inner,
            } => self.eval_three_d_ref(start_sheet, end_sheet, inner).await,
            ASTNode::UnresolvedThreeDRef {
                start_name,
                end_name,
                inner,
            } => {
                self.eval_unresolved_three_d_ref(start_name, end_name, inner)
                    .await
            }
            ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. } => Ok(self.eval_external_ref_unavailable()),

            ASTNode::BinaryOp { op, left, right } => {
                if matches!(op, compute_parser::BinOp::Intersect) {
                    return Ok(EvalValue::Cell(
                        self.eval_reference_intersection(left, right).await?,
                    ));
                }
                Ok(EvalValue::Cell(
                    self.eval_left_deep_binary_chain(*op, left, right).await?,
                ))
            }

            ASTNode::UnaryOp { op, operand } => {
                if matches!(op, compute_parser::UnaryOp::ImplicitIntersection) {
                    return self.eval_implicit_intersection(operand).await;
                }
                let val = self.eval_node(operand).await?.into_cell_value();
                Ok(EvalValue::Cell(eval_unary_op(*op, &val)))
            }

            ASTNode::Function { name, args } => self.eval_function(name, args).await,
            ASTNode::Paren(inner) => self.eval_node(inner).await,
            ASTNode::Identifier(name) => self.eval_identifier(name).await,
            ASTNode::StructuredRef(ref_) => self.eval_structured_ref(ref_).await,
            ASTNode::Array { rows } => self.eval_array_literal(rows).await,
            ASTNode::CallExpression { callee, args } => {
                self.eval_call_expression(callee, args).await
            }
            ASTNode::RangeOp { start, end } => self.eval_range_op(start, end).await,
            ASTNode::Union { ranges } => self.eval_union(ranges).await,
        };

        if let Some(ref mut cache) = self.lambda_expr_cache {
            let ptr = node as *const ASTNode;
            if cache.cacheable.contains(&ptr)
                && let Ok(ref val) = result
            {
                cache.values.insert(ptr, val.clone());
            }
        }

        if let (Some(key), Ok(val)) = (&subexpr_key, &result)
            && let Some(cv) = val.as_cell()
            && matches!(cv, CellValue::Array(_))
        {
            subexpr_cache::insert(*key, node.clone(), cv.clone());
        }

        result
    }

    async fn eval_left_deep_binary_chain(
        &mut self,
        root_op: compute_parser::BinOp,
        root_left: &ASTNode,
        root_right: &ASTNode,
    ) -> Result<CellValue, ComputeError> {
        let mut spine = vec![(root_op, root_right)];
        let mut leftmost = root_left;

        while let ASTNode::BinaryOp { op, left, right } = leftmost {
            if matches!(op, compute_parser::BinOp::Intersect) {
                break;
            }
            self.tick()?;
            spine.push((*op, right));
            leftmost = left;
        }

        let mut acc = self.eval_node(leftmost).await?.into_cell_value();
        while let Some((op, right)) = spine.pop() {
            let rval = self.eval_node(right).await?.into_cell_value();
            acc = eval_binary_op(op, &acc, &rval);
        }

        Ok(acc)
    }
}
