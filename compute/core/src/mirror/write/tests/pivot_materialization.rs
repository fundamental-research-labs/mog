use value_types::CellValue;

use super::helpers::make_mirror;

#[test]
fn clear_pivot_region_touches_only_existing_columns() {
    let (mut mirror, sheet_id) = make_mirror();
    mirror.apply_edit(
        &sheet_id,
        cell_types::CellId::from_raw(850),
        cell_types::SheetPos::new(2, 3),
        CellValue::number(9.0),
        None,
    );
    let before_existing = mirror.col_version(&sheet_id, 3);
    let before_missing = mirror.col_version(&sheet_id, 4);

    mirror.clear_pivot_region(&sheet_id, 2, 3, 2, 2);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.col_data[&3][2], CellValue::Null);
    assert!(!sheet.col_data.contains_key(&4));
    assert_eq!(mirror.col_version(&sheet_id, 3), before_existing + 1);
    assert_eq!(mirror.col_version(&sheet_id, 4), before_missing);
}
