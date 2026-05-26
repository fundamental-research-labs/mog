//! Statistical functions: organized by sub-category.
//!
//! Sub-modules:
//! - counting: SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS, AVERAGEIFS, MAXIFS, MINIFS
//! - central_tendency: MEDIAN, MODE, MODE.SNGL, MODE.MULT, AVERAGEA, GEOMEAN, HARMEAN, TRIMMEAN
//! - dispersion: STDEV, STDEV.S, STDEV.P, STDEVP, STDEVA, STDEVPA, VAR, VAR.S, VAR.P, VARP, VARA, VARPA, AVEDEV, DEVSQ
//! - ranking: RANK, RANK.EQ, RANK.AVG, LARGE, SMALL
//! - percentile: PERCENTILE, PERCENTILE.INC, PERCENTILE.EXC, PERCENTRANK, PERCENTRANK.INC, PERCENTRANK.EXC, QUARTILE, QUARTILE.INC, QUARTILE.EXC
//! - correlation: CORREL, PEARSON, COVAR, COVARIANCE.P, COVARIANCE.S, FISHER, FISHERINV
//! - regression: FORECAST, FORECAST.LINEAR, SLOPE, INTERCEPT, RSQ, STEYX, LINEST, LOGEST, TREND, GROWTH, PROB
//! - shape: FREQUENCY, KURT, SKEW, SKEW.P
//! - extremes: MAXA, MINA
//! - distributions: Normal, Student's t, Chi-squared, F, Binomial, Poisson, Exponential, NegBinomial, LogNormal, Weibull, Beta, Gamma, Gauss, Phi, Hypergeometric, Confidence
//! - hypothesis: T.TEST, F.TEST, CHISQ.TEST, Z.TEST (+ legacy aliases)
//! - helpers: Shared statistical helper functions

mod central_tendency;
mod correlation;
mod counting;
mod dispersion;
mod distributions;
mod extremes;
pub(crate) mod helpers;
mod hypothesis;
mod percentile;
mod ranking;
mod regression;
mod shape;

use crate::FunctionRegistry;

/// Register all statistical functions with the given registry.
pub fn register(registry: &mut FunctionRegistry) {
    counting::register(registry);
    central_tendency::register(registry);
    dispersion::register(registry);
    percentile::register(registry);
    ranking::register(registry);
    correlation::register(registry);
    regression::register(registry);
    shape::register(registry);
    extremes::register(registry);
    distributions::register(registry);
    hypothesis::register(registry);
}

#[cfg(test)]
mod tests;
