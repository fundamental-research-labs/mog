use super::super::solver::gaussian_elimination;
use super::fixtures::EPS;

#[test]
fn gauss_simple_2x2() {
    // 2x + y = 5
    // x + 3y = 10
    // Solution: x = 1, y = 3
    let mut a = vec![vec![2.0, 1.0], vec![1.0, 3.0]];
    let mut b = vec![5.0, 10.0];
    let x = gaussian_elimination(&mut a, &mut b).unwrap();
    assert!((x[0] - 1.0).abs() < EPS);
    assert!((x[1] - 3.0).abs() < EPS);
}

#[test]
fn gauss_singular_returns_none() {
    // Singular: rows are multiples
    let mut a = vec![vec![1.0, 2.0], vec![2.0, 4.0]];
    let mut b = vec![3.0, 6.0];
    assert!(gaussian_elimination(&mut a, &mut b).is_none());
}
