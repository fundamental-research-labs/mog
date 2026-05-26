use super::super::ranking::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

#[test]
fn test_large() {
    let f = FnLarge;
    let range = arr(vec![3.0, 1.0, 5.0, 2.0, 4.0]);
    assert_eq!(f.call(&[range.clone(), num(1.0)]), num(5.0));
    assert_eq!(f.call(&[range.clone(), num(3.0)]), num(3.0));
    assert_eq!(f.call(&[range, num(6.0)]), err(CellError::Num));
}

#[test]
fn test_small() {
    let f = FnSmall;
    let range = arr(vec![3.0, 1.0, 5.0, 2.0, 4.0]);
    assert_eq!(f.call(&[range.clone(), num(1.0)]), num(1.0));
    assert_eq!(f.call(&[range, num(3.0)]), num(3.0));
}

#[test]
fn test_rank_descending() {
    let f = FnRank;
    let range = arr(vec![3.0, 1.0, 5.0, 2.0, 4.0]);
    assert_eq!(f.call(&[num(5.0), range.clone()]), num(1.0));
    assert_eq!(f.call(&[num(1.0), range.clone()]), num(5.0));
    assert_eq!(f.call(&[num(3.0), range]), num(3.0));
}

#[test]
fn test_rank_ascending() {
    let f = FnRank;
    let range = arr(vec![3.0, 1.0, 5.0, 2.0, 4.0]);
    assert_eq!(f.call(&[num(1.0), range.clone(), num(1.0)]), num(1.0));
    assert_eq!(f.call(&[num(5.0), range, num(1.0)]), num(5.0));
}

#[test]
fn test_rank_not_found() {
    let f = FnRank;
    let range = arr(vec![1.0, 2.0, 3.0]);
    assert_eq!(f.call(&[num(5.0), range]), err(CellError::Na));
}

#[test]
fn test_rank_avg() {
    let f = FnRankAvg;
    // {3, 3, 1, 5}: rank.avg of 3 descending = (2+3)/2 = 2.5
    let range = arr(vec![3.0, 3.0, 1.0, 5.0]);
    let result = f.call(&[num(3.0), range]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 2.5).abs() < 0.01, "rank.avg was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_small_range_1_to_n_produces_sorted_output() {
    // SMALL(range, 1) through SMALL(range, N) should produce the sorted array
    let f = FnSmall;
    let range = arr(vec![9.0, 3.0, 7.0, 1.0, 5.0, 8.0, 2.0, 6.0, 4.0, 10.0]);
    let mut results = Vec::new();
    for k in 1..=10 {
        match f.call(&[range.clone(), num(k as f64)]) {
            CellValue::Number(n) => results.push(n.get()),
            other => panic!("SMALL(range, {}) returned {:?}", k, other),
        }
    }
    assert_eq!(
        results,
        vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    );
}

#[test]
fn test_large_range_1_to_n_produces_reverse_sorted_output() {
    // LARGE(range, 1) through LARGE(range, N) should produce reverse-sorted array
    let f = FnLarge;
    let range = arr(vec![9.0, 3.0, 7.0, 1.0, 5.0, 8.0, 2.0, 6.0, 4.0, 10.0]);
    let mut results = Vec::new();
    for k in 1..=10 {
        match f.call(&[range.clone(), num(k as f64)]) {
            CellValue::Number(n) => results.push(n.get()),
            other => panic!("LARGE(range, {}) returned {:?}", k, other),
        }
    }
    assert_eq!(
        results,
        vec![10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0]
    );
}

#[test]
fn test_small_with_duplicates() {
    let f = FnSmall;
    let range = arr(vec![3.0, 1.0, 3.0, 1.0, 2.0]);
    assert_eq!(f.call(&[range.clone(), num(1.0)]), num(1.0));
    assert_eq!(f.call(&[range.clone(), num(2.0)]), num(1.0));
    assert_eq!(f.call(&[range.clone(), num(3.0)]), num(2.0));
    assert_eq!(f.call(&[range.clone(), num(4.0)]), num(3.0));
    assert_eq!(f.call(&[range, num(5.0)]), num(3.0));
}

