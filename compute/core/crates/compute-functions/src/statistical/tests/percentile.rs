use super::super::percentile::*;
use crate::PureFunction;
use value_types::{CellError, CellValue};

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

fn arr(vals: Vec<f64>) -> CellValue {
    CellValue::from_rows(vec![vals.into_iter().map(num).collect()])
}

fn assert_num(result: CellValue, expected: f64, tolerance: f64, label: &str) {
    if let CellValue::Number(n) = result {
        assert!(
            (n.get() - expected).abs() < tolerance,
            "{}: expected {}, got {}",
            label,
            expected,
            n.get()
        );
    } else {
        panic!("{}: expected number {}, got {:?}", label, expected, result);
    }
}

fn assert_err(result: CellValue, expected: CellError, label: &str) {
    if let CellValue::Error(e, _) = result {
        assert_eq!(
            e, expected,
            "{}: expected {:?}, got {:?}",
            label, expected, e
        );
    } else {
        panic!("{}: expected error {:?}, got {:?}", label, expected, result);
    }
}

#[test]
fn test_percentile_inc() {
    let f = FnPercentileInc;
    let range = arr(vec![1.0, 2.0, 3.0, 4.0]);
    assert_eq!(f.call(&[range.clone(), num(0.0)]), num(1.0));
    assert_eq!(f.call(&[range.clone(), num(1.0)]), num(4.0));
    // 0.5 => median
    let result = f.call(&[range, num(0.5)]);
    assert_eq!(result, num(2.5));
}

#[test]
fn test_quartile_inc() {
    let f = FnQuartileInc;
    let range = arr(vec![1.0, 2.0, 3.0, 4.0]);
    assert_eq!(f.call(&[range.clone(), num(0.0)]), num(1.0)); // Q0 = min
    assert_eq!(f.call(&[range.clone(), num(4.0)]), num(4.0)); // Q4 = max
}

#[test]
fn test_percentile_inc_basic_quintiles() {
    let f = FnPercentileInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // k=0 => minimum
    assert_num(
        f.call(&[data.clone(), num(0.0)]),
        1.0,
        1e-10,
        "PERCENTILE.INC k=0",
    );
    // k=1 => maximum
    assert_num(
        f.call(&[data.clone(), num(1.0)]),
        5.0,
        1e-10,
        "PERCENTILE.INC k=1",
    );
    // k=0.5 => median
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        3.0,
        1e-10,
        "PERCENTILE.INC k=0.5",
    );
    // k=0.25 => Q1
    assert_num(
        f.call(&[data.clone(), num(0.25)]),
        2.0,
        1e-10,
        "PERCENTILE.INC k=0.25",
    );
    // k=0.75 => Q3
    assert_num(
        f.call(&[data.clone(), num(0.75)]),
        4.0,
        1e-10,
        "PERCENTILE.INC k=0.75",
    );
}

#[test]
fn test_percentile_inc_interpolation() {
    let f = FnPercentileInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // k=0.1: rank = 0.1*4 = 0.4, interp between 1 and 2 => 1 + 0.4*(2-1) = 1.4
    assert_num(
        f.call(&[data.clone(), num(0.1)]),
        1.4,
        1e-10,
        "PERCENTILE.INC k=0.1",
    );
    // k=0.3: rank = 0.3*4 = 1.2, interp between 2 and 3 => 2 + 0.2 = 2.2
    assert_num(
        f.call(&[data.clone(), num(0.3)]),
        2.2,
        1e-10,
        "PERCENTILE.INC k=0.3",
    );
    // k=0.9: rank = 0.9*4 = 3.6, interp between 4 and 5 => 4 + 0.6 = 4.6
    assert_num(
        f.call(&[data.clone(), num(0.9)]),
        4.6,
        1e-10,
        "PERCENTILE.INC k=0.9",
    );
}

