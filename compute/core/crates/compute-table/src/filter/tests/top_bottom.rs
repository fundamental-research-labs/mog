use super::fixtures::*;
use super::*;

#[test]
fn test_top_bottom_top_3() {
    use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 3.0,
        by: TopBottomBy::Items,
    });
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![0, 1, 1, 0, 1]);
}

#[test]
fn test_top_bottom_bottom_2() {
    use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 2.0,
        by: TopBottomBy::Items,
    });
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![1, 0, 0, 1, 0]);
}

#[test]
fn test_top_bottom_duplicate_boundary_selects_exactly_n() {
    use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    });
    let data = vec![cv_num(10.0), cv_num(10.0), cv_num(10.0)];
    let bitmap = eval(&criteria, &data);
    let visible_count: u8 = bitmap.iter().sum();
    assert_eq!(visible_count, 2);
}

#[test]
fn test_top_bottom_non_numeric_excluded() {
    use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    });
    let data = vec![
        cv_num(10.0),
        cv_text("text"),
        cv_null(),
        cv_num(50.0),
        cv_num(30.0),
    ];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![0, 0, 0, 1, 1]);
}

#[test]
fn test_top_bottom_all_non_numeric() {
    use crate::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 3.0,
        by: TopBottomBy::Items,
    });
    let data = vec![cv_text("a"), cv_text("b"), cv_null()];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}
