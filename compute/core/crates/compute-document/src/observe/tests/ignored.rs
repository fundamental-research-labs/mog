use super::fixtures::*;
use yrs::Any;

#[test]
fn test_internal_indexes_ignored() {
    let (doc, sheets, workbook) = setup_doc();
    let sheet_id = make_sheet_id(1);
    let sheet_hex = add_sheet(&doc, &sheets, sheet_id);

    // Add internal index sub-maps
    add_sub_map(&doc, &sheets, &sheet_hex, "gridIndex");
    add_sub_map(&doc, &sheets, &sheet_hex, "rowIndex");
    add_sub_map(&doc, &sheets, &sheet_hex, "colIndex");

    let observer = new_observer(&sheets, &workbook);

    // Write to internal indexes
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        "gridIndex",
        "key1",
        Any::Number(1.0),
    );
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        "rowIndex",
        "key2",
        Any::Number(2.0),
    );
    insert_sub_map_entry(
        &doc,
        &sheets,
        &sheet_hex,
        "colIndex",
        "key3",
        Any::Number(3.0),
    );

    let changes = observer.drain_all_changes();
    assert!(
        changes.is_empty(),
        "internal index changes should not produce DocumentChanges, got non-empty"
    );
}
