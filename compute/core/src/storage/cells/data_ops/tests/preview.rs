use super::super::*;
use crate::mirror::CellMirror;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use cell_types::{CellId, SheetPos};
use value_types::CellValue;

#[test]
fn preview_splits_native_values_respects_limit_and_preserves_cells() {
    let sheet_id = SheetId::from_raw(1);
    let mirror = CellMirror::from_snapshot(WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id.to_uuid_string(),
            name: "Data".into(),
            rows: 100,
            cols: 3,
            cells: ["a,b,c", "d,e", "untouched"]
                .into_iter()
                .enumerate()
                .map(|(row, text)| CellData {
                    cell_id: CellId::from_raw(row as u128 + 10).to_uuid_string(),
                    row: row as u32,
                    col: 0,
                    value: CellValue::Text(text.into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                })
                .collect(),
            ranges: vec![],
        }],
        ..Default::default()
    })
    .unwrap();
    let options = TextToColumnsOptions {
        split_type: TextToColumnsSplitType::Delimited,
        delimiters: Delimiters::default(),
        treat_consecutive_as_one: false,
        text_qualifier: TextQualifier::None,
        fixed_width_breaks: vec![],
    };
    assert_eq!(
        preview_text_to_columns(&mirror, sheet_id, 0, 99, 0, &options, 2),
        vec![vec!["a", "b", "c"], vec!["d", "e"]]
    );
    assert_eq!(mirror.get_sheet(&sheet_id).unwrap().cell_count(), 3);
    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, SheetPos::new(0, 0)),
        Some(&CellValue::Text("a,b,c".into()))
    );
    assert_eq!(
        mirror.get_cell_value_at(&sheet_id, SheetPos::new(0, 1)),
        None
    );
    assert!(preview_text_to_columns(&mirror, sheet_id, 2, 1, 0, &options, 2).is_empty());
    assert!(preview_text_to_columns(&mirror, sheet_id, 0, 99, 0, &options, 0).is_empty());
}