#[test]
fn test_rank_with_sorted_cache() {
    // Verify RANK works correctly with the cache-backed binary search
    let f = FnRank;
    let range = arr(vec![7.0, 3.5, 3.5, 1.0, 7.0]);
    // Descending: 7.0 → rank 1 (tied), 3.5 → rank 3 (tied), 1.0 → rank 5
    assert_eq!(f.call(&[num(7.0), range.clone()]), num(1.0));
    assert_eq!(f.call(&[num(3.5), range.clone()]), num(3.0));
    assert_eq!(f.call(&[num(1.0), range.clone()]), num(5.0));
    // Ascending: 1.0 → rank 1, 3.5 → rank 2, 7.0 → rank 4
    assert_eq!(f.call(&[num(1.0), range.clone(), num(1.0)]), num(1.0));
    assert_eq!(f.call(&[num(3.5), range.clone(), num(1.0)]), num(2.0));
    assert_eq!(f.call(&[num(7.0), range, num(1.0)]), num(4.0));
}

#[test]
fn test_rank_avg_with_sorted_cache() {
    // Verify RANK.AVG gives averaged rank for ties
    let f = FnRankAvg;
    let range = arr(vec![7.0, 3.5, 3.5, 1.0, 7.0]);
    // Descending: 7.0 occupies ranks 1,2 → avg 1.5; 3.5 occupies ranks 3,4 → avg 3.5
    let r = f.call(&[num(7.0), range.clone()]);
    if let CellValue::Number(n) = r {
        assert!(
            (n.get() - 1.5).abs() < 0.01,
            "RANK.AVG(7) desc was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", r);
    }
    let r = f.call(&[num(3.5), range.clone()]);
    if let CellValue::Number(n) = r {
        assert!(
            (n.get() - 3.5).abs() < 0.01,
            "RANK.AVG(3.5) desc was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", r);
    }
}

#[test]
fn test_rank_eq_descending_basic() {
    // data = {7,3,5,1,9}; RANK.EQ(7, data) = 2 (9 is rank 1, 7 is rank 2)
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![7.0, 3.0, 5.0, 1.0, 9.0]);
    assert_eq!(reg.call("RANK.EQ", &[num(7.0), data.clone()]), num(2.0));
    assert_eq!(reg.call("RANK.EQ", &[num(9.0), data.clone()]), num(1.0));
    assert_eq!(reg.call("RANK.EQ", &[num(1.0), data.clone()]), num(5.0));
    assert_eq!(reg.call("RANK.EQ", &[num(3.0), data.clone()]), num(4.0));
    assert_eq!(reg.call("RANK.EQ", &[num(5.0), data]), num(3.0));
}

#[test]
fn test_rank_eq_ascending_basic() {
    // data = {7,3,5,1,9}; ascending: 1=rank1, 3=rank2, 5=rank3, 7=rank4, 9=rank5
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![7.0, 3.0, 5.0, 1.0, 9.0]);
    assert_eq!(
        reg.call("RANK.EQ", &[num(1.0), data.clone(), num(1.0)]),
        num(1.0)
    );
    assert_eq!(
        reg.call("RANK.EQ", &[num(3.0), data.clone(), num(1.0)]),
        num(2.0)
    );
    assert_eq!(
        reg.call("RANK.EQ", &[num(7.0), data.clone(), num(1.0)]),
        num(4.0)
    );
    assert_eq!(reg.call("RANK.EQ", &[num(9.0), data, num(1.0)]), num(5.0));
}

#[test]
fn test_rank_eq_ties_descending() {
    // All three 5s get rank 1 (descending) in {5,5,5,1,3}
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![5.0, 5.0, 5.0, 1.0, 3.0]);
    assert_eq!(reg.call("RANK.EQ", &[num(5.0), data.clone()]), num(1.0));
    assert_eq!(reg.call("RANK.EQ", &[num(3.0), data.clone()]), num(4.0));
    assert_eq!(reg.call("RANK.EQ", &[num(1.0), data]), num(5.0));
}

#[test]
fn test_rank_eq_value_not_found() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_eq!(reg.call("RANK.EQ", &[num(99.0), data]), err(CellError::Na));
}

