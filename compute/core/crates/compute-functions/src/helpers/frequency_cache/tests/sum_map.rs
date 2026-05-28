use value_types::{CellError, CellValue};

use super::{num, text};
use crate::helpers::frequency_cache::{SumFrequencyMap, clear};

#[test]
fn test_sum_basic() {
    clear();
    let criteria = [text("a"), text("b"), text("a"), text("b"), text("a")];
    let sums = [num(10.0), num(20.0), num(30.0), num(40.0), num(50.0)];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

    assert_eq!(map.sum(&text("a")).unwrap(), 90.0);
    assert_eq!(map.sum(&text("b")).unwrap(), 60.0);
    assert_eq!(map.sum(&text("c")).unwrap(), 0.0);
}

#[test]
fn test_sum_kahan_accuracy() {
    clear();
    let n = 10_000;
    let criteria: Vec<CellValue> = vec![text("x"); n];
    let sums: Vec<CellValue> = vec![num(0.1); n];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

    let result = map.sum(&text("x")).unwrap();
    assert!((result - 1000.0).abs() < 1e-10);
}

#[test]
fn test_sum_error_poisoning() {
    clear();
    let criteria = [text("a"), text("a"), text("b")];
    let sums = [
        num(10.0),
        CellValue::Error(CellError::Value, None),
        num(20.0),
    ];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

    assert_eq!(map.sum(&text("a")).unwrap_err(), CellError::Value);
    assert_eq!(map.sum(&text("b")).unwrap(), 20.0);
}

#[test]
fn test_sum_and_count() {
    clear();
    let criteria = [text("a"), text("b"), text("a"), text("a")];
    let sums = [num(10.0), num(20.0), num(30.0), CellValue::Null];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let map = SumFrequencyMap::build(&crit_refs, &sum_refs);

    let (sum, count) = map.sum_and_count(&text("a")).unwrap();
    assert_eq!(sum, 40.0);
    assert_eq!(count, 2);
}
