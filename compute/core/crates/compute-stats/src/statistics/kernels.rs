use std::f64::consts::PI;

use super::types::KernelChoice;

/// Gaussian kernel: `(1/sqrt(2pi)) * exp(-u^2/2)`.
#[must_use]
pub fn gaussian_kernel(u: f64) -> f64 {
    (-0.5 * u * u).exp() / (2.0 * PI).sqrt()
}

/// Epanechnikov kernel: `(3/4)(1 - u^2)` for `|u| <= 1`, else `0`.
#[must_use]
pub fn epanechnikov_kernel(u: f64) -> f64 {
    if u.abs() > 1.0 {
        0.0
    } else {
        0.75 * (1.0 - u * u)
    }
}

/// Triangular kernel: `(1 - |u|)` for `|u| <= 1`, else `0`.
#[must_use]
pub fn triangular_kernel(u: f64) -> f64 {
    let abs_u = u.abs();
    if abs_u > 1.0 { 0.0 } else { 1.0 - abs_u }
}

/// Uniform (box) kernel: `0.5` for `|u| <= 1`, else `0`.
#[must_use]
pub fn uniform_kernel(u: f64) -> f64 {
    if u.abs() > 1.0 { 0.0 } else { 0.5 }
}

/// Biweight (quartic) kernel: `(15/16)(1 - u^2)^2` for `|u| <= 1`, else `0`.
#[must_use]
pub fn biweight_kernel(u: f64) -> f64 {
    if u.abs() > 1.0 {
        0.0
    } else {
        let t = 1.0 - u * u;
        (15.0 / 16.0) * t * t
    }
}

/// Resolve a `KernelChoice` to its kernel function pointer.
pub(super) fn kernel_fn(choice: KernelChoice) -> fn(f64) -> f64 {
    match choice {
        KernelChoice::Gaussian => gaussian_kernel,
        KernelChoice::Epanechnikov => epanechnikov_kernel,
        KernelChoice::Triangular => triangular_kernel,
        KernelChoice::Uniform => uniform_kernel,
        KernelChoice::Biweight => biweight_kernel,
    }
}
