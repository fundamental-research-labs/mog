use super::super::*;
use super::fixtures::*;
use value_types::CellValue;

// ===================================================================
// preview_text_to_columns tests
// ===================================================================

#[test]
fn test_preview_text_to_columns_basic() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("a,b,c".into()),
    );
    seed_cell(
        &storage,
        &mut grid,
        sid,
        1,
        0,
        CellValue::Text("d,e".into()),
    );

    let preview = preview_text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        1,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        10,
    );

    assert_eq!(preview.len(), 2);
    assert_eq!(preview[0], vec!["a", "b", "c"]);
    assert_eq!(preview[1], vec!["d", "e"]);
}

#[test]
fn test_preview_text_to_columns_limited_rows() {
    let (storage, sid, mut grid) = storage_with_sheet();
    for i in 0..10 {
        seed_cell(
            &storage,
            &mut grid,
            sid,
            i,
            0,
            CellValue::Text(format!("row{}", i).into()),
        );
    }

    let preview = preview_text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        9,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        3,
    );

    assert_eq!(preview.len(), 3);
}

#[test]
fn test_preview_does_not_modify() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(
        &storage,
        &mut grid,
        sid,
        0,
        0,
        CellValue::Text("a,b,c".into()),
    );

    let _preview = preview_text_to_columns(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &grid,
        0,
        0,
        0,
        &TextToColumnsOptions {
            split_type: TextToColumnsSplitType::Delimited,
            delimiters: Delimiters::default(),
            treat_consecutive_as_one: false,
            text_qualifier: TextQualifier::None,
            fixed_width_breaks: vec![],
        },
        5,
    );

    // Original cell should be unchanged
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 0), "a,b,c");
    // Destination cells should not exist
    assert_eq!(read_value_at(&storage, &grid, sid, 0, 1), "");
}
