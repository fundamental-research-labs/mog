use super::*;

macro_rules! axis_capture {
    ($function:ident,$variant:ident,$id:ty,$field:ident) => {
        pub(crate) fn $function(storage: &WorkbookStorage, sheet: SheetId, id: $id) {
            capture_value(
                storage,
                MetadataKey::$variant(sheet, id),
                |storage, key| {
                    let MetadataKey::$variant(sheet, id) = key else {
                        unreachable!()
                    };
                    storage.sheet_metadata.get(sheet)?.dimensions.$field.get(id)
                },
                |storage, key, old| {
                    let MetadataKey::$variant(sheet, id) = key else {
                        unreachable!()
                    };
                    if let Some(meta) = storage.sheet_metadata.get_mut(sheet) {
                        let current = meta.dimensions.$field.remove(id);
                        if let Some(value) = old.take() {
                            meta.dimensions.$field.insert(*id, value);
                        }
                        *old = current;
                    }
                },
                MetadataImpact::Sheet(sheet),
            );
        }
    };
}
axis_capture!(capture_row, Row, RowId, rows);
axis_capture!(capture_column, Column, ColId, columns);

macro_rules! hidden_capture {
    ($function:ident,$variant:ident,$id:ty,$field:ident) => {
        pub(crate) fn $function(storage: &WorkbookStorage, sheet: SheetId, id: $id) {
            capture_value(
                storage,
                MetadataKey::$variant(sheet, id),
                |storage, key| {
                    let MetadataKey::$variant(sheet, id) = key else {
                        unreachable!()
                    };
                    storage
                        .sheet_metadata
                        .get(sheet)?
                        .dimensions
                        .$field
                        .contains(id)
                        .then_some(&true)
                },
                |storage, key, old| {
                    let MetadataKey::$variant(sheet, id) = key else {
                        unreachable!()
                    };
                    if let Some(meta) = storage.sheet_metadata.get_mut(sheet) {
                        let current = meta.dimensions.$field.remove(id).then_some(true);
                        if old.is_some() {
                            meta.dimensions.$field.insert(*id);
                        }
                        *old = current;
                    }
                },
                MetadataImpact::Sheet(sheet),
            );
        }
    };
}
hidden_capture!(capture_hidden_row, HiddenRow, RowId, manual_hidden_rows);
hidden_capture!(capture_hidden_column, HiddenColumn, ColId, hidden_columns);

pub(crate) fn capture_filter_hidden_rows(storage: &WorkbookStorage, sheet: SheetId, id: &str) {
    if !storage.history.is_active() {
        return;
    }
    capture_value(
        storage,
        MetadataKey::FilterHiddenRows(sheet, id.to_owned()),
        |storage, key| {
            let MetadataKey::FilterHiddenRows(sheet, id) = key else {
                unreachable!()
            };
            storage
                .sheet_metadata
                .get(sheet)?
                .dimensions
                .filter_hidden_rows
                .get(id)
        },
        |storage, key, old| {
            let MetadataKey::FilterHiddenRows(sheet, id) = key else {
                unreachable!()
            };
            if let Some(meta) = storage.sheet_metadata.get_mut(sheet) {
                let current = meta.dimensions.filter_hidden_rows.remove(id);
                if let Some(value) = old.take() {
                    meta.dimensions.filter_hidden_rows.insert(id.clone(), value);
                }
                *old = current;
            }
        },
        MetadataImpact::Sheet(sheet),
    );
}

pub(crate) fn capture_column_schema(storage: &WorkbookStorage, sheet: SheetId, id: ColId) {
    capture_value(
        storage,
        MetadataKey::ColumnSchema(sheet, id),
        |storage, key| {
            let MetadataKey::ColumnSchema(sheet, id) = key else {
                unreachable!()
            };
            storage.sheet_metadata.get(sheet)?.column_schemas.get(id)
        },
        |storage, key, old| {
            let MetadataKey::ColumnSchema(sheet, id) = key else {
                unreachable!()
            };
            if let Some(meta) = storage.sheet_metadata.get_mut(sheet) {
                let current = meta.column_schemas.remove(id);
                if let Some(value) = old.take() {
                    meta.column_schemas.insert(*id, value);
                }
                *old = current;
            }
        },
        MetadataImpact::SheetCalculation(sheet),
    );
}

/// Capture only sparse metadata whose durable axes have just been removed.
pub(crate) fn capture_pruned_axis_metadata(
    storage: &WorkbookStorage,
    sheet: SheetId,
    grid: &crate::identity::GridIndex,
) {
    if !storage.history.is_active() {
        return;
    }
    let Some(meta) = storage.sheet_metadata.get(&sheet) else {
        return;
    };
    for &id in meta
        .dimensions
        .rows
        .keys()
        .filter(|id| grid.row_index(id).is_none())
    {
        capture_row(storage, sheet, id);
    }
    for &id in meta
        .dimensions
        .columns
        .keys()
        .filter(|id| grid.col_index(id).is_none())
    {
        capture_column(storage, sheet, id);
    }
    for &id in meta
        .dimensions
        .manual_hidden_rows
        .iter()
        .filter(|id| grid.row_index(id).is_none())
    {
        capture_hidden_row(storage, sheet, id);
    }
    for &id in meta
        .dimensions
        .hidden_columns
        .iter()
        .filter(|id| grid.col_index(id).is_none())
    {
        capture_hidden_column(storage, sheet, id);
    }
    for (owner, rows) in &meta.dimensions.filter_hidden_rows {
        if rows.iter().any(|id| grid.row_index(id).is_none()) {
            capture_filter_hidden_rows(storage, sheet, owner);
        }
    }
    for &id in meta
        .column_schemas
        .keys()
        .filter(|id| grid.col_index(id).is_none())
    {
        capture_column_schema(storage, sheet, id);
    }
}

/// Capture metadata records whose cell anchors are about to be pruned.
pub(crate) fn capture_pruned_cell_metadata(
    storage: &crate::storage::WorkbookStorage,
    sheet: cell_types::SheetId,
    is_pruned: impl Fn(cell_types::CellId) -> bool,
) {
    if !storage.history.is_active() {
        return;
    }
    let Some(meta) = storage.sheet_metadata.get(&sheet) else {
        return;
    };
    for comment in &meta.comments {
        if comment.cell_ref.cell().is_some_and(&is_pruned) {
            capture_sheet_vector_entry!(storage,sheet,comments,comment.id,value=>value.id);
        }
    }
    for &id in meta.cell_annotations.keys().filter(|id| is_pruned(**id)) {
        capture_cell_annotation(storage, sheet, id);
    }
}