#[test]
fn test_rank_eq_is_alias_for_rank() {
    // RANK and RANK.EQ should give identical results
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![10.0, 20.0, 30.0]);
    assert_eq!(
        reg.call("RANK", &[num(20.0), data.clone()]),
        reg.call("RANK.EQ", &[num(20.0), data])
    );
}

#[test]
fn test_rank_avg_ties_descending() {
    // {5,5,5,1,3}: 5s occupy ranks 1,2,3 -> avg = 2.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![5.0, 5.0, 5.0, 1.0, 3.0]);
    let result = reg.call("RANK.AVG", &[num(5.0), data]);
    if let CellValue::Number(n) = result {
        assert!((n.get() - 2.0).abs() < 1e-10, "RANK.AVG was {}", n.get());
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_rank_avg_ties_ascending() {
    // {5,5,5,1,3} ascending: 1=rank1, 3=rank2, 5,5,5 occupy ranks 3,4,5 -> avg=4.0
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![5.0, 5.0, 5.0, 1.0, 3.0]);
    let result = reg.call("RANK.AVG", &[num(5.0), data, num(1.0)]);
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - 4.0).abs() < 1e-10,
            "RANK.AVG ascending was {}",
            n.get()
        );
    } else {
        panic!("Expected number, got {:?}", result);
    }
}

#[test]
fn test_rank_avg_no_ties_equals_rank_eq() {
    // Without ties, RANK.AVG = RANK.EQ
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    for v in [1.0, 2.0, 3.0, 4.0, 5.0] {
        assert_eq!(
            reg.call("RANK.AVG", &[num(v), data.clone()]),
            reg.call("RANK.EQ", &[num(v), data.clone()]),
            "RANK.AVG should equal RANK.EQ for {} with no ties",
            v
        );
    }
}

#[test]
fn test_rank_avg_value_not_found() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_eq!(reg.call("RANK.AVG", &[num(99.0), data]), err(CellError::Na));
}

#[test]
fn test_large_kth_largest() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_eq!(reg.call("LARGE", &[data.clone(), num(1.0)]), num(5.0));
    assert_eq!(reg.call("LARGE", &[data.clone(), num(5.0)]), num(1.0));
    assert_eq!(reg.call("LARGE", &[data, num(3.0)]), num(3.0));
}

#[test]
fn test_large_k_exceeds_n() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("LARGE", &[arr(vec![1.0, 2.0, 3.0]), num(4.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_large_k_zero() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("LARGE", &[arr(vec![1.0, 2.0]), num(0.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_large_k_negative() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("LARGE", &[arr(vec![1.0, 2.0]), num(-1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_large_with_duplicates() {
    // {3,3,1} -> sorted: [1,3,3]; LARGE(_, 1)=3, LARGE(_, 2)=3, LARGE(_, 3)=1
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![3.0, 3.0, 1.0]);
    assert_eq!(reg.call("LARGE", &[data.clone(), num(1.0)]), num(3.0));
    assert_eq!(reg.call("LARGE", &[data.clone(), num(2.0)]), num(3.0));
    assert_eq!(reg.call("LARGE", &[data, num(3.0)]), num(1.0));
}

#[test]
fn test_small_kth_smallest() {
    let reg = crate::FunctionRegistry::new();
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_eq!(reg.call("SMALL", &[data.clone(), num(1.0)]), num(1.0));
    assert_eq!(reg.call("SMALL", &[data.clone(), num(5.0)]), num(5.0));
    assert_eq!(reg.call("SMALL", &[data, num(3.0)]), num(3.0));
}

#[test]
fn test_small_k_exceeds_n() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("SMALL", &[arr(vec![1.0, 2.0, 3.0]), num(4.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_small_k_zero() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("SMALL", &[arr(vec![1.0, 2.0]), num(0.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_small_k_negative() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(
        reg.call("SMALL", &[arr(vec![1.0, 2.0]), num(-1.0)]),
        err(CellError::Num)
    );
}

#[test]
fn test_small_single_element() {
    let reg = crate::FunctionRegistry::new();
    assert_eq!(reg.call("SMALL", &[arr(vec![42.0]), num(1.0)]), num(42.0));
}
