/// Quartile values (Q1, median, Q3).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Quartiles {
    /// First quartile (25th percentile).
    pub q1: f64,
    /// Second quartile / median (50th percentile).
    pub median: f64,
    /// Third quartile (75th percentile).
    pub q3: f64,
}

/// Lower and upper outlier bounds (Tukey's rule).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OutlierBounds {
    /// Lower bound: Q1 - multiplier * IQR.
    pub lower: f64,
    /// Upper bound: Q3 + multiplier * IQR.
    pub upper: f64,
}

/// Kernel choice for KDE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KernelChoice {
    /// Gaussian (normal) kernel.
    Gaussian,
    /// Epanechnikov kernel (optimal MSE, compact support).
    Epanechnikov,
    /// Triangular kernel (compact support).
    Triangular,
    /// Uniform (box) kernel.
    Uniform,
    /// Biweight (quartic) kernel.
    Biweight,
}

/// Options for kernel density estimation.
#[derive(Debug, Clone, Default)]
pub struct KdeOptions {
    /// Smoothing bandwidth (default: Silverman's rule).
    pub bandwidth: Option<f64>,
    /// Number of output points (default: 100).
    pub points: Option<usize>,
    /// Kernel function (default: Gaussian).
    pub kernel: Option<KernelChoice>,
    /// Minimum x value (default: min(data) - 3*bandwidth).
    pub min_x: Option<f64>,
    /// Maximum x value (default: max(data) + 3*bandwidth).
    pub max_x: Option<f64>,
}

/// Result of kernel density estimation.
#[derive(Debug, Clone, PartialEq)]
pub struct KdeResult {
    /// X coordinates of the density curve.
    pub x: Vec<f64>,
    /// Y coordinates (density values) of the curve.
    pub y: Vec<f64>,
}
