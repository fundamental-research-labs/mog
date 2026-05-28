use cell_types::SheetPos;
use std::sync::Arc;
use value_types::{CellArray, CellValue};

use crate::mirror::types::CellEntry;

use super::helpers::make_mirror;

#[test]
fn materialize_projection_skips_origin_but_touches_all_columns() {
    let (mut mirror, sheet_id) = make_mirror();
    let origin = SheetPos::new(1, 1);
    let cell_id = cell_types::CellId::from_raw(800);
    mirror.insert_cell(
        &sheet_id,
        cell_id,
        origin,
        CellEntry {
            value: CellValue::from("origin"),
            formula: None,
        },
    );
    let before_col_1 = mirror.col_version(&sheet_id, 1);
    let before_col_2 = mirror.col_version(&sheet_id, 2);
    let array = CellValue::Array(Arc::new(CellArray::from_rows(vec![
        vec![CellValue::from("skip"), CellValue::from("right")],
        vec![CellValue::from("down"), CellValue::from("diag")],
    ])));

    mirror.materialize_projection(&sheet_id, 1, 1, &array);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.col_data[&1][1], CellValue::from("origin"));
    assert_eq!(sheet.col_data[&2][1], CellValue::from("right"));
    assert_eq!(sheet.col_data[&1][2], CellValue::from("down"));
    assert_eq!(mirror.col_version(&sheet_id, 1), before_col_1 + 1);
    assert_eq!(mirror.col_version(&sheet_id, 2), before_col_2 + 1);
}
