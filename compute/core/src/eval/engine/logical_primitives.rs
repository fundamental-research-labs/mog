use super::evaluator::Evaluator;
use super::operators::broadcast_unary;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use compute_parser::ASTNode;
use value_types::{CellError, CellValue, ComputeError};

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) async fn eval_if(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() || args.len() > 3 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let cond = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = cond {
            return Ok(CellValue::Error(e, None));
        }

        // Array condition: element-wise IF (CSE / dynamic-array context)
        if let CellValue::Array(cond_arr) = cond {
            let val_true = if args.len() > 1 {
                if matches!(args[1], ASTNode::Omitted) {
                    CellValue::number(0.0)
                } else {
                    self.eval_node_cv(&args[1]).await?
                }
            } else {
                CellValue::Boolean(true)
            };
            let val_false = if args.len() > 2 {
                if matches!(args[2], ASTNode::Omitted) {
                    CellValue::number(0.0)
                } else {
                    self.eval_node_cv(&args[2]).await?
                }
            } else {
                CellValue::Boolean(false)
            };

            let num_rows = cond_arr.rows();
            let num_cols = cond_arr.cols();

            let mut data = Vec::with_capacity(num_rows * num_cols);
            for r in 0..num_rows {
                for c in 0..num_cols {
                    let cond_elem = cond_arr.get(r, c).cloned().unwrap_or(CellValue::Null);

                    // Propagate errors from the condition element
                    if let CellValue::Error(e, _) = cond_elem {
                        data.push(CellValue::Error(e, None));
                        continue;
                    }

                    let b = cond_elem.coerce_to_bool().unwrap_or(false);

                    let source = if b { &val_true } else { &val_false };
                    match source {
                        CellValue::Array(src_arr) => {
                            data.push(src_arr.get(r, c).cloned().unwrap_or(CellValue::Null))
                        }
                        other => data.push(other.clone()),
                    }
                }
            }

            return Ok(CellValue::array(data, num_cols));
        }

        // Scalar condition: existing path
        let b = cond.coerce_to_bool().unwrap_or(false);
        if b {
            if args.len() > 1 {
                if matches!(args[1], ASTNode::Omitted) {
                    Ok(CellValue::number(0.0))
                } else {
                    self.eval_node_cv(&args[1]).await
                }
            } else {
                Ok(CellValue::Boolean(true))
            }
        } else if args.len() > 2 {
            if matches!(args[2], ASTNode::Omitted) {
                Ok(CellValue::number(0.0))
            } else {
                self.eval_node_cv(&args[2]).await
            }
        } else {
            Ok(CellValue::Boolean(false))
        }
    }
    pub(in crate::eval) async fn eval_and(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let vals = self.eval_and_flatten(args).await?;
        // First pass: propagate errors
        for v in &vals {
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(*e, None));
            }
        }
        // Second pass: evaluate booleans/numbers, skip text and null
        let mut found_valid = false;
        for v in &vals {
            match v {
                CellValue::Text(_) | CellValue::Null => continue,
                _ => {
                    found_valid = true;
                    match v.coerce_to_bool() {
                        Ok(false) => return Ok(CellValue::Boolean(false)),
                        Ok(true) => {}
                        Err(e) => return Ok(CellValue::Error(e, None)),
                    }
                }
            }
        }
        if !found_valid {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        Ok(CellValue::Boolean(true))
    }
    pub(in crate::eval) async fn eval_or(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.is_empty() {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let vals = self.eval_and_flatten(args).await?;
        // First pass: propagate errors
        for v in &vals {
            if let CellValue::Error(e, _) = v {
                return Ok(CellValue::Error(*e, None));
            }
        }
        // Second pass: evaluate booleans/numbers, skip text and null
        let mut found_valid = false;
        for v in &vals {
            match v {
                CellValue::Text(_) | CellValue::Null => continue,
                _ => {
                    found_valid = true;
                    match v.coerce_to_bool() {
                        Ok(true) => return Ok(CellValue::Boolean(true)),
                        Ok(false) => {}
                        Err(e) => return Ok(CellValue::Error(e, None)),
                    }
                }
            }
        }
        if !found_valid {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        Ok(CellValue::Boolean(false))
    }
    pub(in crate::eval) async fn eval_not(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 1 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let v = self.eval_node_cv(&args[0]).await?;
        if let CellValue::Error(e, _) = v {
            return Ok(CellValue::Error(e, None));
        }
        Ok(broadcast_unary(v, |elem| {
            if let CellValue::Error(e, _) = elem {
                return CellValue::Error(*e, None);
            }
            match elem.coerce_to_bool() {
                Ok(b) => CellValue::Boolean(!b),
                Err(e) => CellValue::Error(e, None),
            }
        }))
    }
    pub(in crate::eval) async fn eval_iferror(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let v = self.eval_node_cv(&args[0]).await?;
        if v.is_error() {
            self.eval_node_cv(&args[1]).await
        } else if let CellValue::Array(arr) = &v {
            // Element-wise: replace error elements with the fallback value
            if arr.iter().any(|el| el.is_error()) {
                let fallback = self.eval_node_cv(&args[1]).await?;
                let data: Vec<CellValue> = arr
                    .iter()
                    .map(|el| {
                        if el.is_error() {
                            fallback.clone()
                        } else {
                            el.clone()
                        }
                    })
                    .collect();
                Ok(CellValue::array(data, arr.cols()))
            } else {
                Ok(v)
            }
        } else {
            Ok(v)
        }
    }
    pub(in crate::eval) async fn eval_ifna(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() != 2 {
            return Ok(CellValue::Error(CellError::Value, None));
        }
        let v = self.eval_node_cv(&args[0]).await?;
        if matches!(v, CellValue::Error(CellError::Na, _)) {
            self.eval_node_cv(&args[1]).await
        } else if let CellValue::Array(arr) = &v {
            // Element-wise: replace #N/A elements with the fallback value
            if arr
                .iter()
                .any(|el| matches!(el, CellValue::Error(CellError::Na, _)))
            {
                let fallback = self.eval_node_cv(&args[1]).await?;
                let data: Vec<CellValue> = arr
                    .iter()
                    .map(|el| {
                        if matches!(el, CellValue::Error(CellError::Na, _)) {
                            fallback.clone()
                        } else {
                            el.clone()
                        }
                    })
                    .collect();
                Ok(CellValue::array(data, arr.cols()))
            } else {
                Ok(v)
            }
        } else {
            Ok(v)
        }
    }
    pub(in crate::eval) async fn eval_ifs(
        &mut self,
        args: &[ASTNode],
    ) -> Result<CellValue, ComputeError> {
        if args.len() < 2 || !args.len().is_multiple_of(2) {
            return Ok(CellValue::Error(CellError::Value, None));
        }

        // Evaluate all conditions up front to detect array mode.
        let mut conditions: Vec<CellValue> = Vec::new();
        let mut any_array = false;
        let mut array_len = 0usize;
        let mut array_cols = 1usize;

        for pair in args.chunks(2) {
            let cond = self.eval_node_cv(&pair[0]).await?;
            if let CellValue::Array(ref arr) = cond
                && !any_array
            {
                any_array = true;
                array_len = arr.len();
                array_cols = arr.cols();
            }
            conditions.push(cond);
        }

        if !any_array {
            // Scalar path (original behaviour)
            for (pair_idx, pair) in args.chunks(2).enumerate() {
                let cond = &conditions[pair_idx];
                if let CellValue::Error(e, _) = cond {
                    return Ok(CellValue::Error(*e, None));
                }
                match cond.coerce_to_bool() {
                    Ok(true) => return self.eval_node_cv(&pair[1]).await,
                    Ok(false) => continue,
                    Err(e) => return Ok(CellValue::Error(e, None)),
                }
            }
            Ok(CellValue::Error(CellError::Na, None))
        } else {
            // Array path: evaluate element-wise across all pairs.
            let mut results = vec![None; array_len];

            for (pair_idx, pair) in args.chunks(2).enumerate() {
                let cond = &conditions[pair_idx];

                // If every element already has a result, short-circuit.
                if results.iter().all(|r| r.is_some()) {
                    break;
                }

                // Lazily evaluate the value expression only when needed.
                let mut value_evaluated = None;

                #[allow(clippy::needless_range_loop)]
                for i in 0..array_len {
                    if results[i].is_some() {
                        continue; // already matched by an earlier pair
                    }

                    let elem_cond = match cond {
                        CellValue::Array(arr) => {
                            arr.data().get(i).cloned().unwrap_or(CellValue::Null)
                        }
                        CellValue::Error(e, _) => {
                            results[i] = Some(CellValue::Error(*e, None));
                            continue;
                        }
                        scalar => scalar.clone(),
                    };

                    if let CellValue::Error(e, _) = elem_cond {
                        results[i] = Some(CellValue::Error(e, None));
                        continue;
                    }

                    match elem_cond.coerce_to_bool() {
                        Ok(true) => {
                            // Lazily evaluate the value expression.
                            if value_evaluated.is_none() {
                                value_evaluated = Some(self.eval_node_cv(&pair[1]).await?);
                            }
                            let val = value_evaluated.as_ref().unwrap();
                            let elem_val = match val {
                                CellValue::Array(arr) => {
                                    arr.data().get(i).cloned().unwrap_or(CellValue::Null)
                                }
                                scalar => scalar.clone(),
                            };
                            results[i] = Some(elem_val);
                        }
                        Ok(false) => continue,
                        Err(e) => {
                            results[i] = Some(CellValue::Error(e, None));
                        }
                    }
                }
            }

            // Fill any unmatched elements with #N/A.
            let final_results: Vec<CellValue> = results
                .into_iter()
                .map(|r| r.unwrap_or(CellValue::Error(CellError::Na, None)))
                .collect();

            Ok(CellValue::array(final_results, array_cols))
        }
    }
}
