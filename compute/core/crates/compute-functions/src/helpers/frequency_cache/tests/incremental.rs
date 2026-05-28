use value_types::CellValue;

use super::{num, text};
use crate::helpers::frequency_cache::{CountFrequencyMap, SumFrequencyMap};

#[test]
fn test_count_frequency_map_incremental_update() {
    let values = [num(1.0), num(2.0), num(1.0), num(3.0)];
    let refs: Vec<&CellValue> = values.iter().collect();
    let mut map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&num(1.0)), 2);
    assert_eq!(map.count(&num(2.0)), 1);

    map.update(&num(1.0), &num(2.0));
    assert_eq!(map.count(&num(1.0)), 1);
    assert_eq!(map.count(&num(2.0)), 2);
}

#[test]
fn test_count_frequency_map_update_removes_zero_count() {
    let values = [num(5.0)];
    let refs: Vec<&CellValue> = values.iter().collect();
    let mut map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&num(5.0)), 1);

    map.update(&num(5.0), &num(6.0));
    assert_eq!(map.count(&num(5.0)), 0);
    assert_eq!(map.count(&num(6.0)), 1);
}

#[test]
fn test_count_frequency_map_update_text_case_insensitive() {
    let values = [text("Hello"), text("hello")];
    let refs: Vec<&CellValue> = values.iter().collect();
    let mut map = CountFrequencyMap::build(&refs);
    assert_eq!(map.count(&text("hello")), 2);

    map.update(&text("Hello"), &text("World"));
    assert_eq!(map.count(&text("hello")), 1);
    assert_eq!(map.count(&text("world")), 1);
}

#[test]
fn test_sum_frequency_map_incremental_update() {
    let criteria = [text("a"), text("b"), text("a")];
    let sums = [num(10.0), num(20.0), num(30.0)];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let mut map = SumFrequencyMap::build(&crit_refs, &sum_refs);
    assert_eq!(map.sum(&text("a")).unwrap(), 40.0);
    assert_eq!(map.sum(&text("b")).unwrap(), 20.0);

    map.update(&text("a"), &text("b"), &num(10.0), &num(15.0));
    assert_eq!(map.sum(&text("a")).unwrap(), 30.0);
    assert_eq!(map.sum(&text("b")).unwrap(), 35.0);
}

#[test]
fn test_sum_frequency_map_update_removes_empty_bucket() {
    let criteria = [text("x")];
    let sums = [num(100.0)];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let mut map = SumFrequencyMap::build(&crit_refs, &sum_refs);

    map.update(&text("x"), &text("y"), &num(100.0), &num(100.0));
    assert_eq!(map.sum(&text("x")).unwrap(), 0.0);
    assert_eq!(map.sum(&text("y")).unwrap(), 100.0);
}
