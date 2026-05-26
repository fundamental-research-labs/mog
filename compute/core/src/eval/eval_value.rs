//! `EvalValue` — the evaluator's internal value type.
//!
//! Wraps `CellValue` with a `Lambda` variant that carries captured AST and
//! scope. Lambda is first-class within the evaluator (bound via LET, captured
//! in closures, returned from higher-order functions) but **never** escapes
//! to storage, wire, or formatting.
//!
//! Two conversion boundaries exist:
//! 1. `evaluate_cell()` — scheduler-facing output
//! 2. Array construction in higher-order functions (MAP/REDUCE/SCAN/etc.)
//!
//! At both: `Lambda → CellValue::Error(CellError::Calc, None)`, `Cell(v) → v`.

use std::borrow::Cow;

use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue, LambdaNode};

// ---------------------------------------------------------------------------
// EvalValue enum
// ---------------------------------------------------------------------------

/// The evaluator's internal value type. Extends `CellValue` with a `Lambda`
/// variant that is first-class during evaluation but converted to `#CALC!`
/// at the evaluator boundary.
#[derive(Debug)]
pub(in crate::eval) enum EvalValue {
    /// Any non-lambda value (numbers, text, booleans, errors, null, arrays).
    Cell(CellValue),
    /// Lambda function value — parameters, type-erased body, and captured
    /// lexical scope from definition time.
    Lambda {
        params: Vec<String>,
        body: Box<dyn LambdaNode>,
        captured_scope: Vec<FxHashMap<String, EvalValue>>,
    },
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

impl Clone for EvalValue {
    fn clone(&self) -> Self {
        match self {
            EvalValue::Cell(v) => EvalValue::Cell(v.clone()),
            EvalValue::Lambda {
                params,
                body,
                captured_scope,
            } => EvalValue::Lambda {
                params: params.clone(),
                body: body.clone_lambda(),
                captured_scope: captured_scope.clone(),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Conversion: CellValue → EvalValue
// ---------------------------------------------------------------------------

impl From<CellValue> for EvalValue {
    #[inline]
    fn from(v: CellValue) -> Self {
        EvalValue::Cell(v)
    }
}

// ---------------------------------------------------------------------------
// Conversion: EvalValue → CellValue (the boundary)
// ---------------------------------------------------------------------------

impl EvalValue {
    /// Convert to `CellValue`, collapsing `Lambda` to `#CALC!`.
    /// This is the **only** way lambda values leave the evaluator.
    #[inline]
    pub(in crate::eval) fn into_cell_value(self) -> CellValue {
        match self {
            EvalValue::Cell(v) => v,
            EvalValue::Lambda { .. } => CellValue::Error(CellError::Calc, None),
        }
    }

    /// Returns `true` if this is a `Lambda` variant.
    #[inline]
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn is_lambda(&self) -> bool {
        matches!(self, EvalValue::Lambda { .. })
    }

    /// Convert to `CellValue`, returning `CellError::Value` if this is a `Lambda`.
    #[inline]
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn unwrap_cell(self) -> CellValue {
        match self {
            EvalValue::Cell(v) => v,
            EvalValue::Lambda { .. } => CellValue::Error(CellError::Value, None),
        }
    }

    /// Borrow the inner `CellValue`, returning `None` for `Lambda`.
    #[inline]
    pub(in crate::eval) fn as_cell(&self) -> Option<&CellValue> {
        match self {
            EvalValue::Cell(v) => Some(v),
            EvalValue::Lambda { .. } => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Coercion delegators
// ---------------------------------------------------------------------------

impl EvalValue {
    /// Coerce to number. Lambda → `Err(CellError::Value)`.
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn coerce_to_number(&self) -> Result<f64, CellError> {
        match self {
            EvalValue::Cell(v) => v.coerce_to_number(),
            EvalValue::Lambda { .. } => Err(CellError::Value),
        }
    }

    /// Coerce to string. Lambda → `Err(CellError::Value)`.
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn coerce_to_string(&self) -> Result<Cow<'_, str>, CellError> {
        match self {
            EvalValue::Cell(v) => v.coerce_to_string(),
            EvalValue::Lambda { .. } => Err(CellError::Value),
        }
    }

    /// Coerce to bool. Lambda → `Err(CellError::Value)`.
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn coerce_to_bool(&self) -> Result<bool, CellError> {
        match self {
            EvalValue::Cell(v) => v.coerce_to_bool(),
            EvalValue::Lambda { .. } => Err(CellError::Value),
        }
    }
}
