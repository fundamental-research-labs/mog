use super::*;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi)
}

pub(super) fn storage_with_sheet_and_mirror() -> (
    crate::storage::YrsStorage,
    SheetId,
    GridIndex,
    crate::mirror::CellMirror,
) {
    let mut storage = crate::storage::YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi, mirror)
}

pub(super) fn insert_style_palette_entry(
    doc: &::yrs::Doc,
    workbook: &::yrs::MapRef,
    style_id: u32,
    format: &CellFormat,
) {
    let fmt_json = serde_json::to_string(format).unwrap();
    let mut txn = doc.transact_mut();
    let palette = match workbook.get(&txn, compute_document::schema::KEY_STYLE_PALETTE) {
        Some(Out::YMap(map)) => map,
        _ => {
            let empty: MapPrelim = Vec::<(&str, Any)>::new().into_iter().collect();
            workbook.insert(&mut txn, compute_document::schema::KEY_STYLE_PALETTE, empty)
        }
    };
    palette.insert(
        &mut txn,
        &*style_id.to_string(),
        Any::String(std::sync::Arc::from(fmt_json.as_str())),
    );
}

pub(super) fn insert_compact_cell_properties(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    cell_hex: &str,
    json: &str,
) {
    let doc = storage.doc();
    let sheets = storage.sheets();
    let mut txn = doc.transact_mut();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("sheet map not found"),
    };
    let props_map = match sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
        Some(Out::YMap(map)) => map,
        _ => panic!("cellProperties map not found"),
    };
    props_map.insert(&mut txn, cell_hex, Any::String(std::sync::Arc::from(json)));
}

pub(super) fn insert_row_xlsx_style_id(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    grid_index: &GridIndex,
    row: u32,
    style_id: u32,
) {
    let row_key = id_to_hex(grid_index.row_id(row).unwrap().as_u128());
    insert_axis_xlsx_style_id(
        storage,
        sheet_id,
        compute_document::schema::KEY_ROW_FORMATS,
        &row_key,
        style_id,
    );
}

pub(super) fn insert_col_xlsx_style_id(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    grid_index: &GridIndex,
    col: u32,
    style_id: u32,
) {
    let col_key = id_to_hex(grid_index.col_id(col).unwrap().as_u128());
    insert_axis_xlsx_style_id(
        storage,
        sheet_id,
        compute_document::schema::KEY_COL_FORMATS,
        &col_key,
        style_id,
    );
}

pub(super) fn insert_col_format_range(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    range_id: cell_types::RangeId,
    start_col: u32,
    end_col: u32,
    format: &CellFormat,
    xlsx_style_id: Option<u32>,
) {
    let sheets = storage.sheets();
    let mut txn = storage.doc().transact_mut();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("sheet map not found"),
    };
    let ranges_map = match sheet_map.get(&txn, compute_document::schema::KEY_COL_FORMAT_RANGES) {
        Some(Out::YMap(map)) => map,
        _ => {
            let empty: MapPrelim = Vec::<(&str, Any)>::new().into_iter().collect();
            sheet_map.insert(
                &mut txn,
                compute_document::schema::KEY_COL_FORMAT_RANGES,
                empty,
            )
        }
    };
    let mut entries = domain_types::yrs_schema::cell_format::to_yrs_prelim(format);
    entries.push(("_sc", Any::Number(start_col as f64)));
    entries.push(("_ec", Any::Number(end_col as f64)));
    if let Some(style_id) = xlsx_style_id {
        entries.push((
            domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
            Any::Number(style_id as f64),
        ));
    }
    let nested: MapPrelim = entries.into_iter().collect();
    let range_key = id_to_hex(range_id.as_u128());
    ranges_map.insert(&mut txn, range_key.as_str(), nested);
}

fn insert_axis_xlsx_style_id(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    map_key: &str,
    axis_key: &str,
    style_id: u32,
) {
    let sheets = storage.sheets();
    let mut txn = storage.doc().transact_mut();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets.get(&txn, &sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("sheet map not found"),
    };
    let format_map = match sheet_map.get(&txn, map_key) {
        Some(Out::YMap(map)) => map,
        _ => panic!("axis format map not found"),
    };
    let entries: MapPrelim = vec![(
        domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID,
        Any::Number(style_id as f64),
    )]
    .into_iter()
    .collect();
    format_map.insert(&mut txn, axis_key, entries);
}
