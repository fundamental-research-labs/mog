//! Complex number functions: COMPLEX, IMABS, IMAGINARY, IMARGUMENT, IMCONJUGATE,
//! IMCOS, IMCOSH, IMCOT, IMCSC, IMCSCH, IMDIV, IMEXP, IMLN, IMLOG10, IMLOG2,
//! IMPOWER, IMPRODUCT, IMREAL, IMSEC, IMSECH, IMSIN, IMSINH, IMSQRT, IMSUB,
//! IMSUM, IMTAN

mod arithmetic;
mod components;
mod transcendental;
mod trig;
mod types;
mod wrappers;

#[cfg(test)]
mod tests;

use self::arithmetic::{FnImDiv, FnImPower, FnImProduct, FnImSqrt, FnImSub, FnImSum};
use self::components::{FnComplex, FnImAbs, FnImArgument, FnImConjugate, FnImReal, FnImaginary};
use self::transcendental::{FnImExp, FnImLn, FnImLog2, FnImLog10};
use self::trig::{
    FnImCos, FnImCosh, FnImCot, FnImCsc, FnImCsch, FnImSec, FnImSech, FnImSin, FnImSinh, FnImTan,
};

use crate::FunctionRegistry;

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnComplex));
    registry.register(Box::new(FnImAbs));
    registry.register(Box::new(FnImaginary));
    registry.register(Box::new(FnImArgument));
    registry.register(Box::new(FnImConjugate));
    registry.register(Box::new(FnImCos));
    registry.register(Box::new(FnImCosh));
    registry.register(Box::new(FnImCot));
    registry.register(Box::new(FnImCsc));
    registry.register(Box::new(FnImCsch));
    registry.register(Box::new(FnImDiv));
    registry.register(Box::new(FnImExp));
    registry.register(Box::new(FnImLn));
    registry.register(Box::new(FnImLog10));
    registry.register(Box::new(FnImLog2));
    registry.register(Box::new(FnImPower));
    registry.register(Box::new(FnImProduct));
    registry.register(Box::new(FnImReal));
    registry.register(Box::new(FnImSec));
    registry.register(Box::new(FnImSech));
    registry.register(Box::new(FnImSin));
    registry.register(Box::new(FnImSinh));
    registry.register(Box::new(FnImSqrt));
    registry.register(Box::new(FnImSub));
    registry.register(Box::new(FnImSum));
    registry.register(Box::new(FnImTan));
}
