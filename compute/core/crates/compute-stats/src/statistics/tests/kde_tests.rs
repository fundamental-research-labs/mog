use super::*;

#[test]
fn test_kde_empty() {
    let result = kde(&[], &KdeOptions::default());
    assert!(result.x.is_empty());
    assert!(result.y.is_empty());
}

#[test]
fn test_kde_single_value() {
    let result = kde(&[5.0], &KdeOptions::default());
    assert_eq!(result.x.len(), 100);
    assert_eq!(result.y.len(), 100);
    assert!(result.y.iter().all(|&v| v >= 0.0));
}

#[test]
fn test_kde_bell_shape() {
    let data: Vec<f64> = vec![1.0, 2.0, 2.0, 3.0, 3.0, 3.0, 4.0, 4.0, 5.0];
    let result = kde(
        &data,
        &KdeOptions {
            points: Some(200),
            ..KdeOptions::default()
        },
    );
    assert_eq!(result.x.len(), 200);
    assert_eq!(result.y.len(), 200);

    let max_y = result.y.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let peak_idx = result.y.iter().position(|&v| v == max_y).unwrap();
    let peak_x = result.x[peak_idx];

    assert!(
        (peak_x - 3.0).abs() < 1.5,
        "Peak at x={}, expected near 3.0",
        peak_x
    );
}

#[test]
fn test_kde_with_epanechnikov() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    let result = kde(
        &data,
        &KdeOptions {
            kernel: Some(KernelChoice::Epanechnikov),
            points: Some(50),
            ..KdeOptions::default()
        },
    );
    assert_eq!(result.x.len(), 50);
    assert!(result.y.iter().all(|&v| v >= 0.0));
}

#[test]
fn test_kde_custom_bandwidth() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    let result = kde(
        &data,
        &KdeOptions {
            bandwidth: Some(0.5),
            points: Some(50),
            ..KdeOptions::default()
        },
    );
    assert_eq!(result.x.len(), 50);
}

#[test]
fn test_kde_custom_extent() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    let result = kde(
        &data,
        &KdeOptions {
            min_x: Some(0.0),
            max_x: Some(6.0),
            points: Some(20),
            ..KdeOptions::default()
        },
    );
    assert_approx!(result.x[0], 0.0);
    assert_approx!(*result.x.last().unwrap(), 6.0);
}

#[test]
fn test_kde_density_integrates_near_one() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
    let result = kde(
        &data,
        &KdeOptions {
            points: Some(500),
            ..KdeOptions::default()
        },
    );
    let step = (result.x.last().unwrap() - result.x[0]) / (result.x.len() - 1) as f64;
    let integral: f64 = result.y.iter().sum::<f64>() * step;
    assert!(
        (integral - 1.0).abs() < 0.1,
        "KDE integral = {}, expected ~1.0",
        integral
    );
}

#[test]
fn test_kde_all_kernels() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    let kernels = [
        KernelChoice::Gaussian,
        KernelChoice::Epanechnikov,
        KernelChoice::Triangular,
        KernelChoice::Uniform,
        KernelChoice::Biweight,
    ];
    for k in &kernels {
        let result = kde(
            &data,
            &KdeOptions {
                kernel: Some(*k),
                points: Some(20),
                ..KdeOptions::default()
            },
        );
        assert_eq!(result.x.len(), 20, "kernel {:?}", k);
        assert!(
            result.y.iter().all(|&v| v >= 0.0),
            "Negative density for kernel {:?}",
            k
        );
    }
}

// =========================================================================
// Binning statistics

#[test]
fn test_kde_single_point_peak() {
    // KDE of a single point: peak should be at (or very near) that point
    let result = kde(
        &[5.0],
        &KdeOptions {
            points: Some(200),
            ..KdeOptions::default()
        },
    );
    let max_y = result.y.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let peak_idx = result.y.iter().position(|&v| v == max_y).unwrap();
    let peak_x = result.x[peak_idx];
    assert!(
        (peak_x - 5.0).abs() < 0.5,
        "Peak at x={}, expected near 5.0",
        peak_x
    );
}

#[test]
fn test_kde_density_nonnegative() {
    let data = [1.0, 2.0, 3.0, 10.0, 20.0];
    let result = kde(
        &data,
        &KdeOptions {
            points: Some(100),
            ..KdeOptions::default()
        },
    );
    assert!(
        result.y.iter().all(|&v| v >= 0.0),
        "KDE density must be non-negative everywhere"
    );
}

#[test]
fn test_kde_uniform_data_roughly_uniform() {
    // Evenly spaced data should produce roughly uniform density in the middle
    let data: Vec<f64> = (0..20).map(|i| i as f64).collect();
    let result = kde(
        &data,
        &KdeOptions {
            points: Some(200),
            min_x: Some(5.0),
            max_x: Some(14.0),
            ..KdeOptions::default()
        },
    );
    // In the interior, density should not vary too wildly
    let densities: Vec<f64> = result.y[20..180].to_vec();
    let d_min = densities.iter().copied().fold(f64::INFINITY, f64::min);
    let d_max = densities.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    assert!(
        d_max / d_min < 2.0,
        "Uniform data KDE should be roughly uniform in interior, got ratio {}",
        d_max / d_min
    );
}

// =========================================================================
// First-principles: Kernel mathematical properties
// =========================================================================
