//! `EvalValue` — the evaluator's internal value type.
//!
//! Wraps `CellValue` with evaluator-only variants for Lambda values and
//! omitted optional Lambda arguments. These values are first-class only during
//! evaluation and never escape to storage, wire, or formatting.
//!
//! Two conversion boundaries exist:
//! 1. `evaluate_cell()` — scheduler-facing output
//! 2. Array construction in higher-order functions (MAP/REDUCE/SCAN/etc.)
//!
//! At both: `Lambda/Omitted → CellValue::Error(CellError::Calc, None)`,
//! `Cell(v) → v`.

use std::borrow::Cow;

use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue, LambdaNode};

// ---------------------------------------------------------------------------
// EvalValue enum
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::eval) struct LambdaParam {
    pub(in crate::eval) name: String,
    pub(in crate::eval) optional: bool,
}

impl LambdaParam {
    #[inline]
    pub(in crate::eval) fn required(name: String) -> Self {
        Self {
            name,
            optional: false,
        }
    }

    #[inline]
    pub(in crate::eval) fn optional(name: String) -> Self {
        Self {
            name,
            optional: true,
        }
    }
}

/// The evaluator's internal value type. Extends `CellValue` with first-class
/// evaluator-only values that are converted to `#CALC!` at the boundary.
#[derive(Debug)]
pub(in crate::eval) enum EvalValue {
    /// Any non-lambda value (numbers, text, booleans, errors, null, arrays).
    Cell(CellValue),
    /// Missing optional LAMBDA argument, visible only to ISOMITTED.
    Omitted,
    /// Lambda function value — parameters, type-erased body, and captured
    /// lexical scope from definition time.
    Lambda {
        params: Vec<LambdaParam>,
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
            EvalValue::Omitted => EvalValue::Omitted,
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
    /// Convert to `CellValue`, collapsing evaluator-only values to `#CALC!`.
    /// This is the **only** way lambda values leave the evaluator.
    #[inline]
    pub(in crate::eval) fn into_cell_value(self) -> CellValue {
        match self {
            EvalValue::Cell(v) => v,
            EvalValue::Omitted => CellValue::Error(CellError::Calc, None),
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
            EvalValue::Omitted => CellValue::Error(CellError::Value, None),
            EvalValue::Lambda { .. } => CellValue::Error(CellError::Value, None),
        }
    }

    /// Borrow the inner `CellValue`, returning `None` for evaluator-only values.
    #[inline]
    pub(in crate::eval) fn as_cell(&self) -> Option<&CellValue> {
        match self {
            EvalValue::Cell(v) => Some(v),
            EvalValue::Omitted => None,
            EvalValue::Lambda { .. } => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Coercion delegators
// ---------------------------------------------------------------------------

impl EvalValue {
    /// Coerce to number. Evaluator-only values → `Err(CellError::Value)`.
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn coerce_to_number(&self) -> Result<f64, CellError> {
        match self {
            EvalValue::Cell(v) => v.coerce_to_number(),
            EvalValue::Omitted => Err(CellError::Value),
            EvalValue::Lambda { .. } => Err(CellError::Value),
        }
    }

    /// Coerce to string. Evaluator-only values → `Err(CellError::Value)`.
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn coerce_to_string(&self) -> Result<Cow<'_, str>, CellError> {
        match self {
            EvalValue::Cell(v) => v.coerce_to_string(),
            EvalValue::Omitted => Err(CellError::Value),
            EvalValue::Lambda { .. } => Err(CellError::Value),
        }
    }

    /// Coerce to bool. Evaluator-only values → `Err(CellError::Value)`.
    #[allow(dead_code)] // EvalValue API: available for formula function implementations
    pub(in crate::eval) fn coerce_to_bool(&self) -> Result<bool, CellError> {
        match self {
            EvalValue::Cell(v) => v.coerce_to_bool(),
            EvalValue::Omitted => Err(CellError::Value),
            EvalValue::Lambda { .. } => Err(CellError::Value),
        }
    }
}
