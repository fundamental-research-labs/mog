//! Engineering functions: BIN2DEC, BIN2HEX, BIN2OCT, DEC2BIN, DEC2HEX, DEC2OCT,
//! HEX2BIN, HEX2DEC, HEX2OCT, OCT2BIN, OCT2DEC, OCT2HEX,
//! BESSELI, BESSELJ, BESSELK, BESSELY,
//! BITAND, BITOR, BITXOR, BITLSHIFT, BITRSHIFT,
//! DELTA, GESTEP,
//! COMPLEX, IMABS, IMAGINARY, IMARGUMENT, IMCONJUGATE, IMCOS, IMCOSH, IMCOT,
//! IMCSC, IMCSCH, IMDIV, IMEXP, IMLN, IMLOG10, IMLOG2, IMPOWER, IMPRODUCT,
//! IMREAL, IMSEC, IMSECH, IMSIN, IMSINH, IMSQRT, IMSUB, IMSUM, IMTAN,
//! ERF, ERF.PRECISE, ERFC, ERFC.PRECISE,
//! CONVERT

mod bessel;
mod bitwise;
mod complex;
mod conversion;
mod error_functions;
pub(crate) mod helpers;
mod unit_conversion;

use crate::FunctionRegistry;

// ===========================================================================
// Registration (52 total)
// ===========================================================================

pub fn register(registry: &mut FunctionRegistry) {
    // Base Conversion (12)
    conversion::register(registry);
    // Bessel Functions (4)
    bessel::register(registry);
    // Bitwise Operations (5) + Comparison (2)
    bitwise::register(registry);
    // Complex Numbers (26)
    complex::register(registry);
    // Error Functions (4)
    error_functions::register(registry);
    // Unit Conversion (1)
    unit_conversion::register(registry);
}
