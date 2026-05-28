use crate::transforms::bin::{
    BinParams, calculate_bins, find_bin_index, get_bin_boundaries, nice_step,
};

#[test]
fn nice_step_exact_powers_of_10() {
    assert_approx!(nice_step(1.0), 1.0);
    assert_approx!(nice_step(10.0), 10.0);
    assert_approx!(nice_step(100.0), 100.0);
    assert_approx!(nice_step(0.1), 0.1);
    assert_approx!(nice_step(0.01), 0.01);
}

#[test]
fn nice_step_rounds_to_2() {
    assert_approx!(nice_step(1.5), 2.0);
    assert_approx!(nice_step(15.0), 20.0);
    assert_approx!(nice_step(0.15), 0.2);
    assert_approx!(nice_step(0.015), 0.02);
}

#[test]
fn nice_step_rounds_to_5() {
    assert_approx!(nice_step(3.0), 5.0);
    assert_approx!(nice_step(4.0), 5.0);
    assert_approx!(nice_step(30.0), 50.0);
    assert_approx!(nice_step(0.3), 0.5);
}

#[test]
fn nice_step_rounds_to_10() {
    assert_approx!(nice_step(7.0), 10.0);
    assert_approx!(nice_step(8.0), 10.0);
    assert_approx!(nice_step(70.0), 100.0);
    assert_approx!(nice_step(0.7), 1.0);
}

#[test]
fn nice_step_zero_and_negative() {
    assert_approx!(nice_step(0.0), 1.0);
    assert_approx!(nice_step(-5.0), 1.0);
    assert_approx!(nice_step(-0.1), 1.0);
}

#[test]
fn nice_step_non_finite() {
    assert_approx!(nice_step(f64::INFINITY), 1.0);
    assert_approx!(nice_step(f64::NEG_INFINITY), 1.0);
    assert_approx!(nice_step(f64::NAN), 1.0);
}

#[test]
fn calculate_bins_empty() {
    let bins = calculate_bins(&[], None, None, None);
    assert_eq!(bins.count, 1);
    assert_approx!(bins.start, 0.0);
    assert_approx!(bins.stop, 1.0);
    assert_approx!(bins.step, 1.0);
}

#[test]
fn calculate_bins_single_value() {
    let bins = calculate_bins(&[5.0], None, None, None);
    assert_eq!(bins.count, 1);
    assert_approx!(bins.start, 4.5);
    assert_approx!(bins.stop, 5.5);
    assert_approx!(bins.step, 1.0);
}

#[test]
fn calculate_bins_all_same_values() {
    let bins = calculate_bins(&[42.0, 42.0, 42.0, 42.0], None, None, None);
    assert_eq!(bins.count, 1);
    assert_approx!(bins.start, 41.5);
    assert_approx!(bins.stop, 42.5);
    assert_approx!(bins.step, 1.0);
}

#[test]
fn calculate_bins_uniform_range() {
    let values: Vec<f64> = (0..100).map(|i| i as f64).collect();
    let bins = calculate_bins(&values, Some(10), None, Some(true));
    assert!(bins.count >= 1);
    assert!(bins.step > 0.0);
    assert!(bins.start <= 0.0);
    assert!(bins.stop >= 99.0);
}

#[test]
fn calculate_bins_nice_boundaries() {
    let values = vec![3.0, 7.0, 12.0, 18.0, 25.0];
    let bins = calculate_bins(&values, Some(5), None, Some(true));
    let remainder = (bins.start / bins.step).fract().abs();
    assert!(
        remainder < 1e-10 || (1.0 - remainder).abs() < 1e-10,
        "Start {} is not a nice multiple of step {}",
        bins.start,
        bins.step
    );
}

#[test]
fn calculate_bins_no_nice() {
    let values = vec![3.0, 7.0];
    let bins = calculate_bins(&values, Some(10), None, Some(false));
    assert_approx!(bins.start, 3.0);
}

#[test]
fn calculate_bins_explicit_step() {
    let values = vec![0.0, 100.0];
    let bins = calculate_bins(&values, None, Some(25.0), Some(true));
    assert_approx!(bins.step, 25.0);
    assert_eq!(bins.count, 4);
    assert_approx!(bins.start, 0.0);
    assert_approx!(bins.stop, 100.0);
}

#[test]
fn calculate_bins_stop_equals_start_plus_count_times_step() {
    let values = vec![1.0, 2.0, 5.0, 8.0, 9.0];
    let bins = calculate_bins(&values, Some(5), None, Some(true));
    assert_approx!(bins.stop, bins.start + bins.count as f64 * bins.step);
}

#[test]
fn calculate_bins_two_values() {
    let bins = calculate_bins(&[0.0, 100.0], Some(10), None, Some(true));
    assert!(bins.count >= 1);
    assert!(bins.start <= 0.0);
    assert!(bins.stop >= 100.0);
}

#[test]
fn find_bin_index_basic() {
    let bins = BinParams {
        start: 0.0,
        stop: 10.0,
        step: 2.0,
        count: 5,
    };
    assert_eq!(find_bin_index(0.0, &bins), 0);
    assert_eq!(find_bin_index(1.0, &bins), 0);
    assert_eq!(find_bin_index(2.0, &bins), 1);
    assert_eq!(find_bin_index(4.5, &bins), 2);
    assert_eq!(find_bin_index(9.9, &bins), 4);
}

#[test]
fn find_bin_index_clamps_upper() {
    let bins = BinParams {
        start: 0.0,
        stop: 10.0,
        step: 2.0,
        count: 5,
    };
    assert_eq!(find_bin_index(10.0, &bins), 4);
    assert_eq!(find_bin_index(15.0, &bins), 4);
}

#[test]
fn find_bin_index_clamps_lower() {
    let bins = BinParams {
        start: 0.0,
        stop: 10.0,
        step: 2.0,
        count: 5,
    };
    assert_eq!(find_bin_index(-1.0, &bins), 0);
    assert_eq!(find_bin_index(-100.0, &bins), 0);
}

#[test]
fn find_bin_index_single_bin() {
    let bins = BinParams {
        start: 4.5,
        stop: 5.5,
        step: 1.0,
        count: 1,
    };
    assert_eq!(find_bin_index(5.0, &bins), 0);
    assert_eq!(find_bin_index(4.5, &bins), 0);
    assert_eq!(find_bin_index(5.5, &bins), 0);
}

#[test]
fn get_bin_boundaries_basic() {
    let bounds = get_bin_boundaries(0.0, 10.0, Some(5), None, Some(true));
    assert!(bounds.len() >= 2);
    assert!(bounds[0] <= 0.0);
    assert!(*bounds.last().unwrap() >= 10.0);

    for i in 1..bounds.len() {
        assert!(bounds[i] > bounds[i - 1]);
    }
}

#[test]
fn get_bin_boundaries_count_is_n_plus_1() {
    let bounds = get_bin_boundaries(0.0, 10.0, None, Some(2.0), Some(true));
    assert_eq!(bounds.len(), 6);
    assert_approx!(bounds[0], 0.0);
    assert_approx!(bounds[5], 10.0);
}

#[test]
fn get_bin_boundaries_negative_range() {
    let bounds = get_bin_boundaries(-10.0, 10.0, Some(4), None, Some(true));
    assert!(!bounds.is_empty());
    assert!(bounds[0] <= -10.0);
    assert!(*bounds.last().unwrap() >= 10.0);
}
