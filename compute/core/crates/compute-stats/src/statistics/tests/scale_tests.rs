use super::*;

#[test]
fn test_z_scores_basic() {
    let data = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0];
    let z = z_scores(&data);
    assert_eq!(z.len(), data.len());
    assert_approx!(z[0], (2.0 - 5.0) / 2.0);
    assert_approx!(z[7], (9.0 - 5.0) / 2.0);
}

#[test]
fn test_z_scores_all_same() {
    let z = z_scores(&[5.0, 5.0, 5.0]);
    assert!(z.iter().all(|&v| v == 0.0));
}

#[test]
fn test_z_scores_empty() {
    assert!(z_scores(&[]).is_empty());
}

#[test]
fn test_normalize_basic() {
    let data = [1.0, 2.0, 3.0, 4.0, 5.0];
    let n = normalize(&data);
    assert_approx!(n[0], 0.0);
    assert_approx!(n[4], 1.0);
    assert_approx!(n[2], 0.5);
}

#[test]
fn test_normalize_all_same() {
    let n = normalize(&[7.0, 7.0, 7.0]);
    assert!(n.iter().all(|&v| approx_eq(v, 0.5, 1e-10)));
}

#[test]
fn test_normalize_empty() {
    assert!(normalize(&[]).is_empty());
}

#[test]
fn test_normalize_negative() {
    let data = [-10.0, 0.0, 10.0];
    let n = normalize(&data);
    assert_approx!(n[0], 0.0);
    assert_approx!(n[1], 0.5);
    assert_approx!(n[2], 1.0);
}

#[test]
fn test_z_scores_from_first_principles() {
    // [2, 4, 6]: mean=4, pop_var = (4+0+4)/3 = 8/3, std = sqrt(8/3)
    let data = [2.0, 4.0, 6.0];
    let z = z_scores(&data);
    let s = (8.0_f64 / 3.0).sqrt();
    assert_approx!(z[0], (2.0 - 4.0) / s, 1e-10);
    assert_approx!(z[1], 0.0, 1e-10); // middle element always 0
    assert_approx!(z[2], (6.0 - 4.0) / s, 1e-10);
}

#[test]
fn test_z_scores_sum_to_zero() {
    let data = [2.0, 4.0, 6.0];
    let z = z_scores(&data);
    let z_sum: f64 = z.iter().sum();
    assert_approx!(z_sum, 0.0, 1e-10);
}

#[test]
fn test_z_scores_constant_values() {
    // All same => std=0, should return all zeros
    let z = z_scores(&[42.0, 42.0, 42.0, 42.0]);
    assert!(z.iter().all(|&v| v == 0.0));
}

// =========================================================================
// First-principles: Normalize (min-max)
// =========================================================================

#[test]
fn test_normalize_simple_values() {
    // [10, 20, 30]: min=10, max=30, range=20
    // => [(10-10)/20, (20-10)/20, (30-10)/20] = [0.0, 0.5, 1.0]
    let n = normalize(&[10.0, 20.0, 30.0]);
    assert_approx!(n[0], 0.0, 1e-10);
    assert_approx!(n[1], 0.5, 1e-10);
    assert_approx!(n[2], 1.0, 1e-10);
}

#[test]
fn test_normalize_constant_returns_half() {
    // All same => range=0 => all 0.5
    let n = normalize(&[5.0, 5.0, 5.0]);
    for &v in &n {
        assert_approx!(v, 0.5, 1e-10);
    }
}

#[test]
fn test_normalize_two_elements() {
    // [0, 100] => [0.0, 1.0]
    let n = normalize(&[0.0, 100.0]);
    assert_approx!(n[0], 0.0, 1e-10);
    assert_approx!(n[1], 1.0, 1e-10);
}

#[test]
fn test_normalize_single_element() {
    let n = normalize(&[42.0]);
    assert_eq!(n.len(), 1);
    assert_approx!(n[0], 0.5, 1e-10);
}

// =========================================================================
// First-principles: Quantile edge cases
// =========================================================================
