//! Evaluator scope, operation, depth, and deadline state helpers.

use super::super::{MAX_DEPTH, MAX_OPERATIONS, MAX_SCOPE_DEPTH};
use super::evaluator::Evaluator;
use crate::eval::context::traits::{EvalDataAccess, EvalMetadata};
use crate::eval::eval_value::EvalValue;
use compute_parser::{ASTNode, AstVisitor};
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
            // Excel names are case-insensitive; a later LET binding replaces
            // the earlier spelling rather than creating two competing keys.
            frame.retain(|key, _| !key.eq_ignore_ascii_case(&name));
            frame.insert(name, value);
        }
    }

    pub(in crate::eval) fn get_variable(&self, name: &str) -> Option<&EvalValue> {
        for frame in self.scope_stack.iter().rev() {
            if let Some(v) = frame.get(name).or_else(|| {
                frame
                    .iter()
                    .find(|(key, _)| key.eq_ignore_ascii_case(name))
                    .map(|(_, value)| value)
            }) {
                return Some(v);
            }
        }
        None
    }

    pub(super) fn get_variable_case_insensitive(&self, name: &str) -> Option<&EvalValue> {
        self.get_variable(name)
    }

    /// Function syntax can depend on a lexical binding even when no Identifier
    /// appears among its arguments. Such calls cannot share scope-free caches.
    pub(super) fn contains_lexical_call(&self, node: &ASTNode) -> bool {
        if self.scope_stack.is_empty() {
            return false;
        }
        struct Checker<F> {
            is_bound: F,
            found: bool,
        }
        impl<F: Fn(&str) -> bool> AstVisitor for Checker<F> {
            fn visit(&mut self, node: &ASTNode) {
                if !self.found {
                    self.walk(node);
                }
            }
            fn visit_function(&mut self, name: &str, args: &[ASTNode]) {
                if (self.is_bound)(name) {
                    self.found = true;
                    return;
                }
                for arg in args {
                    self.visit(arg);
                }
            }
        }
        let mut checker = Checker {
            is_bound: |name: &str| self.get_variable(name).is_some(),
            found: false,
        };
        checker.visit(node);
        checker.found
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
