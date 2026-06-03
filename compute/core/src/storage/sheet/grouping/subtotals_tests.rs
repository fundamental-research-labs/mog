use super::super::*;
use super::test_support::*;
use cell_types::col_to_letter;

#[test]
fn test_col_to_letter() {
    assert_eq!(col_to_letter(0), "A");
    assert_eq!(col_to_letter(25), "Z");
    assert_eq!(col_to_letter(26), "AA");
    assert_eq!(col_to_letter(702), "AAA");
}

#[test]
fn test_subtotal_codes() {
    assert_eq!(SubtotalFunction::Sum.visible_code(), 9);
    assert_eq!(SubtotalFunction::Sum.hidden_code(), 109);
    assert_eq!(SubtotalFunction::Average.visible_code(), 1);
}

#[test]
fn test_build_formula() {
    assert_eq!(
        build_subtotal_formula(SubtotalFunction::Sum, 0, 1, 5),
        "=SUBTOTAL(109,A2:A6)"
    );
    assert_eq!(
        build_subtotal_formula(SubtotalFunction::Average, 2, 0, 9),
        "=SUBTOTAL(101,C1:C10)"
    );
}

#[test]
fn test_find_boundaries() {
    let (_, sid) = storage_with_sheet();
    let mut a = MockCellAccessor::new();
    a.set(0, 0, "Cat");
    a.set(1, 0, "A");
    a.set(2, 0, "A");
    a.set(3, 0, "B");
    a.set(4, 0, "B");
    a.set(5, 0, "B");
    a.set(6, 0, "C");
    let r = CellRange::new(0, 0, 6, 0);
    let b = find_group_boundaries(&a, &sid, &r, 0, true);
    assert_eq!(b.len(), 3);
    assert_eq!(b[0].group_value, "A");
    assert_eq!(b[1].group_value, "B");
}

#[test]
fn test_is_subtotal_row() {
    let (_, sid) = storage_with_sheet();
    let mut a = MockCellAccessor::new();
    a.set(0, 0, "Data");
    a.set(1, 0, "=SUBTOTAL(109,A1:A1)");
    assert!(!is_subtotal_row(&a, &sid, 0, 0, 0));
    assert!(is_subtotal_row(&a, &sid, 1, 0, 0));
}

#[test]
fn test_display_name() {
    assert_eq!(SubtotalFunction::Sum.display_name(), "Sum");
    assert_eq!(SubtotalFunction::CountNums.display_name(), "Count Numbers");
}

#[test]
fn test_create_subtotals_summary_below_groups_only_detail_rows() {
    let (s, sid) = storage_with_sheet();
    let mut a = MockCellAccessor::new();
    a.set(0, 0, "Cat");
    a.set(0, 1, "Value");
    a.set(1, 0, "A");
    a.set(1, 1, "10");
    a.set(2, 0, "A");
    a.set(2, 1, "20");

    let result = create_subtotals(
        s.doc(),
        &s.sheets_ref(),
        &mut a,
        &sid,
        &CellRange::new(0, 0, 2, 1),
        &SubtotalOptions {
            group_by_column: 0,
            subtotal_columns: vec![1],
            function: SubtotalFunction::Sum,
            has_headers: true,
            replace_existing: false,
            summary_below_data: true,
        },
    );

    assert_eq!(result.groups_created, 1);
    assert_eq!(a.get_cell_value(&sid, 3, 0), "A Total");
    let groups = get_groups(s.doc(), &s.sheets_ref(), &sid, GroupAxis::Row);
    assert_eq!(groups.len(), 1);
    assert_eq!((groups[0].start, groups[0].end), (1, 2));
}

#[test]
fn test_create_subtotals_summary_above_groups_only_detail_rows() {
    let (s, sid) = storage_with_sheet();
    let mut a = MockCellAccessor::new();
    a.set(0, 0, "Cat");
    a.set(0, 1, "Value");
    a.set(1, 0, "A");
    a.set(1, 1, "10");
    a.set(2, 0, "A");
    a.set(2, 1, "20");

    let result = create_subtotals(
        s.doc(),
        &s.sheets_ref(),
        &mut a,
        &sid,
        &CellRange::new(0, 0, 2, 1),
        &SubtotalOptions {
            group_by_column: 0,
            subtotal_columns: vec![1],
            function: SubtotalFunction::Sum,
            has_headers: true,
            replace_existing: false,
            summary_below_data: false,
        },
    );

    assert_eq!(result.groups_created, 1);
    assert_eq!(a.get_cell_value(&sid, 1, 0), "A Total");
    let groups = get_groups(s.doc(), &s.sheets_ref(), &sid, GroupAxis::Row);
    assert_eq!(groups.len(), 1);
    assert_eq!((groups[0].start, groups[0].end), (2, 3));
}
