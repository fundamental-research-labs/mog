//! Distribution functions (using statrs crate):
//! Normal: NORM.DIST, NORMDIST, NORM.INV, NORMINV, NORM.S.DIST, NORMSDIST,
//!         NORM.S.INV, NORMSINV, STANDARDIZE
//! Student's t: T.DIST, T.DIST.2T, T.DIST.RT, TDIST, T.INV, T.INV.2T, TINV
//! Chi-squared: CHISQ.DIST, CHISQ.DIST.RT, CHIDIST, CHISQ.INV, CHISQ.INV.RT, CHIINV
//! F: F.DIST, F.DIST.RT, FDIST, F.INV, F.INV.RT, FINV
//! Binomial: BINOM.DIST, BINOMDIST, BINOM.DIST.RANGE, BINOM.INV, CRITBINOM
//! Poisson: POISSON.DIST, POISSON
//! Exponential: EXPON.DIST, EXPONDIST
//! Negative binomial: NEGBINOM.DIST, NEGBINOMDIST
//! LogNormal: LOGNORM.DIST, LOGNORMDIST, LOGNORM.INV, LOGINV
//! Weibull: WEIBULL.DIST, WEIBULL
//! Beta: BETA.DIST, BETADIST, BETA.INV, BETAINV
//! Gamma: GAMMA, GAMMA.DIST, GAMMADIST, GAMMA.INV, GAMMAINV, GAMMALN, GAMMALN.PRECISE
//! GAUSS, PHI
//! Hypergeometric: HYPGEOM.DIST, HYPGEOMDIST
//! Confidence: CONFIDENCE.NORM, CONFIDENCE, CONFIDENCE.T
//!
//! Implementations are split by distribution family modules below.

use crate::FunctionRegistry;

mod beta;
mod binomial;
mod chi_squared;
mod confidence;
mod exponential;
mod f_dist;
mod gamma;
mod hypergeometric;
mod lognormal;
mod negative_binomial;
mod normal;
mod poisson;
mod students_t;
mod support;
mod weibull;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use beta::{FnBetaDist, FnBetaDistLegacy, FnBetaInv, FnBetaInvLegacy};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use binomial::{
    FnBinomDist, FnBinomDistLegacy, FnBinomDistRange, FnBinomInv, FnCritBinom,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use chi_squared::{
    FnChiDistLegacy, FnChiInvLegacy, FnChisqDist, FnChisqDistRT, FnChisqInv, FnChisqInvRT,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use confidence::{FnConfidenceLegacy, FnConfidenceNorm, FnConfidenceT};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use exponential::{FnExponDist, FnExponDistLegacy};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use f_dist::{FnFDist, FnFDistLegacy, FnFDistRT, FnFInv, FnFInvLegacy, FnFInvRT};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use gamma::{
    FnGammaDist, FnGammaDistLegacy, FnGammaFn, FnGammaInv, FnGammaInvLegacy, FnGammaLn,
    FnGammaLnPrecise,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use hypergeometric::{FnHypGeomDist, FnHypGeomDistLegacy};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use lognormal::{FnLogInv, FnLogNormDist, FnLogNormDistLegacy, FnLogNormInv};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use negative_binomial::{FnNegBinomDist, FnNegBinomDistLegacy};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use normal::{
    FnGauss, FnNormDist, FnNormDistLegacy, FnNormInv, FnNormInvLegacy, FnNormSDist,
    FnNormSDistLegacy, FnNormSInv, FnNormSInvLegacy, FnPhi, FnStandardize,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use poisson::{FnPoissonDist, FnPoissonLegacy};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use students_t::{
    FnTDist, FnTDist2T, FnTDistLegacy, FnTDistRT, FnTInv, FnTInv2T, FnTInvLegacy,
};
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use weibull::{FnWeibullDist, FnWeibullLegacy};

pub fn register(registry: &mut FunctionRegistry) {
    // Registration order intentionally mirrors the pre-refactor monolith.
    normal::register(registry);
    students_t::register(registry);
    chi_squared::register(registry);
    f_dist::register(registry);
    binomial::register(registry);
    poisson::register(registry);
    exponential::register(registry);
    negative_binomial::register(registry);
    lognormal::register(registry);
    weibull::register(registry);
    beta::register(registry);
    gamma::register(registry);
    normal::register_gauss_phi(registry);
    hypergeometric::register(registry);
    confidence::register(registry);
}
