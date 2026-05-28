/// Computed bin parameters describing the bin grid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BinParams {
    /// Start of the first bin (inclusive).
    pub start: f64,
    /// End of the last bin.
    pub stop: f64,
    /// Width of each bin.
    pub step: f64,
    /// Number of bins.
    pub count: usize,
}

/// Round a step size to a "nice" number (1, 2, 5, or 10 times a power of 10).
pub fn nice_step(step: f64) -> f64 {
    if step <= 0.0 || !step.is_finite() {
        return 1.0;
    }

    let exp = step.log10().floor();
    let pow10 = 10.0_f64.powf(exp);
    let fraction = step / pow10;

    let nice_fraction = if fraction <= 1.0 {
        1.0
    } else if fraction <= 2.0 {
        2.0
    } else if fraction <= 5.0 {
        5.0
    } else {
        10.0
    };

    nice_fraction * pow10
}

/// Calculate bin parameters from a set of numeric values.
pub fn calculate_bins(
    values: &[f64],
    maxbins: Option<usize>,
    explicit_step: Option<f64>,
    nice: Option<bool>,
) -> BinParams {
    let nice = nice.unwrap_or(true);
    let maxbins = maxbins.unwrap_or(10).max(1);

    if values.is_empty() {
        return BinParams {
            start: 0.0,
            stop: 1.0,
            step: 1.0,
            count: 1,
        };
    }

    let mut min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let mut max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);

    if (min - max).abs() < f64::EPSILON {
        return BinParams {
            start: min - 0.5,
            stop: max + 0.5,
            step: 1.0,
            count: 1,
        };
    }

    let step = match explicit_step {
        Some(s) if s > 0.0 && s.is_finite() => s,
        _ => {
            let range = max - min;
            nice_step(range / maxbins as f64)
        }
    };

    if nice {
        min = (min / step).floor() * step;
        max = (max / step).ceil() * step;
    }

    let count = ((max - min) / step).ceil() as usize;
    let count = count.max(1);

    BinParams {
        start: min,
        stop: min + count as f64 * step,
        step,
        count,
    }
}

/// Find the bin index for a value within the given bin params.
pub fn find_bin_index(value: f64, bins: &BinParams) -> usize {
    if bins.count == 0 {
        return 0;
    }
    let idx = ((value - bins.start) / bins.step).floor() as isize;
    idx.max(0).min((bins.count as isize) - 1) as usize
}

/// Get the bin boundary values for a given range.
pub fn get_bin_boundaries(
    min: f64,
    max: f64,
    maxbins: Option<usize>,
    step: Option<f64>,
    nice: Option<bool>,
) -> Vec<f64> {
    let bins = calculate_bins(&[min, max], maxbins, step, nice);
    (0..=bins.count)
        .map(|i| bins.start + (i as f64) * bins.step)
        .collect()
}