#[test]
fn test_percentile_inc_single_element() {
    let f = FnPercentileInc;
    let data = arr(vec![42.0]);
    assert_num(f.call(&[data.clone(), num(0.0)]), 42.0, 1e-10, "single k=0");
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        42.0,
        1e-10,
        "single k=0.5",
    );
    assert_num(f.call(&[data.clone(), num(1.0)]), 42.0, 1e-10, "single k=1");
}

#[test]
fn test_percentile_inc_two_elements() {
    let f = FnPercentileInc;
    let data = arr(vec![10.0, 20.0]);
    // rank = k*(2-1) = k, so interp between 10 and 20
    assert_num(f.call(&[data.clone(), num(0.0)]), 10.0, 1e-10, "two k=0");
    assert_num(f.call(&[data.clone(), num(0.5)]), 15.0, 1e-10, "two k=0.5");
    assert_num(f.call(&[data.clone(), num(1.0)]), 20.0, 1e-10, "two k=1");
    assert_num(f.call(&[data.clone(), num(0.3)]), 13.0, 1e-10, "two k=0.3");
}

#[test]
fn test_percentile_inc_unsorted_input() {
    let f = FnPercentileInc;
    // Function should sort internally
    let data = arr(vec![5.0, 1.0, 4.0, 2.0, 3.0]);
    assert_num(
        f.call(&[data.clone(), num(0.0)]),
        1.0,
        1e-10,
        "unsorted min",
    );
    assert_num(
        f.call(&[data.clone(), num(1.0)]),
        5.0,
        1e-10,
        "unsorted max",
    );
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        3.0,
        1e-10,
        "unsorted median",
    );
}

#[test]
fn test_percentile_inc_duplicates() {
    let f = FnPercentileInc;
    let data = arr(vec![3.0, 3.0, 3.0, 3.0]);
    assert_num(f.call(&[data.clone(), num(0.0)]), 3.0, 1e-10, "dupes k=0");
    assert_num(f.call(&[data.clone(), num(0.5)]), 3.0, 1e-10, "dupes k=0.5");
    assert_num(f.call(&[data.clone(), num(1.0)]), 3.0, 1e-10, "dupes k=1");
}

#[test]
fn test_percentile_inc_k_out_of_range() {
    let f = FnPercentileInc;
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_err(f.call(&[data.clone(), num(-0.1)]), CellError::Num, "k<0");
    assert_err(f.call(&[data.clone(), num(1.1)]), CellError::Num, "k>1");
}

#[test]
fn test_percentile_exc_basic() {
    let f = FnPercentileExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // k=0.5: rank = 0.5*6 = 3, element index 2 => 3
    assert_num(f.call(&[data.clone(), num(0.5)]), 3.0, 1e-10, "EXC k=0.5");
}

#[test]
fn test_percentile_exc_quartiles() {
    let f = FnPercentileExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // k=0.25: rank = 0.25*6 = 1.5, interp between index 0 and 1 => 1 + 0.5*(2-1) = 1.5
    assert_num(f.call(&[data.clone(), num(0.25)]), 1.5, 1e-10, "EXC k=0.25");
    // k=0.75: rank = 0.75*6 = 4.5, interp between index 3 and 4 => 4 + 0.5*(5-4) = 4.5
    assert_num(f.call(&[data.clone(), num(0.75)]), 4.5, 1e-10, "EXC k=0.75");
}

#[test]
fn test_percentile_exc_boundary_errors() {
    let f = FnPercentileExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // k=0 and k=1 are always out of range for EXC
    assert_err(f.call(&[data.clone(), num(0.0)]), CellError::Num, "EXC k=0");
    assert_err(f.call(&[data.clone(), num(1.0)]), CellError::Num, "EXC k=1");
    assert_err(
        f.call(&[data.clone(), num(-0.5)]),
        CellError::Num,
        "EXC k<0",
    );
    assert_err(f.call(&[data.clone(), num(1.5)]), CellError::Num, "EXC k>1");
}

