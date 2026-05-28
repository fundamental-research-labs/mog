//! Special-form evaluators — call expressions, lambda invocation, ANCHORARRAY,
//! SINGLE (implicit intersection), LET, LAMBDA, and ISOMITTED.
//!
//! These are "special forms" because they inspect raw AST nodes rather than
//! simply evaluating their arguments. For example, LET binds variable names
//! from `Identifier` nodes, LAMBDA captures the body without evaluating it,
//! and ISOMITTED checks for `ASTNode::Omitted`.

use rustc_hash::FxHashMap;

use super::super::MAX_SCOPE_DEPTH;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};

use super::evaluator::Evaluator;
use super::reference_resolution::cell_ref_to_a1;

use crate::eval::eval_value::{EvalValue, LambdaParam};
use compute_parser::{ASTNode, CellRefNode};
use formula_types::CellRef;
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    // -----------------------------------------------------------------------
    // Call expression: (LAMBDA(x, x+1))(5) or myFunc(3, 4)
    // -----------------------------------------------------------------------

    pub(in crate::eval) async fn eval_call_expression(
        &mut self,
        callee: &ASTNode,
        args: &[ASTNode],
    ) -> Result<EvalValue, ComputeError> {
        let callee_val = self.eval_node(callee).await?;
        match callee_val {
            EvalValue::Lambda {
                params,
                body,
                captured_scope,
            } => {
                let body = body
                    .as_any()
                    .downcast_ref::<compute_parser::ASTNode>()
                    .expect("Lambda body must be ASTNode");
                if !lambda_arity_accepts(&params, args.len()) {
                    return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
                }
                let arg_vals = self.eval_lambda_call_args(&params, args).await?;
                if let Some(err) = first_cell_error(&arg_vals) {
                    return Ok(EvalValue::Cell(err));
                }
                // Restore captured scope frames (lexical closure semantics).
                // Track the number of pushed scopes so we pop exactly the right
                // amount, even if an early return were added later.
                let captured_count = captured_scope.len();
                for scope in &captured_scope {
                    if self.scope_stack.len() >= MAX_SCOPE_DEPTH {
                        return Err(ComputeError::DepthLimit);
                    }
                    self.scope_stack.push(scope.clone());
                }
                // Push parameter bindings on top of captured scope
                let mut param_scope = FxHashMap::default();
                for (param, val) in params.iter().zip(arg_vals) {
                    param_scope.insert(param.name.clone(), val);
                }
                if self.scope_stack.len() >= MAX_SCOPE_DEPTH {
                    // Pop captured scopes before returning error
                    self.pop_scopes(captured_count);
                    return Err(ComputeError::DepthLimit);
                }
                self.scope_stack.push(param_scope);
                // Evaluate body
                let result = self.eval_node(body).await;
                // Pop parameter scope + all captured scopes
                // (captured_count + 1 total pushes)
                self.pop_scopes(captured_count + 1);
                result
            }
            EvalValue::Cell(cv @ CellValue::Error(..)) => Ok(EvalValue::Cell(cv)),
            _ => Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None))),
        }
    }

    // -----------------------------------------------------------------------
    // Lambda invocation helper
    // -----------------------------------------------------------------------

    /// Invoke an `EvalValue::Lambda` with pre-evaluated argument values.
    ///
    /// This is used by higher-order functions (MAP, REDUCE, SCAN, BYROW,
    /// BYCOL, MAKEARRAY) that need to call a lambda repeatedly with different
    /// argument values.  Unlike `eval_call_expression`, the arguments are
    /// already evaluated -- no AST nodes need to be evaluated here.
    ///
    /// Returns `#VALUE!` if `lambda_val` is not a Lambda or if the argument
    /// count doesn't match the parameter count.
    pub(in crate::eval) async fn invoke_lambda(
        &mut self,
        lambda_val: &EvalValue,
        arg_vals: &[CellValue],
    ) -> Result<CellValue, ComputeError> {
        match lambda_val {
            EvalValue::Lambda {
                params,
                body,
                captured_scope,
            } => {
                let body = body
                    .as_any()
                    .downcast_ref::<compute_parser::ASTNode>()
                    .expect("Lambda body must be ASTNode");
                if !lambda_arity_accepts(params, arg_vals.len()) {
                    return Ok(CellValue::Error(CellError::Value, None));
                }
                // Restore captured scope frames (lexical closure semantics)
                let captured_count = captured_scope.len();
                for scope in captured_scope {
                    if self.scope_stack.len() >= MAX_SCOPE_DEPTH {
                        return Err(ComputeError::DepthLimit);
                    }
                    self.scope_stack.push(scope.clone());
                }
                // Push parameter bindings on top of captured scope
                let mut param_scope = FxHashMap::default();
                for (param, val) in params.iter().zip(arg_vals.iter()) {
                    param_scope.insert(param.name.clone(), EvalValue::Cell(val.clone()));
                }
                for param in params.iter().skip(arg_vals.len()) {
                    param_scope.insert(param.name.clone(), EvalValue::Omitted);
                }
                if self.scope_stack.len() >= MAX_SCOPE_DEPTH {
                    self.pop_scopes(captured_count);
                    return Err(ComputeError::DepthLimit);
                }
                self.scope_stack.push(param_scope);
                // Evaluate body
                let result = self.eval_node(body).await.map(|ev| ev.into_cell_value());
                // Pop parameter scope + all captured scopes
                self.pop_scopes(captured_count + 1);
                result
            }
            EvalValue::Cell(cv @ CellValue::Error(..)) => Ok(cv.clone()),
            _ => Ok(CellValue::Error(CellError::Value, None)),
        }
    }

    // -----------------------------------------------------------------------
    // ANCHORARRAY function (spill range operator, `#`)
    // -----------------------------------------------------------------------

    /// Evaluate ANCHORARRAY(cell_ref) -- Excel's spill range operator (`#`).
    ///
    /// `_xlfn.ANCHORARRAY(A1)` returns the full dynamic array that spills from
    /// cell A1. The source cell stores `CellValue::Array` directly, so this
    /// simply resolves the cell reference and reads the raw value via
    /// `get_source_array`.
    pub(in crate::eval) async fn eval_anchorarray(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Extract the cell reference from the AST to get the source CellId.
        let inner = match &args[0] {
            ASTNode::SheetRef { inner, .. } => inner.as_ref(),
            other => other,
        };

        let source_cell_id = match inner {
            ASTNode::CellReference(CellRefNode { reference, .. }) => match reference {
                CellRef::Resolved(id) => Some(*id),
                CellRef::Positional { sheet, row, col } => {
                    self.meta.resolve_cell_id(sheet, *row, *col)
                }
            },
            _ => None,
        };

        if let Some(source_id) = source_cell_id {
            // Multi-cell dynamic arrays: the projection registry holds the
            // full CellValue::Array.
            if let Some(array_val) = self.data.get_source_array(&source_id).await {
                return Ok(array_val);
            }

            // 1×1 dynamic arrays: the projection registry skips 1×1 extents
            // (no spill targets), but ANCHORARRAY(ref) should still return
            // the cell's computed value. Check that the formula is classified
            // as dynamic-array capable; ordinary scalar formulas are not valid
            // spill anchors.
            if let Some((sheet, row, col)) = self.meta.resolve_position(&source_id)
                && self.meta.cell_has_dynamic_array_formula(&sheet, row, col)
            {
                let val = self.data.get_cell_value(&source_id).await;
                if !val.is_null() {
                    return Ok(val);
                }
            }
        }

        // The cell is not a projection source — return #VALUE! error.
        // (Excel returns #VALUE! when # is applied to a non-array cell.)
        Ok(CellValue::Error(CellError::Value, None))
    }

    // -----------------------------------------------------------------------
    // SINGLE function (implicit intersection operator)
    // -----------------------------------------------------------------------

    /// Evaluate SINGLE(range) -- Excel's implicit intersection operator (`@`).
    ///
    /// Keep the function spelling on the same implementation as the unary
    /// operator so row/column alignment, 2-D range picks, reference wrappers,
    /// and value-level array fallback cannot diverge.
    pub(in crate::eval) async fn eval_single(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        self.eval_implicit_intersection(&args[0])
            .await
            .map(|value| value.into_cell_value())
    }

    // -----------------------------------------------------------------------
    // LET function
    // -----------------------------------------------------------------------

    /// Evaluate LET(name1, value1, [name2, value2, ...], calculation).
    ///
    /// LET is a special form: name arguments are Identifier AST nodes (not evaluated),
    /// value arguments are evaluated in order (later bindings can reference earlier ones),
    /// and the final calculation expression is evaluated in the scope of all bindings.
    pub(in crate::eval) async fn eval_let(
        &mut self,
        args: &[ASTNode],
    ) -> Result<EvalValue, ComputeError> {
        // Minimum 3 args, must be odd (pairs of name/value + final calculation)
        if args.len() < 3 || args.len().is_multiple_of(2) {
            return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
        }

        let num_bindings = (args.len() - 1) / 2;
        self.push_scope()?;

        for i in 0..num_bindings {
            let name_idx = i * 2;
            let value_idx = name_idx + 1;

            // Extract the variable name from the Identifier AST node.
            // Also accept CellRef: the parser produces CellRef(T1) for `t1` in
            // `=LET(t1, 5, ...)` because `t1` is a valid cell address. Convert
            // it back to A1 text so it can be used as a variable name.
            let name = match &args[name_idx] {
                ASTNode::Identifier(name) => name.clone(),
                ASTNode::CellReference(CellRefNode { reference, .. }) => cell_ref_to_a1(reference),
                _ => {
                    self.pop_scope();
                    return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
                }
            };

            // Evaluate the value expression (can reference earlier bindings)
            let value = match self.eval_node(&args[value_idx]).await {
                Ok(v) => v,
                Err(e) => {
                    self.pop_scope();
                    return Err(e);
                }
            };

            self.set_variable(name, value);
        }

        // Evaluate the final calculation expression
        let result = self.eval_node(args.last().unwrap()).await;
        self.pop_scope();
        result
    }

    // -----------------------------------------------------------------------
    // LAMBDA function
    // -----------------------------------------------------------------------

    /// Evaluate LAMBDA(param1, [param2, ...], body).
    ///
    /// Returns an EvalValue::Lambda capturing the parameter names and body AST.
    /// The body is not evaluated until the lambda is called.
    pub(in crate::eval) fn eval_lambda(
        &mut self,
        args: &[ASTNode],
    ) -> Result<EvalValue, ComputeError> {
        // Minimum 1 arg (body only, zero-param lambda), but typically 2+ (params + body)
        if args.is_empty() {
            return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
        }

        let mut params = Vec::new();
        let mut saw_optional = false;
        // All args except the last are parameter names.
        // Accept CellRef too: `LAMBDA(a1, a1*2)` — `a1` is parsed as CellRef(A1).
        for arg in &args[..args.len() - 1] {
            let param = match arg {
                ASTNode::Identifier(name) => {
                    if saw_optional {
                        return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
                    }
                    LambdaParam::required(name.clone())
                }
                ASTNode::CellReference(CellRefNode { reference, .. }) => {
                    if saw_optional {
                        return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
                    }
                    LambdaParam::required(cell_ref_to_a1(reference))
                }
                ASTNode::OptionalLambdaParam(name) => {
                    saw_optional = true;
                    LambdaParam::optional(name.clone())
                }
                _ => return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None))),
            };
            if params
                .iter()
                .any(|existing: &LambdaParam| existing.name.eq_ignore_ascii_case(&param.name))
            {
                return Ok(EvalValue::Cell(CellValue::Error(CellError::Value, None)));
            }
            params.push(param);
        }

        // Last arg is the body (captured as AST, not evaluated)
        let body: Box<dyn value_types::LambdaNode> = Box::new(args.last().unwrap().clone());

        Ok(EvalValue::Lambda {
            params,
            body,
            captured_scope: self.scope_stack.clone(),
        })
    }

    // -----------------------------------------------------------------------
    // ISOMITTED function
    // -----------------------------------------------------------------------

    /// Evaluate ISOMITTED(value) -- check if an argument was omitted.
    ///
    /// This is a special form because it needs to inspect the raw AST to detect
    /// `ASTNode::Omitted`. When the argument is omitted, returns TRUE.
    pub(in crate::eval) async fn eval_isomitted(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        match &args[0] {
            ASTNode::Omitted => Ok(CellValue::Boolean(true)),
            _ => match self.eval_node(&args[0]).await? {
                EvalValue::Omitted => Ok(CellValue::Boolean(true)),
                EvalValue::Cell(CellValue::Error(e, payload)) => Ok(CellValue::Error(e, payload)),
                _ => Ok(CellValue::Boolean(false)),
            },
        }
    }

    async fn eval_lambda_call_args(
        &mut self,
        params: &[LambdaParam],
        args: &[ASTNode],
    ) -> Result<Vec<EvalValue>, ComputeError> {
        let mut arg_vals = Vec::with_capacity(params.len());
        for (param, arg) in params.iter().zip(args.iter()) {
            if param.optional && matches!(arg, ASTNode::Omitted) {
                arg_vals.push(EvalValue::Omitted);
                continue;
            }
            arg_vals.push(self.eval_node(arg).await?);
        }
        for param in params.iter().skip(args.len()) {
            if param.optional {
                arg_vals.push(EvalValue::Omitted);
            }
        }
        Ok(arg_vals)
    }
}

fn lambda_arity_accepts(params: &[LambdaParam], arg_count: usize) -> bool {
    let required = params.iter().filter(|param| !param.optional).count();
    arg_count >= required && arg_count <= params.len()
}

fn first_cell_error(values: &[EvalValue]) -> Option<CellValue> {
    values.iter().find_map(|value| match value {
        EvalValue::Cell(err @ CellValue::Error(..)) => Some(err.clone()),
        _ => None,
    })
}
