//! Evaluator scope, operation, depth, and deadline state helpers.

use super::super::{MAX_DEPTH, MAX_OPERATIONS, MAX_SCOPE_DEPTH};
use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use value_types::ComputeError;

/// Check deadline every 1024 operations (~100ns amortised cost).
const DEADLINE_CHECK_INTERVAL: u32 = 1024;

impl<'a, D: EvalDataAccess, M: EvalMetadata> Evaluator<'a, D, M> {
    pub(in crate::eval) fn push_scope(&mut self) -> Result<(), ComputeError> {
        if self.scope_stack.len() >= MAX_SCOPE_DEPTH {
            return Err(ComputeError::DepthLimit);
        }
        self.scope_stack.push(rustc_hash::FxHashMap::default());
        Ok(())
    }

    pub(in crate::eval) fn pop_scope(&mut self) {
        self.scope_stack.pop();
    }

    /// Pop exactly `count` scopes from the stack. Used to clean up after
    /// pushing multiple captured scope frames (e.g. lambda closure restoration).
    pub(in crate::eval) fn pop_scopes(&mut self, count: usize) {
        for _ in 0..count {
            self.scope_stack.pop();
        }
    }

    pub(in crate::eval) fn set_variable(&mut self, name: String, value: EvalValue) {
        if let Some(frame) = self.scope_stack.last_mut() {
            frame.insert(name, value);
        }
    }

    pub(in crate::eval) fn get_variable(&self, name: &str) -> Option<&EvalValue> {
        for frame in self.scope_stack.iter().rev() {
            if let Some(v) = frame.get(name) {
                return Some(v);
            }
        }
        None
    }

    pub(super) fn get_variable_case_insensitive(&self, name: &str) -> Option<&EvalValue> {
        if self.scope_stack.is_empty() {
            return None;
        }
        let upper = name.to_ascii_uppercase();
        for frame in self.scope_stack.iter().rev() {
            for (key, value) in frame.iter() {
                if key.to_ascii_uppercase() == upper {
                    return Some(value);
                }
            }
        }
        None
    }

    pub(in crate::eval) fn tick(&mut self) -> Result<(), ComputeError> {
        self.operations += 1;
        if self.operations > MAX_OPERATIONS {
            return Err(ComputeError::OperationLimit);
        }
        self.check_deadline()
    }

    #[inline]
    fn check_deadline(&self) -> Result<(), ComputeError> {
        if let Some(dl) = self.deadline
            && self.operations.is_multiple_of(DEADLINE_CHECK_INTERVAL)
            && crate::time_compat::WasmSafeInstant::now() > dl
        {
            return Err(ComputeError::DeadlineExceeded);
        }
        Ok(())
    }

    pub(in crate::eval) fn push_depth(&mut self) -> Result<(), ComputeError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(ComputeError::DepthLimit);
        }
        Ok(())
    }

    pub(in crate::eval) fn pop_depth(&mut self) {
        debug_assert!(self.depth > 0, "pop_depth called at depth 0");
        self.depth = self.depth.saturating_sub(1);
    }
}
