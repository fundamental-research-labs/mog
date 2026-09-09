use super::*;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn storage_with_sheet() -> (WorkbookStorage, SheetId, GridIndex) {
    let mut storage = WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi)
}

pub(super) fn storage_with_sheet_and_store() -> (
    crate::storage::WorkbookStorage,
    SheetId,
    GridIndex,
    crate::cells::CellStore,
) {
    let mut storage = crate::storage::WorkbookStorage::new();
    let mut cell_store = crate::cells::CellStore::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut cell_store, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi, cell_store)
}

pub(super) fn insert_style_palette_entry(
    storage: &mut WorkbookStorage,
    style_id: u32,
    format: &CellFormat,
) {
    storage
        .metadata
        .style_palette
        .resize_with((style_id + 1) as usize, Default::default);
    storage.metadata.style_palette[style_id as usize] = format.clone();
}

pub(super) fn insert_compact_cell_properties(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_hex: &str,
    json: &str,
) {
    let props = serde_json::from_str(json).expect("valid typed property fixture");
    set_properties(storage, sheet_id, cell_hex, &props);
}

pub(super) fn insert_row_xlsx_style_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    grid: &GridIndex,
    row: u32,
    style_id: u32,
) {
    storage
        .sheet_metadata
        .get_mut(sheet_id)
        .unwrap()
        .dimensions
        .rows
        .entry(grid.row_id(row).unwrap())
        .or_default()
        .format =
        Some(crate::storage::sheet::dimensions::StoredAxisFormat::ImportedStyle(style_id));
}

pub(super) fn insert_col_xlsx_style_id(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    grid: &GridIndex,
    col: u32,
    style_id: u32,
) {
    storage
        .sheet_metadata
        .get_mut(sheet_id)
        .unwrap()
        .dimensions
        .columns
        .entry(grid.col_id(col).unwrap())
        .or_default()
        .format =
        Some(crate::storage::sheet::dimensions::StoredAxisFormat::ImportedStyle(style_id));
}

pub(super) fn insert_col_format_range(
    cell_store: &mut crate::cells::SheetStore,
    range_id: cell_types::RangeId,
    start_col: u32,
    end_col: u32,
    format: &CellFormat,
    xlsx_style_id: Option<u32>,
) {
    cell_store
        .col_format_ranges
        .push(crate::cells::ColumnFormatRange {
            id: range_id,
            start_col,
            end_col,
        });
    cell_store
        .col_format_range_cache
        .insert(range_id, format.clone());
    if let Some(style_id) = xlsx_style_id {
        cell_store
            .col_range_xlsx_style_id_cache
            .insert(range_id, style_id);
    }
    cell_store.rebuild_col_format_range_spatial_index();
}
