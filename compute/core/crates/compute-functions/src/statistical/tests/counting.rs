use super::super::counting::*;
use crate::ExcelFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

fn col_arr(vals: Vec<CellValue>) -> CellValue {
    CellValue::from_rows(vals.into_iter().map(|v| vec![v]).collect())
}

fn row_arr(vals: Vec<CellValue>) -> CellValue {
    CellValue::from_rows(vec![vals])
}

#[test]
fn test_sumif() {
    let f = FnSumIf;
    let range = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_eq!(f.call(&[range.clone(), text(">3")]), num(9.0));
    assert_eq!(f.call(&[range, text(">=3")]), num(12.0));
}

#[test]
fn test_sumif_with_sum_range() {
    let f = FnSumIf;
    let range = arr(vec![1.0, 2.0, 3.0]);
    let sum_range = arr(vec![10.0, 20.0, 30.0]);
    assert_eq!(f.call(&[range, text(">1"), sum_range]), num(50.0));
}

#[test]
fn test_countif() {
    let f = FnCountIf;
    let range = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_eq!(f.call(&[range, text(">3")]), num(2.0));
}

#[test]
fn test_averageif() {
    let f = FnAverageIf;
    let range = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_eq!(f.call(&[range, text(">3")]), num(4.5));
}

#[test]
fn test_sumifs() {
    let f = FnSumIfs;
    let sum_range = arr(vec![10.0, 20.0, 30.0, 40.0]);
    let range1 = arr(vec![1.0, 2.0, 3.0, 4.0]);
    let range2 = arr(vec![10.0, 20.0, 30.0, 40.0]);
    // Sum values where range1 > 1 AND range2 > 15
    assert_eq!(
        f.call(&[sum_range, range1, text(">1"), range2, text(">15")]),
        num(90.0) // 20 + 30 + 40
    );
}

#[test]
fn test_countifs() {
    let f = FnCountIfs;
    let range1 = arr(vec![1.0, 2.0, 3.0, 4.0]);
    let range2 = arr(vec![10.0, 20.0, 30.0, 40.0]);
    assert_eq!(f.call(&[range1, text(">1"), range2, text(">15")]), num(3.0));
}

#[test]
fn test_maxifs() {
    let f = FnMaxIfs;
    let max_range = arr(vec![10.0, 20.0, 30.0, 40.0]);
    let crit_range = arr(vec![1.0, 2.0, 3.0, 4.0]);
    assert_eq!(f.call(&[max_range, crit_range, text(">2")]), num(40.0));
}

#[test]
fn test_minifs() {
    let f = FnMinIfs;
    let min_range = arr(vec![10.0, 20.0, 30.0, 40.0]);
    let crit_range = arr(vec![1.0, 2.0, 3.0, 4.0]);
    assert_eq!(f.call(&[min_range, crit_range, text(">2")]), num(30.0));
}

#[test]
fn test_countif_error_criteria_counts_matching_errors() {
    let f = FnCountIf;
    // COUNTIF({#N/A, 2, #N/A}, #N/A) -> 2 (not #N/A!)
    let range = CellValue::from_rows(vec![vec![err(CellError::Na), num(2.0), err(CellError::Na)]]);
    assert_eq!(f.call(&[range, err(CellError::Na)]), num(2.0));
}

#[test]
fn test_countif_error_criteria_no_matches() {
    let f = FnCountIf;
    // COUNTIF({1, 2, 3}, #N/A) -> 0 (no #N/A cells)
    let range = arr(vec![1.0, 2.0, 3.0]);
    assert_eq!(f.call(&[range, err(CellError::Na)]), num(0.0));
}

#[test]
fn test_sumif_error_criteria() {
    let f = FnSumIf;
    // SUMIF({1, 2, 3}, #N/A) -> 0 (no matches)
    let range = arr(vec![1.0, 2.0, 3.0]);
    assert_eq!(f.call(&[range, err(CellError::Na)]), num(0.0));
}

#[test]
fn test_sumif_range_error_propagates() {
    let f = FnSumIf;
    // SUMIF(#REF!, ">1") -> #REF! (range error propagates)
    assert_eq!(
        f.call(&[err(CellError::Ref), text(">1")]),
        err(CellError::Ref)
    );
}

