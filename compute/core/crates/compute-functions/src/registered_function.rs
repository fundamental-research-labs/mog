use crate::array_lift;
use crate::{ExcelFunction, PureFunction};
use value_types::CellValue;

/// Wrapper enum that unifies PureFunction and ExcelFunction in one registry.
pub enum RegisteredFunction {
    /// Classic pure function.
    Pure(Box<dyn PureFunction>),
    /// Function with declarative signature.
    Excel(Box<dyn ExcelFunction>),
}

impl RegisteredFunction {
    pub fn call(&self, args: &[CellValue]) -> CellValue {
        if !self.returns_array()
            && let Some(result) = array_lift::try_array_lift(self, args)
        {
            return result;
        }
        self.call_inner(args)
    }

    pub(crate) fn call_inner(&self, args: &[CellValue]) -> CellValue {
        match self {
            Self::Pure(f) => f.call(args),
            Self::Excel(f) => {
                let sig = f.signature();
                for (i, arg) in args.iter().enumerate() {
                    if let CellValue::Error(e, _) = arg
                        && sig.propagates_error(i)
                    {
                        return CellValue::Error(*e, None);
                    }
                }
                f.call(args)
            }
        }
    }

    pub(crate) fn is_liftable_arg(&self, index: usize) -> bool {
        match self {
            Self::Pure(f) => f.is_scalar_arg(index),
            Self::Excel(f) => {
                matches!(
                    f.signature().role_for_arg(index),
                    crate::signature::ArgRole::Scalar
                )
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Pure(f) => f.name(),
            Self::Excel(f) => f.name(),
        }
    }

    pub fn min_args(&self) -> usize {
        match self {
            Self::Pure(f) => f.min_args(),
            Self::Excel(f) => f.signature().min_args,
        }
    }

    pub fn max_args(&self) -> Option<usize> {
        match self {
            Self::Pure(f) => f.max_args(),
            Self::Excel(f) => f.signature().max_args,
        }
    }

    pub fn is_volatile(&self) -> bool {
        match self {
            Self::Pure(f) => f.is_volatile(),
            Self::Excel(f) => f.is_volatile(),
        }
    }

    pub fn returns_array(&self) -> bool {
        match self {
            Self::Pure(f) => f.returns_array(),
            Self::Excel(f) => f.returns_array(),
        }
    }

    pub fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match self {
            Self::Pure(f) => f.default_for_arg(index),
            Self::Excel(f) => f.default_for_arg(index),
        }
    }
}