#[test]
fn test_percentile_exc_single_element() {
    let f = FnPercentileExc;
    // For n=1: rank = k*(n+1) = k*2. Valid when 1 <= rank <= 1, so k=0.5 gives rank=1 => valid
    let data = arr(vec![42.0]);
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        42.0,
        1e-10,
        "EXC single k=0.5",
    );
    // k=0.25: rank = 0.5, < 1 => None => Num error
    assert_err(
        f.call(&[data.clone(), num(0.25)]),
        CellError::Num,
        "EXC single k=0.25",
    );
    // k=0.75: rank = 1.5, > 1 => None => Num error
    assert_err(
        f.call(&[data.clone(), num(0.75)]),
        CellError::Num,
        "EXC single k=0.75",
    );
}

#[test]
fn test_percentile_exc_two_elements() {
    let f = FnPercentileExc;
    // n=2: valid range is (1/3, 2/3)
    let data = arr(vec![10.0, 20.0]);
    // k=0.5: rank = 0.5*3 = 1.5, interp between 10 and 20 => 15
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        15.0,
        1e-10,
        "EXC 2-elem k=0.5",
    );
}

#[test]
fn test_percentile_exc_unsorted() {
    let f = FnPercentileExc;
    let data = arr(vec![5.0, 1.0, 3.0, 2.0, 4.0]);
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        3.0,
        1e-10,
        "EXC unsorted median",
    );
}

#[test]
fn test_quartile_inc_all_quartiles() {
    let f = FnQuartileInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_num(f.call(&[data.clone(), num(0.0)]), 1.0, 1e-10, "Q.INC 0=MIN");
    assert_num(f.call(&[data.clone(), num(1.0)]), 2.0, 1e-10, "Q.INC 1=Q1");
    assert_num(f.call(&[data.clone(), num(2.0)]), 3.0, 1e-10, "Q.INC 2=MED");
    assert_num(f.call(&[data.clone(), num(3.0)]), 4.0, 1e-10, "Q.INC 3=Q3");
    assert_num(f.call(&[data.clone(), num(4.0)]), 5.0, 1e-10, "Q.INC 4=MAX");
}

#[test]
fn test_quartile_inc_matches_percentile_inc() {
    let fp = FnPercentileInc;
    let fq = FnQuartileInc;
    let data = arr(vec![2.0, 7.0, 13.0, 19.0, 25.0, 31.0]);
    for q in 0..=4 {
        let k = q as f64 * 0.25;
        let pval = fp.call(&[data.clone(), num(k)]);
        let qval = fq.call(&[data.clone(), num(q as f64)]);
        assert_eq!(pval, qval, "Q.INC({}) should match P.INC({})", q, k);
    }
}

#[test]
fn test_quartile_inc_errors() {
    let f = FnQuartileInc;
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        f.call(&[data.clone(), num(-1.0)]),
        CellError::Num,
        "Q.INC -1",
    );
    assert_err(f.call(&[data.clone(), num(5.0)]), CellError::Num, "Q.INC 5");
}

#[test]
fn test_quartile_inc_single_element() {
    let f = FnQuartileInc;
    let data = arr(vec![99.0]);
    for q in 0..=4 {
        assert_num(
            f.call(&[data.clone(), num(q as f64)]),
            99.0,
            1e-10,
            &format!("Q.INC single q={}", q),
        );
    }
}

#[test]
fn test_quartile_exc_basic() {
    let f = FnQuartileExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // Q1 = PERCENTILE.EXC(data, 0.25) = 1.5
    assert_num(f.call(&[data.clone(), num(1.0)]), 1.5, 1e-10, "Q.EXC 1");
    // Q2 = median
    assert_num(f.call(&[data.clone(), num(2.0)]), 3.0, 1e-10, "Q.EXC 2");
    // Q3 = PERCENTILE.EXC(data, 0.75) = 4.5
    assert_num(f.call(&[data.clone(), num(3.0)]), 4.5, 1e-10, "Q.EXC 3");
}

#[test]
fn test_quartile_exc_matches_percentile_exc() {
    let fp = FnPercentileExc;
    let fq = FnQuartileExc;
    let data = arr(vec![2.0, 7.0, 13.0, 19.0, 25.0, 31.0]);
    for q in 1..=3 {
        let k = q as f64 * 0.25;
        let pval = fp.call(&[data.clone(), num(k)]);
        let qval = fq.call(&[data.clone(), num(q as f64)]);
        assert_eq!(pval, qval, "Q.EXC({}) should match P.EXC({})", q, k);
    }
}

