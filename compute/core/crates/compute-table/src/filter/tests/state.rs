use super::fixtures::*;
use super::*;

#[test]
fn test_create_filter_state() {
    let state = create_filter_state();
    assert!(state.filters.is_empty());
}

#[test]
fn test_set_column_filter() {
    let state = create_filter_state();
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(2.0)], false);
    let state = set_column_filter(&state, "colA", criteria);
    assert_eq!(state.filters.len(), 1);
    assert!(state.filters.contains_key("colA"));
}

#[test]
fn test_set_column_filter_replaces() {
    let state = create_filter_state();
    let c1 = make_value_filter(vec![cv_num(1.0)], false);
    let c2 = make_value_filter(vec![cv_num(2.0)], true);
    let state = set_column_filter(&state, "colA", c1);
    let state = set_column_filter(&state, "colA", c2);
    assert_eq!(state.filters.len(), 1);
    if let Some(FilterCriteria::Values(vf)) = state.filters.get("colA") {
        assert!(vf.include_blanks);
    } else {
        panic!("Expected ValueFilter");
    }
}

#[test]
fn test_set_column_filter_immutability() {
    let state1 = create_filter_state();
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let state2 = set_column_filter(&state1, "colA", criteria);
    assert!(state1.filters.is_empty());
    assert_eq!(state2.filters.len(), 1);
}

#[test]
fn test_clear_column_filter() {
    let state = create_filter_state();
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    let state = set_column_filter(&state, "colB", make_value_filter(vec![cv_num(2.0)], false));
    let state = clear_column_filter(&state, "colA");
    assert_eq!(state.filters.len(), 1);
    assert!(!state.filters.contains_key("colA"));
    assert!(state.filters.contains_key("colB"));
}

#[test]
fn test_clear_column_filter_nonexistent() {
    let state = create_filter_state();
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    let state2 = clear_column_filter(&state, "nonexistent");
    assert_eq!(state2.filters.len(), 1);
}

#[test]
fn test_clear_all_filters() {
    let state = create_filter_state();
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    let state = set_column_filter(&state, "colB", make_value_filter(vec![cv_num(2.0)], false));
    let state = clear_all_filters(&state);
    assert!(state.filters.is_empty());
}

#[test]
fn test_get_column_filter() {
    let state = create_filter_state();
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let state = set_column_filter(&state, "colA", criteria);
    assert!(get_column_filter(&state, "colA").is_some());
    assert!(get_column_filter(&state, "colB").is_none());
}

#[test]
fn test_has_active_filters() {
    let state = create_filter_state();
    assert!(!has_active_filters(&state));
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    assert!(has_active_filters(&state));
}

#[test]
fn test_multiple_independent_filters() {
    let state = create_filter_state();
    let ca = make_value_filter(vec![cv_num(1.0), cv_num(2.0)], false);
    let cb = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(10.0))],
        FilterLogic::And,
    );
    let state = set_column_filter(&state, "colA", ca);
    let state = set_column_filter(&state, "colB", cb);
    assert_eq!(state.filters.len(), 2);
}
