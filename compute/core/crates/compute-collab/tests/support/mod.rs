use yrs::{Array, Doc, GetString, Map, Text, Transact};

pub fn doc_with_text(text: &str) -> Doc {
    let doc = Doc::new();
    {
        let content = doc.get_or_insert_text("content");
        let mut txn = doc.transact_mut();
        content.push(&mut txn, text);
    }
    doc
}

pub fn read_text(doc: &Doc) -> String {
    let content = doc.get_or_insert_text("content");
    let txn = doc.transact();
    content.get_string(&txn)
}

pub fn realistic_bootstrap(doc: &Doc) {
    let workbook = doc.get_or_insert_map("workbook");
    let _sheets = doc.get_or_insert_map("sheets");
    let _security = doc.get_or_insert_map("security");
    {
        let mut txn = doc.transact_mut();
        workbook.insert(&mut txn, "sheetOrder", yrs::ArrayPrelim::default());
        for key in [
            "workbookSettings",
            "namedRanges",
            "tables",
            "slicers",
            "powerQuery",
            "scenarios",
            "documentProperties",
            "fileVersion",
            "fileSharing",
        ] {
            workbook.insert(
                &mut txn,
                key,
                yrs::MapPrelim::from([] as [(&str, yrs::Any); 0]),
            );
        }
    }
}

pub fn root_maps_only_bootstrap(doc: &Doc) {
    let _workbook = doc.get_or_insert_map("workbook");
    let _sheets = doc.get_or_insert_map("sheets");
    let _security = doc.get_or_insert_map("security");
}

pub fn workbook_sheet_order(doc: &Doc) -> yrs::ArrayRef {
    let workbook = doc.get_or_insert_map("workbook");
    let txn = doc.transact();
    match workbook.get(&txn, "sheetOrder") {
        Some(yrs::Out::YArray(array)) => array,
        other => panic!("expected sheetOrder array, got {:?}", other.is_some()),
    }
}

pub fn sheet_order_len(doc: &Doc) -> u32 {
    let order = workbook_sheet_order(doc);
    let txn = doc.transact();
    order.len(&txn)
}

pub fn sheet_order_string(doc: &Doc, index: u32) -> String {
    let order = workbook_sheet_order(doc);
    let txn = doc.transact();
    match order.get(&txn, index) {
        Some(yrs::Out::Any(yrs::Any::String(value))) => value.to_string(),
        other => panic!("expected sheetOrder string at {index}, got {:?}", other),
    }
}