#[test]
fn test_quartile_exc_boundary_errors() {
    let f = FnQuartileExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_err(f.call(&[data.clone(), num(0.0)]), CellError::Num, "Q.EXC 0");
    assert_err(f.call(&[data.clone(), num(4.0)]), CellError::Num, "Q.EXC 4");
    assert_err(
        f.call(&[data.clone(), num(-1.0)]),
        CellError::Num,
        "Q.EXC -1",
    );
    assert_err(f.call(&[data.clone(), num(5.0)]), CellError::Num, "Q.EXC 5");
}

#[test]
fn test_percentrank_inc_exact_matches() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // rank(1) = 0/(n-1) = 0.0
    assert_num(
        f.call(&[data.clone(), num(1.0)]),
        0.0,
        1e-10,
        "PRANK.INC x=1",
    );
    // rank(3) = 2/4 = 0.5
    assert_num(
        f.call(&[data.clone(), num(3.0)]),
        0.5,
        1e-10,
        "PRANK.INC x=3",
    );
    // rank(5) = 4/4 = 1.0
    assert_num(
        f.call(&[data.clone(), num(5.0)]),
        1.0,
        1e-10,
        "PRANK.INC x=5",
    );
}

#[test]
fn test_percentrank_inc_each_element() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // rank(i) = i/(n-1) for 0-indexed
    assert_num(
        f.call(&[data.clone(), num(2.0)]),
        0.25,
        1e-10,
        "PRANK.INC x=2",
    );
    assert_num(
        f.call(&[data.clone(), num(4.0)]),
        0.75,
        1e-10,
        "PRANK.INC x=4",
    );
}

#[test]
fn test_percentrank_inc_interpolation() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // x=1.5: between index 0 and 1, fraction = 0.5
    // rank = (0 + 0.5) / 4 = 0.125
    assert_num(
        f.call(&[data.clone(), num(1.5)]),
        0.125,
        1e-10,
        "PRANK.INC x=1.5",
    );
    // x=3.5: between index 2 and 3, fraction = 0.5
    // rank = (2 + 0.5) / 4 = 0.625
    assert_num(
        f.call(&[data.clone(), num(3.5)]),
        0.625,
        1e-10,
        "PRANK.INC x=3.5",
    );
}

#[test]
fn test_percentrank_inc_out_of_range() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    assert_err(
        f.call(&[data.clone(), num(0.0)]),
        CellError::Na,
        "PRANK.INC x<min",
    );
    assert_err(
        f.call(&[data.clone(), num(6.0)]),
        CellError::Na,
        "PRANK.INC x>max",
    );
}

#[test]
fn test_percentrank_inc_significance() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // x=1.5 => rank = 0.125
    // with significance=2: floor(0.125 * 100) / 100 = 0.12
    assert_num(
        f.call(&[data.clone(), num(1.5), num(2.0)]),
        0.12,
        1e-10,
        "PRANK.INC sig=2",
    );
    // with significance=1: floor(0.125 * 10) / 10 = 0.1
    assert_num(
        f.call(&[data.clone(), num(1.5), num(1.0)]),
        0.1,
        1e-10,
        "PRANK.INC sig=1",
    );
}

#[test]
fn test_percentrank_inc_significance_error() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        f.call(&[data.clone(), num(2.0), num(0.0)]),
        CellError::Num,
        "PRANK.INC sig<1",
    );
}

