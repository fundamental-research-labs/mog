use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::CellId;
use value_types::CellValue;

fn native_rows(rows: &[&[&str]]) -> (CellStore, SheetId) {
    let sheet_id = SheetId::from_raw(1);
    let cols = rows.iter().map(|row| row.len()).max().unwrap_or(0) as u32;
    let cell_store = CellStore::from_snapshot(WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id.to_uuid_string(),
            name: "Data".into(),
            rows: rows.len() as u32,
            cols,
            cells: rows
                .iter()
                .enumerate()
                .flat_map(|(row, values)| {
                    values.iter().enumerate().map(move |(col, value)| CellData {
                        cell_id: CellId::from_raw(10 + row as u128 * cols as u128 + col as u128)
                            .to_uuid_string(),
                        row: row as u32,
                        col: col as u32,
                        value: CellValue::Text((*value).into()),
                        formula: None,
                        identity_formula: None,
                        array_ref: None,
                    })
                })
                .collect(),
            ranges: vec![],
        }],
        ..Default::default()
    })
    .unwrap();
    (cell_store, sheet_id)
}

#[test]
fn duplicate_keys_respect_case_and_selected_columns() {
    let (cell_store, sheet) = native_rows(&[
        &["Alice", "1"],
        &["alice", "2"],
        &["Bob", "3"],
        &["Alice", "1"],
    ]);
    for (case_sensitive, columns, expected) in [
        (true, vec![], vec![0, 1, 2]),
        (false, vec![], vec![0, 1, 2]),
        (true, vec![0], vec![0, 1, 2]),
        (false, vec![0], vec![0, 2]),
        (false, vec![99], vec![0, 1, 2, 3]),
    ] {
        assert_eq!(
            unique_rows(
                &cell_store,
                &sheet,
                0,
                0,
                3,
                1,
                &RemoveDuplicatesOptions {
                    has_headers: false,
                    columns_to_compare: columns,
                    case_sensitive,
                }
            ),
            expected
        );
    }
    assert_eq!(cell_store.get_sheet(&sheet).unwrap().cell_count(), 8);
}

#[test]
fn headers_do_not_participate_in_duplicate_detection() {
    let (cell_store, sheet) = native_rows(&[&["Name"], &["Name"], &["Alice"], &["Name"]]);
    let options = RemoveDuplicatesOptions {
        has_headers: true,
        columns_to_compare: vec![],
        case_sensitive: true,
    };
    assert_eq!(
        unique_rows(&cell_store, &sheet, 0, 0, 3, 0, &options),
        vec![1, 2]
    );
    assert!(unique_rows(&cell_store, &sheet, 0, 0, 0, 0, &options).is_empty());
}

#[test]
fn embedded_nul_keys_do_not_collide_across_columns() {
    let (cell_store, sheet) = native_rows(&[&["a\0b", "c"], &["a", "b\0c"], &["a\0b", "c"]]);
    assert_eq!(
        unique_rows(
            &cell_store,
            &sheet,
            0,
            0,
            2,
            1,
            &RemoveDuplicatesOptions {
                has_headers: false,
                columns_to_compare: vec![],
                case_sensitive: true,
            }
        ),
        vec![0, 1]
    );
}
