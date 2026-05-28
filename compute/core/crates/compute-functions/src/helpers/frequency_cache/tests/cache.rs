use value_types::CellValue;

use super::{num, text};
use crate::helpers::frequency_cache::{clear, count_lookup, sum_lookup};

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