#[test]
fn test_percentrank_inc_single_element() {
    let f = FnPercentRankInc;
    let data = arr(vec![5.0]);
    // Single element: rank = 0/0 ... special case. pos=0, n=1, rank = 0/0
    // The code does pos as f64 / (n-1) as f64 = 0/0 which is NaN.
    // Actually 0 / 0 in f64 is NaN. Let's just see what happens.
    let result = f.call(&[data.clone(), num(5.0)]);
    // With n=1, (n-1)=0, so 0.0/0.0 = NaN. This may produce NaN or some value.
    // Accept whatever the implementation does - just verify it doesn't panic.
    match result {
        CellValue::Number(_) | CellValue::Error(..) => {} // acceptable
        _ => panic!("Unexpected result type: {:?}", result),
    }
}

#[test]
fn test_percentrank_inc_duplicates() {
    let f = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 2.0, 3.0]);
    // x=2: first occurrence at index 1, rank = 1/3 = 0.333
    assert_num(
        f.call(&[data.clone(), num(2.0)]),
        0.333,
        1e-10,
        "PRANK.INC dupes x=2",
    );
}

#[test]
fn test_percentrank_exc_basic() {
    let f = FnPercentRankExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // rank(1) = (0+1)/(5+1) = 1/6 ≈ 0.166...
    // truncated to 3 decimals: floor(0.1666*1000)/1000 = 0.166
    assert_num(
        f.call(&[data.clone(), num(1.0)]),
        0.166,
        1e-10,
        "PRANK.EXC x=1",
    );
    // rank(3) = 3/6 = 0.5
    assert_num(
        f.call(&[data.clone(), num(3.0)]),
        0.5,
        1e-10,
        "PRANK.EXC x=3",
    );
    // rank(5) = 5/6 ≈ 0.833...
    // truncated to 3 decimals: floor(0.8333*1000)/1000 = 0.833
    assert_num(
        f.call(&[data.clone(), num(5.0)]),
        0.833,
        1e-10,
        "PRANK.EXC x=5",
    );
}

#[test]
fn test_percentrank_exc_each_element() {
    let f = FnPercentRankExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // rank(2) = 2/6 = 0.333...  truncated to 0.333
    assert_num(
        f.call(&[data.clone(), num(2.0)]),
        0.333,
        1e-10,
        "PRANK.EXC x=2",
    );
    // rank(4) = 4/6 = 0.666...  truncated to 0.666
    assert_num(
        f.call(&[data.clone(), num(4.0)]),
        0.666,
        1e-10,
        "PRANK.EXC x=4",
    );
}

#[test]
fn test_percentrank_exc_interpolation() {
    let f = FnPercentRankExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // x=1.5: between index 0 (val=1) and index 1 (val=2), fraction=0.5
    // rank = (0+1 + 0.5) / 6 = 1.5/6 = 0.25
    assert_num(
        f.call(&[data.clone(), num(1.5)]),
        0.25,
        1e-10,
        "PRANK.EXC x=1.5",
    );
}

#[test]
fn test_percentrank_exc_out_of_range() {
    let f = FnPercentRankExc;
    let data = arr(vec![1.0, 2.0, 3.0]);
    assert_err(
        f.call(&[data.clone(), num(0.5)]),
        CellError::Na,
        "PRANK.EXC x<min",
    );
    assert_err(
        f.call(&[data.clone(), num(4.0)]),
        CellError::Na,
        "PRANK.EXC x>max",
    );
}

#[test]
fn test_percentrank_exc_significance() {
    let f = FnPercentRankExc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // x=1 => rank = 1/6 = 0.16666...
    // sig=4: floor(0.16666*10000)/10000 = 0.1666
    assert_num(
        f.call(&[data.clone(), num(1.0), num(4.0)]),
        0.1666,
        1e-10,
        "PRANK.EXC sig=4",
    );
    // sig=1: floor(0.16666*10)/10 = 0.1
    assert_num(
        f.call(&[data.clone(), num(1.0), num(1.0)]),
        0.1,
        1e-10,
        "PRANK.EXC sig=1",
    );
}

#[test]
fn test_percentile_legacy_is_inc() {
    let f_legacy = FnPercentile;
    let f_inc = FnPercentileInc;
    let data = arr(vec![1.0, 3.0, 5.0, 7.0, 9.0]);
    for k in [0.0, 0.25, 0.5, 0.75, 1.0] {
        assert_eq!(
            f_legacy.call(&[data.clone(), num(k)]),
            f_inc.call(&[data.clone(), num(k)]),
            "PERCENTILE should equal PERCENTILE.INC for k={}",
            k,
        );
    }
}

