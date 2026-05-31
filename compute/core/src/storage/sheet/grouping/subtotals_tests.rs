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

fn region_sales_accessor() -> MockCellAccessor {
    let mut a = MockCellAccessor::new();
    a.set(0, 0, "Region");
    a.set(0, 1, "Sales");
    a.set(1, 0, "East");
    a.set(1, 1, "100");
    a.set(2, 0, "East");
    a.set(2, 1, "80");
    a.set(3, 0, "West");
    a.set(3, 1, "90");
    a.set(4, 0, "West");
    a.set(4, 1, "110");
    a
}

fn subtotal_options(function: SubtotalFunction) -> SubtotalOptions {
    SubtotalOptions {
        group_by_column: 0,
        subtotal_columns: vec![1],
        function,
        has_headers: true,
        replace_existing: true,
        summary_below_data: true,
    }
}

#[test]
fn test_create_subtotals_summary_below_layout_and_grand_total() {
    let (s, sid) = storage_with_sheet();
    let mut a = region_sales_accessor();
    let r = CellRange::new(0, 0, 4, 1);

    let result = create_subtotals(
        s.doc(),
        &s.sheets_ref(),
        &mut a,
        &sid,
        &r,
        &subtotal_options(SubtotalFunction::Sum),
    );

    assert_eq!(result.groups_created, 2);
    assert_eq!(result.subtotal_rows_inserted, 3);
    assert_eq!(result.affected_range, CellRange::new(0, 0, 7, 1));
    assert_eq!(a.cells.get(&(3, 0)).map(String::as_str), Some("East Total"));
    assert_eq!(
        a.cells.get(&(3, 1)).map(String::as_str),
        Some("=SUBTOTAL(109,B2:B3)")
    );
    assert_eq!(a.cells.get(&(4, 0)).map(String::as_str), Some("West"));
    assert_eq!(a.cells.get(&(6, 0)).map(String::as_str), Some("West Total"));
    assert_eq!(
        a.cells.get(&(6, 1)).map(String::as_str),
        Some("=SUBTOTAL(109,B5:B6)")
    );
    assert_eq!(
        a.cells.get(&(7, 0)).map(String::as_str),
        Some("Grand Total")
    );
    assert_eq!(
        a.cells.get(&(7, 1)).map(String::as_str),
        Some("=SUBTOTAL(109,B2:B7)")
    );

    let groups = get_groups(s.doc(), &s.sheets_ref(), &sid, GroupAxis::Row);
    let ranges: Vec<(u32, u32)> = groups.iter().map(|g| (g.start, g.end)).collect();
    assert_eq!(ranges, vec![(1, 2), (4, 5)]);
}

#[test]
fn test_create_subtotals_replaces_existing_layout() {
    let (s, sid) = storage_with_sheet();
    let mut a = region_sales_accessor();
    let r = CellRange::new(0, 0, 4, 1);

    create_subtotals(
        s.doc(),
        &s.sheets_ref(),
        &mut a,
        &sid,
        &r,
        &subtotal_options(SubtotalFunction::Sum),
    );
    let result = create_subtotals(
        s.doc(),
        &s.sheets_ref(),
        &mut a,
        &sid,
        &r,
        &subtotal_options(SubtotalFunction::Average),
    );

    assert_eq!(result.groups_created, 2);
    assert_eq!(result.subtotal_rows_inserted, 3);
    assert_eq!(a.cells.get(&(3, 0)).map(String::as_str), Some("East Total"));
    assert_eq!(
        a.cells.get(&(3, 1)).map(String::as_str),
        Some("=SUBTOTAL(101,B2:B3)")
    );
    assert_eq!(a.cells.get(&(4, 0)).map(String::as_str), Some("West"));
    assert_eq!(a.cells.get(&(6, 0)).map(String::as_str), Some("West Total"));
    assert_eq!(
        a.cells.get(&(6, 1)).map(String::as_str),
        Some("=SUBTOTAL(101,B5:B6)")
    );
    assert_eq!(
        a.cells.get(&(7, 0)).map(String::as_str),
        Some("Grand Total")
    );
    assert_eq!(
        a.cells.get(&(7, 1)).map(String::as_str),
        Some("=SUBTOTAL(101,B2:B7)")
    );
    assert_eq!(a.cells.get(&(8, 0)), None);
    assert!(
        a.cells
            .values()
            .filter(|value| value.to_uppercase().contains("SUBTOTAL("))
            .all(|value| value.starts_with("=SUBTOTAL(101,"))
    );
}
