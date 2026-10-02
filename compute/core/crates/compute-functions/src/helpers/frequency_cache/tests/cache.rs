use value_types::CellValue;

use super::{num, text};
use crate::helpers::frequency_cache::{
    CountFrequencyMap, SumFrequencyMap, clear, count_lookup, sum_and_count_lookup, sum_lookup,
};

#[test]
fn test_count_lookup_caches() {
    clear();
    let values = [num(1.0), num(2.0), num(1.0)];
    let refs: Vec<&CellValue> = values.iter().collect();

    let c1 = count_lookup(&refs, &num(1.0));
    assert_eq!(c1, 2);

    let c2 = count_lookup(&refs, &num(2.0));
    assert_eq!(c2, 1);
}

#[test]
fn test_clear_invalidates() {
    clear();
    let values = [num(1.0), num(1.0)];
    let refs: Vec<&CellValue> = values.iter().collect();
    assert_eq!(count_lookup(&refs, &num(1.0)), 2);

    clear();

    assert_eq!(count_lookup(&refs, &num(1.0)), 2);
}

#[test]
fn test_sum_lookup_basic() {
    clear();
    let criteria = [text("x"), text("y"), text("x")];
    let sums = [num(5.0), num(10.0), num(15.0)];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();

    let result = sum_lookup(&crit_refs, &sum_refs, &text("x"));
    assert_eq!(result.unwrap(), 20.0);
}

#[test]
fn test_percent_criteria_key_does_not_reclassify_percent_text_data() {
    let criteria_values = [num(0.5), text("50%"), text("0.5")];
    let criterion_refs: Vec<&CellValue> = criteria_values.iter().collect();
    let count_map = CountFrequencyMap::build(&criterion_refs);
    assert_eq!(count_map.count(&text("50%")), 2);

    let sum_values = [num(10.0), num(20.0), num(30.0)];
    let sum_refs: Vec<&CellValue> = sum_values.iter().collect();
    let sum_map = SumFrequencyMap::build(&criterion_refs, &sum_refs);
    assert_eq!(sum_map.sum(&text("50%")).unwrap(), 40.0);
    assert_eq!(sum_map.sum_and_count(&text("50%")).unwrap(), (40.0, 2));
}

/// Two sum ranges that are exact negations of each other, with an even number
/// of cells, are different ranges: `SUMIF(A1:A2,"x",B1:B2)` followed by
/// `SUMIF(A1:A2,"x",C1:C2)` with `C = -B` must not return the first result.
#[test]
fn test_sum_lookup_negated_sum_range_is_not_a_cache_hit() {
    clear();
    let criteria = [text("x"), text("x")];
    let sums = [num(5.0), num(10.0)];
    let negated = [num(-5.0), num(-10.0)];
    let crit_refs: Vec<&CellValue> = criteria.iter().collect();
    let sum_refs: Vec<&CellValue> = sums.iter().collect();
    let negated_refs: Vec<&CellValue> = negated.iter().collect();

    assert_eq!(sum_lookup(&crit_refs, &sum_refs, &text("x")).unwrap(), 15.0);
    assert_eq!(
        sum_lookup(&crit_refs, &negated_refs, &text("x")).unwrap(),
        -15.0
    );
    assert_eq!(
        sum_and_count_lookup(&crit_refs, &negated_refs, &text("x")).unwrap(),
        (-15.0, 2)
    );
}

#[test]
fn test_count_lookup_negated_range_is_not_a_cache_hit() {
    clear();
    let values = [num(1.0), num(2.0)];
    let negated = [num(-1.0), num(-2.0)];
    let refs: Vec<&CellValue> = values.iter().collect();
    let negated_refs: Vec<&CellValue> = negated.iter().collect();

    assert_eq!(count_lookup(&refs, &num(1.0)), 1);
    assert_eq!(count_lookup(&negated_refs, &num(1.0)), 0);
}