#[test]
fn test_sumifs_error_criteria_sums_matching() {
    let f = FnSumIfs;
    // SUMIFS({10, 20, 30}, {#N/A, "x", #N/A}, #N/A) -> 40 (rows 0 and 2 match)
    let sum_range = arr(vec![10.0, 20.0, 30.0]);
    let crit_range = CellValue::from_rows(vec![vec![
        err(CellError::Na),
        text("x"),
        err(CellError::Na),
    ]]);
    assert_eq!(
        f.call(&[sum_range, crit_range, err(CellError::Na)]),
        num(40.0)
    );
}

#[test]
fn test_countifs_error_criteria() {
    let f = FnCountIfs;
    // COUNTIFS({#N/A, 2, #N/A}, #N/A) -> 2
    let range = CellValue::from_rows(vec![vec![err(CellError::Na), num(2.0), err(CellError::Na)]]);
    assert_eq!(f.call(&[range, err(CellError::Na)]), num(2.0));
}

#[test]
fn test_countif_range_error_propagates() {
    let f = FnCountIf;
    // COUNTIF(#REF!, ">1") -> #REF! (range error propagates through defense-in-depth)
    assert_eq!(
        f.call(&[err(CellError::Ref), text(">1")]),
        err(CellError::Ref)
    );
}

#[test]
fn test_countif_error_criteria_does_not_count_null() {
    let f = FnCountIf;
    // Range: [#N/A, #N/A, Null, #N/A]
    // Criteria: #N/A
    // Expected: 3 (Null is NOT #N/A)
    let range = CellValue::from_rows(vec![vec![
        err(CellError::Na),
        err(CellError::Na),
        CellValue::Null,
        err(CellError::Na),
    ]]);
    assert_eq!(
        f.call(&[range, err(CellError::Na)]),
        num(3.0),
        "COUNTIF(#N/A) must not count Null cells"
    );
}

#[test]
fn test_countif_off_by_one_single_null_among_errors() {
    let f = FnCountIf;
    // Simulates Bug #2 pattern: 10 cells that should all be #N/A,
    // but the first one is Null (ghost cell from missing shared formula master).
    // COUNTIF returns 9 instead of 10 — the off-by-one.
    let mut values: Vec<CellValue> = vec![err(CellError::Na); 10];
    values[0] = CellValue::Null; // First formula cell: missing master → ghost → Null

    let range = CellValue::from_rows(vec![values]);
    assert_eq!(
        f.call(&[range, err(CellError::Na)]),
        num(9.0),
        "Off-by-one: 10 cells, 1 Null among 9 #N/A → COUNTIF returns 9"
    );
}

#[test]
fn test_countif_null_criteria_counts_only_nulls() {
    let f = FnCountIf;
    // Converse: if criteria is Null (empty cell), only Null cells match.
    let range = CellValue::from_rows(vec![vec![
        err(CellError::Na),
        CellValue::Null,
        err(CellError::Na),
        CellValue::Null,
    ]]);
    assert_eq!(
        f.call(&[range, CellValue::Null]),
        num(2.0),
        "COUNTIF(Null) should match only Null cells, not errors"
    );
}

#[test]
fn test_countif_different_error_types_not_confused() {
    let f = FnCountIf;
    // If one cell is #REF! among #N/A values, #N/A criteria should not count it.
    let range = CellValue::from_rows(vec![vec![
        err(CellError::Na),
        err(CellError::Ref),
        err(CellError::Na),
        err(CellError::Na),
    ]]);
    assert_eq!(
        f.call(&[range, err(CellError::Na)]),
        num(3.0),
        "COUNTIF(#N/A) must not count #REF! cells"
    );
}

#[test]
fn test_countifs_off_by_one_null_among_errors() {
    let f = FnCountIfs;
    // Same pattern as COUNTIF but using COUNTIFS (variadic).
    let mut values: Vec<CellValue> = vec![err(CellError::Na); 10];
    values[0] = CellValue::Null;

    let range = CellValue::from_rows(vec![values]);
    assert_eq!(
        f.call(&[range, err(CellError::Na)]),
        num(9.0),
        "COUNTIFS off-by-one: 1 Null among 9 #N/A → returns 9"
    );
}