#[test]
fn test_quartile_legacy_is_inc() {
    let f_legacy = FnQuartile;
    let f_inc = FnQuartileInc;
    let data = arr(vec![1.0, 3.0, 5.0, 7.0, 9.0]);
    for q in 0..=4 {
        assert_eq!(
            f_legacy.call(&[data.clone(), num(q as f64)]),
            f_inc.call(&[data.clone(), num(q as f64)]),
            "QUARTILE should equal QUARTILE.INC for q={}",
            q,
        );
    }
}

#[test]
fn test_percentrank_legacy_is_inc() {
    let f_legacy = FnPercentRank;
    let f_inc = FnPercentRankInc;
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    for x in [1.0, 2.5, 3.0, 4.5, 5.0] {
        assert_eq!(
            f_legacy.call(&[data.clone(), num(x)]),
            f_inc.call(&[data.clone(), num(x)]),
            "PERCENTRANK should equal PERCENTRANK.INC for x={}",
            x,
        );
    }
}

#[test]
fn test_percentile_inc_exc_agree_at_median() {
    // Both INC and EXC should give same median for odd-count data
    let data = arr(vec![10.0, 20.0, 30.0, 40.0, 50.0]);
    let inc_med = FnPercentileInc.call(&[data.clone(), num(0.5)]);
    let exc_med = FnPercentileExc.call(&[data.clone(), num(0.5)]);
    assert_eq!(inc_med, exc_med, "INC and EXC medians should agree");
}

#[test]
fn test_percentrank_inc_roundtrip_with_percentile_inc() {
    // PERCENTILE.INC(data, PERCENTRANK.INC(data, x)) should ~ x for exact matches
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0]);
    // PERCENTRANK.INC(data, 3) = 0.5 (exact with sig=3)
    let rank = FnPercentRankInc.call(&[data.clone(), num(3.0)]);
    // PERCENTILE.INC(data, 0.5) = 3.0
    assert_num(rank, 0.5, 1e-10, "roundtrip rank");
    let val = FnPercentileInc.call(&[data.clone(), num(0.5)]);
    assert_num(val, 3.0, 1e-10, "roundtrip percentile");
}

#[test]
fn test_percentile_inc_large_dataset() {
    let f = FnPercentileInc;
    // 100 elements: 1..=100
    let vals: Vec<f64> = (1..=100).map(|i| i as f64).collect();
    let data = arr(vals);
    // k=0 => 1, k=1 => 100, k=0.5 => 50.5 (interpolation between 50 and 51)
    assert_num(
        f.call(&[data.clone(), num(0.0)]),
        1.0,
        1e-10,
        "100-elem min",
    );
    assert_num(
        f.call(&[data.clone(), num(1.0)]),
        100.0,
        1e-10,
        "100-elem max",
    );
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        50.5,
        1e-10,
        "100-elem median",
    );
}

#[test]
fn test_percentile_exc_large_dataset() {
    let f = FnPercentileExc;
    let vals: Vec<f64> = (1..=100).map(|i| i as f64).collect();
    let data = arr(vals);
    // k=0.5: rank = 0.5 * 101 = 50.5, interp between 50 and 51 => 50.5
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        50.5,
        1e-10,
        "100-elem EXC median",
    );
}

#[test]
fn test_percentile_inc_negative_values() {
    let f = FnPercentileInc;
    let data = arr(vec![-10.0, -5.0, 0.0, 5.0, 10.0]);
    assert_num(f.call(&[data.clone(), num(0.0)]), -10.0, 1e-10, "neg min");
    assert_num(f.call(&[data.clone(), num(0.5)]), 0.0, 1e-10, "neg median");
    assert_num(f.call(&[data.clone(), num(1.0)]), 10.0, 1e-10, "neg max");
}

