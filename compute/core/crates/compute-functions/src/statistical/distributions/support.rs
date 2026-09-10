/// Construct a statrs distribution or return the current function's #NUM! error.
macro_rules! try_dist {
    ($expr:expr, $func_name:expr) => {
        match $expr {
            Ok(d) => d,
            Err(_) => {
                return value_types::CellValue::error_with_message(
                    value_types::CellError::Num,
                    format!("{}: invalid distribution parameters", $func_name),
                )
            }
        }
    };
}

pub(super) use try_dist;

/// Stable tails used by the inverse solver. FisherSnedecor's statrs 0.17
/// survival function subtracts its beta argument from one, losing the right
/// tail; form that argument directly instead.
pub(super) trait InverseTails: statrs::distribution::ContinuousCDF<f64, f64> {
    fn lower_tail(&self, x: f64) -> f64 {
        self.cdf(x)
    }
    fn upper_tail(&self, x: f64) -> f64 {
        self.sf(x)
    }
}
impl InverseTails for statrs::distribution::Beta {
    fn lower_tail(&self, x: f64) -> f64 {
        inverse_beta_tail(self.shape_a(), self.shape_b(), x)
    }
    fn upper_tail(&self, x: f64) -> f64 {
        inverse_beta_tail(self.shape_b(), self.shape_a(), 1.0 - x)
    }
}
impl InverseTails for statrs::distribution::ChiSquared {}
impl InverseTails for statrs::distribution::FisherSnedecor {
    fn lower_tail(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return 0.0;
        }
        let ratio = (self.freedom_2() / self.freedom_1()) / x;
        inverse_beta_tail(
            self.freedom_1() / 2.0,
            self.freedom_2() / 2.0,
            1.0 / (1.0 + ratio),
        )
    }
    fn upper_tail(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return 1.0;
        }
        let ratio = (self.freedom_2() / self.freedom_1()) / x;
        let argument = if ratio.is_infinite() {
            1.0
        } else {
            ratio / (1.0 + ratio)
        };
        inverse_beta_tail(self.freedom_2() / 2.0, self.freedom_1() / 2.0, argument)
    }
}

/// Invert the smaller probability tail, retaining relative probability precision.
/// statrs 0.17 defaults to 16 bisections for these distributions. A rounded CDF
/// equal to a probability near one does not establish quantile convergence, so
/// use the survival function there and converge to adjacent representable x's.
pub(super) fn inverse_nonnegative_cdf<D: InverseTails>(distribution: &D, probability: f64) -> f64 {
    if probability <= 0.5 {
        inverse_tail(distribution, probability, false)
    } else {
        inverse_tail(distribution, 1.0 - probability, true)
    }
}

/// Keep the caller's right-tail probability intact, including values so small
/// that subtracting them from one would round to the endpoint.
pub(super) fn inverse_nonnegative_sf<D: InverseTails>(distribution: &D, probability: f64) -> f64 {
    if probability <= 0.5 {
        inverse_tail(distribution, probability, true)
    } else {
        inverse_tail(distribution, 1.0 - probability, false)
    }
}

fn inverse_tail<D: InverseTails>(distribution: &D, probability: f64, upper: bool) -> f64 {
    if probability == 0.0 {
        return if upper {
            distribution.max()
        } else {
            distribution.min()
        };
    }
    let tail = |x| {
        if upper {
            distribution.upper_tail(x)
        } else {
            distribution.lower_tail(x)
        }
    };
    let below_quantile = |value: f64| {
        if upper {
            value > probability
        } else {
            value < probability
        }
    };
    let mut low = distribution.min();
    let mut high = if distribution.max().is_finite() {
        distribution.max()
    } else {
        1.0
    };
    loop {
        let value = tail(high);
        if value.is_nan() {
            return f64::NAN;
        }
        if !below_quantile(value) {
            break;
        }
        low = high;
        if high == f64::MAX {
            return f64::INFINITY;
        }
        high = (high * 2.0).min(f64::MAX);
    }
    // 1075 halvings reach subnormals from one; allow room for every exponent.
    for _ in 0..2048 {
        let midpoint = low + (high - low) / 2.0;
        if midpoint == low || midpoint == high {
            return if (tail(low) - probability).abs() <= (tail(high) - probability).abs() {
                low
            } else {
                high
            };
        }
        let value = tail(midpoint);
        if value.is_nan() {
            return f64::NAN;
        }
        if below_quantile(value) {
            low = midpoint;
        } else {
            high = midpoint;
        }
    }
    f64::NAN
}

/// Regularized incomplete beta for inversion. statrs 0.17 snaps arguments
/// within epsilon of zero/one to those endpoints, destroying valid small tails.
/// Evaluate the usual beta continued fraction with exact endpoint checks and
/// log1p for the complementary power; do not change public forward functions.
fn inverse_beta_tail(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    if a == 1.0 {
        return -(b * (-x).ln_1p()).exp_m1();
    }
    if b == 1.0 {
        return (a * x.ln()).exp();
    }
    if a == b && x == 0.5 {
        return 0.5;
    }
    if x > (a + 1.0) / (a + b + 2.0) {
        return 1.0 - inverse_beta_fraction(b, a, 1.0 - x);
    }
    inverse_beta_fraction(a, b, x)
}

fn inverse_beta_fraction(a: f64, b: f64, x: f64) -> f64 {
    // Modified Lentz evaluation of the incomplete-beta continued fraction.
    let floor = f64::MIN_POSITIVE / f64::EPSILON;
    let nonzero = |v: f64| {
        if v.abs() < floor {
            floor.copysign(v)
        } else {
            v
        }
    };
    let sum = a + b;
    let mut c = 1.0;
    let mut d = 1.0 / nonzero(1.0 - sum * x / (a + 1.0));
    let mut fraction = d;
    for index in 1..=10000 {
        let m = index as f64;
        let twice = 2.0 * m;
        let even = m * (b - m) * x / ((a - 1.0 + twice) * (a + twice));
        d = 1.0 / nonzero(1.0 + even * d);
        c = nonzero(1.0 + even / c);
        fraction *= d * c;
        let odd = -(a + m) * (sum + m) * x / ((a + twice) * (a + 1.0 + twice));
        d = 1.0 / nonzero(1.0 + odd * d);
        c = nonzero(1.0 + odd / c);
        let change = d * c;
        fraction *= change;
        if (change - 1.0).abs() <= 4.0 * f64::EPSILON {
            let log_probability = a * x.ln() + b * (-x).ln_1p()
                - statrs::function::beta::ln_beta(a, b)
                + fraction.ln()
                - a.ln();
            return log_probability.exp().clamp(0.0, 1.0);
        }
    }
    f64::NAN
}