#[test]
fn test_sumif_off_by_one_null_among_errors() {
    let f = FnSumIf;
    // SUMIF with error criteria + sum_range: Null in criteria range
    // causes one row to not match → sum is short.
    let criteria_range = CellValue::from_rows(vec![vec![
        err(CellError::Na),
        CellValue::Null,
        err(CellError::Na),
    ]]);
    let sum_range = CellValue::from_rows(vec![vec![num(10.0), num(20.0), num(30.0)]]);
    assert_eq!(
        f.call(&[criteria_range, err(CellError::Na), sum_range]),
        num(40.0),
        "SUMIF: Null in criteria range → row 1 not matched → sum is 10+30=40"
    );
}

#[test]
fn test_countif_array_criteria_column() {
    // COUNTIF(range, column_array_criteria)
    // range = [Acme, Acme, Beta, Gamma] (column)
    // criteria = same range (column) → element-wise counts
    let range = col_arr(vec![
        text("Acme"),
        text("Acme"),
        text("Beta"),
        text("Gamma"),
    ]);
    let criteria = range.clone();
    let result = FnCountIf.call(&[range, criteria]);
    // Acme=2, Acme=2, Beta=1, Gamma=1 → column array
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 4);
            assert_eq!(a.row(0), [num(2.0)]);
            assert_eq!(a.row(1), [num(2.0)]);
            assert_eq!(a.row(2), [num(1.0)]);
            assert_eq!(a.row(3), [num(1.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_countif_array_criteria_row() {
    // COUNTIF(range, {"Acme","Beta","Gamma"}) — inline row array
    let range = col_arr(vec![
        text("Acme"),
        text("Acme"),
        text("Beta"),
        text("Gamma"),
    ]);
    let criteria = row_arr(vec![text("Acme"), text("Beta"), text("Gamma")]);
    let result = FnCountIf.call(&[range, criteria]);
    // {2, 1, 1} → 1x3 row array
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(2.0), num(1.0), num(1.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_countif_scalar_criteria_unchanged() {
    // Scalar criteria should still return a scalar.
    let range = col_arr(vec![text("Acme"), text("Acme"), text("Beta")]);
    let result = FnCountIf.call(&[range, text("Acme")]);
    assert_eq!(result, num(2.0));
}

#[test]
fn test_countif_single_element_array_is_scalar() {
    // A 1x1 array criteria (e.g. structured ref) should behave as scalar.
    let range = col_arr(vec![text("Acme"), text("Acme"), text("Beta")]);
    let criteria = CellValue::from_rows(vec![vec![text("Acme")]]);
    let result = FnCountIf.call(&[range, criteria]);
    assert_eq!(result, num(2.0)); // scalar, not array
}

#[test]
fn test_countifs_array_criteria_one_array_one_scalar() {
    // COUNTIFS(name_range, name_array, dept_range, "Enterprise")
    // Names: Acme, Acme, Beta, Beta, Gamma
    // Depts: Enterprise, Enterprise, Consumer, Enterprise, Enterprise
    // Criteria: name_array = same as name_range (5x1), dept = scalar "Enterprise"
    let name_range = col_arr(vec![
        text("Acme"),
        text("Acme"),
        text("Beta"),
        text("Beta"),
        text("Gamma"),
    ]);
    let name_criteria = name_range.clone();
    let dept_range = col_arr(vec![
        text("Enterprise"),
        text("Enterprise"),
        text("Consumer"),
        text("Enterprise"),
        text("Enterprise"),
    ]);
    let dept_criteria = text("Enterprise");
    let result = FnCountIfs.call(&[name_range, name_criteria, dept_range, dept_criteria]);
    // Acme+Enterprise: 2, Acme+Enterprise: 2, Beta+Enterprise: 1,
    // Beta+Enterprise: 1, Gamma+Enterprise: 1
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 5);
            assert_eq!(a.row(0), [num(2.0)]);
            assert_eq!(a.row(1), [num(2.0)]);
            assert_eq!(a.row(2), [num(1.0)]);
            assert_eq!(a.row(3), [num(1.0)]);
            assert_eq!(a.row(4), [num(1.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_countifs_inline_array_criteria() {
    // COUNTIFS(range, "x", range2, {"a","b","c"})
    let range1 = col_arr(vec![text("x"), text("x"), text("y"), text("x")]);
    let range2 = col_arr(vec![text("a"), text("b"), text("c"), text("a")]);
    let criteria2 = row_arr(vec![text("a"), text("b"), text("c")]);
    let result = FnCountIfs.call(&[range1, text("x"), range2, criteria2]);
    // "x"+"a":2, "x"+"b":1, "x"+"c":0  → {2, 1, 0}
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(2.0), num(1.0), num(0.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_countifs_scalar_criteria_unchanged() {
    // All scalar criteria → scalar result (unchanged behavior).
    let range1 = col_arr(vec![num(1.0), num(2.0), num(3.0), num(4.0)]);
    let range2 = col_arr(vec![num(10.0), num(20.0), num(30.0), num(40.0)]);
    assert_eq!(
        FnCountIfs.call(&[range1, text(">1"), range2, text(">15")]),
        num(3.0)
    );
}

#[test]
fn test_sumif_array_criteria() {
    // SUMIF(range, criteria_array, sum_range)
    let range = col_arr(vec![text("A"), text("A"), text("B"), text("C")]);
    let criteria = row_arr(vec![text("A"), text("B"), text("C")]);
    let sum_range = col_arr(vec![num(10.0), num(20.0), num(30.0), num(40.0)]);
    let result = FnSumIf.call(&[range, criteria, sum_range]);
    // A=30, B=30, C=40 → {30, 30, 40}
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(30.0), num(30.0), num(40.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_sumifs_array_criteria() {
    // SUMIFS(sum_range, range, array_criteria)
    let sum_range = col_arr(vec![num(10.0), num(20.0), num(30.0), num(40.0)]);
    let range = col_arr(vec![text("A"), text("A"), text("B"), text("C")]);
    let criteria = row_arr(vec![text("A"), text("B"), text("C")]);
    let result = FnSumIfs.call(&[sum_range, range, criteria]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(30.0), num(30.0), num(40.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_averageif_array_criteria() {
    let range = col_arr(vec![text("A"), text("A"), text("B")]);
    let criteria = row_arr(vec![text("A"), text("B")]);
    let avg_range = col_arr(vec![num(10.0), num(20.0), num(30.0)]);
    let result = FnAverageIf.call(&[range, criteria, avg_range]);
    // A avg = 15, B avg = 30 → {15, 30}
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(15.0), num(30.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_averageifs_array_criteria() {
    let avg_range = col_arr(vec![num(10.0), num(20.0), num(30.0)]);
    let range = col_arr(vec![text("A"), text("A"), text("B")]);
    let criteria = row_arr(vec![text("A"), text("B")]);
    let result = FnAverageIfs.call(&[avg_range, range, criteria]);
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(15.0), num(30.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_maxifs_array_criteria() {
    let max_range = col_arr(vec![num(10.0), num(20.0), num(30.0), num(5.0)]);
    let range = col_arr(vec![text("A"), text("A"), text("B"), text("B")]);
    let criteria = row_arr(vec![text("A"), text("B")]);
    let result = FnMaxIfs.call(&[max_range, range, criteria]);
    // max(A) = 20, max(B) = 30 → {20, 30}
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(20.0), num(30.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}

#[test]
fn test_minifs_array_criteria() {
    let min_range = col_arr(vec![num(10.0), num(20.0), num(30.0), num(5.0)]);
    let range = col_arr(vec![text("A"), text("A"), text("B"), text("B")]);
    let criteria = row_arr(vec![text("A"), text("B")]);
    let result = FnMinIfs.call(&[min_range, range, criteria]);
    // min(A) = 10, min(B) = 5 → {10, 5}
    match &result {
        CellValue::Array(a) => {
            assert_eq!(a.rows(), 1);
            assert_eq!(a.row(0), [num(10.0), num(5.0)]);
        }
        _ => panic!("Expected array, got {:?}", result),
    }
}