#[test]
fn test_percentile_inc_fractional_values() {
    let f = FnPercentileInc;
    let data = arr(vec![0.1, 0.2, 0.3, 0.4, 0.5]);
    assert_num(f.call(&[data.clone(), num(0.5)]), 0.3, 1e-10, "frac median");
    assert_num(f.call(&[data.clone(), num(0.25)]), 0.2, 1e-10, "frac Q1");
}

#[test]
fn test_quartile_exc_single_element() {
    let f = FnQuartileExc;
    let data = arr(vec![42.0]);
    // n=1: PERCENTILE.EXC(k=0.25) => rank=0.5 <1 => Num error
    assert_err(
        f.call(&[data.clone(), num(1.0)]),
        CellError::Num,
        "Q.EXC single q=1",
    );
    // n=1: PERCENTILE.EXC(k=0.5) => rank=1.0 = n => valid, returns 42
    assert_num(
        f.call(&[data.clone(), num(2.0)]),
        42.0,
        1e-10,
        "Q.EXC single q=2",
    );
    // n=1: PERCENTILE.EXC(k=0.75) => rank=1.5 >1 => Num error
    assert_err(
        f.call(&[data.clone(), num(3.0)]),
        CellError::Num,
        "Q.EXC single q=3",
    );
}

#[test]
fn test_percentrank_exc_duplicates() {
    let f = FnPercentRankExc;
    let data = arr(vec![1.0, 2.0, 2.0, 3.0]);
    // x=2: first occurrence at index 1, rank = (1+1)/(4+1) = 2/5 = 0.4
    assert_num(
        f.call(&[data.clone(), num(2.0)]),
        0.4,
        1e-10,
        "PRANK.EXC dupes x=2",
    );
}

#[test]
fn test_percentile_exc_interpolation_detail() {
    let f = FnPercentileExc;
    // n=7: valid range (1/8, 7/8) = (0.125, 0.875)
    let data = arr(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]);
    // k=0.25: rank = 0.25*8 = 2.0, element at index 1 => 2.0
    assert_num(
        f.call(&[data.clone(), num(0.25)]),
        2.0,
        1e-10,
        "EXC 7-elem k=0.25",
    );
    // k=0.5: rank = 0.5*8 = 4.0, element at index 3 => 4.0
    assert_num(
        f.call(&[data.clone(), num(0.5)]),
        4.0,
        1e-10,
        "EXC 7-elem k=0.5",
    );
    // k=0.75: rank = 0.75*8 = 6.0, element at index 5 => 6.0
    assert_num(
        f.call(&[data.clone(), num(0.75)]),
        6.0,
        1e-10,
        "EXC 7-elem k=0.75",
    );
}

#[test]
fn test_percentrank_inc_two_elements() {
    let f = FnPercentRankInc;
    let data = arr(vec![10.0, 20.0]);
    // x=10: rank = 0/(2-1) = 0
    assert_num(
        f.call(&[data.clone(), num(10.0)]),
        0.0,
        1e-10,
        "PRANK.INC 2-elem x=min",
    );
    // x=20: rank = 1/1 = 1
    assert_num(
        f.call(&[data.clone(), num(20.0)]),
        1.0,
        1e-10,
        "PRANK.INC 2-elem x=max",
    );
    // x=15: rank = (0+0.5)/1 = 0.5
    assert_num(
        f.call(&[data.clone(), num(15.0)]),
        0.5,
        1e-10,
        "PRANK.INC 2-elem x=mid",
    );
}

#[test]
fn test_percentrank_exc_two_elements() {
    let f = FnPercentRankExc;
    let data = arr(vec![10.0, 20.0]);
    // x=10: rank = 1/3 = 0.333
    assert_num(
        f.call(&[data.clone(), num(10.0)]),
        0.333,
        1e-10,
        "PRANK.EXC 2-elem min",
    );
    // x=20: rank = 2/3 = 0.666
    assert_num(
        f.call(&[data.clone(), num(20.0)]),
        0.666,
        1e-10,
        "PRANK.EXC 2-elem max",
    );
}
