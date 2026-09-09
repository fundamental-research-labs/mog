use super::*;

pub(crate) fn capture_cell_metadata(storage: &WorkbookStorage, id: CellId) {
    if storage.history.owns_cell(id) {
        return;
    }
    capture_value(
        storage,
        MetadataKey::Cell(id),
        |storage, key| {
            let MetadataKey::Cell(id) = key else {
                unreachable!()
            };
            storage.cell_metadata.get(id)
        },
        |storage, key, old| {
            let MetadataKey::Cell(id) = key else {
                unreachable!()
            };
            let current = storage.cell_metadata.remove(id);
            if let Some(value) = old.take() {
                storage.cell_metadata.insert(*id, value);
            }
            *old = current;
        },
        MetadataImpact::Workbook,
    );
}

#[derive(Debug)]
struct CellPropertiesPatch {
    sheet: SheetId,
    cell: CellId,
    old: Option<crate::storage::properties::StoredCellProperties>,
}
impl MetadataSwap for CellPropertiesPatch {
    fn is_changed(&self, storage: &WorkbookStorage, _: &CellMirror) -> bool {
        storage
            .sheet_metadata
            .get(&self.sheet)
            .and_then(|meta| meta.cell_properties.get(&self.cell))
            != self.old.as_ref()
    }
    fn rebase_ui_format(
        &mut self,
        storage: &WorkbookStorage,
        mirror: &CellMirror,
        sheet: SheetId,
        ranges: &[(u32, u32, u32, u32)],
        format: &domain_types::CellFormat,
    ) {
        if self.sheet != sheet {
            return;
        }
        let Some(position) = mirror
            .get_sheet(&sheet)
            .and_then(|source| source.position_of(&self.cell))
        else {
            return;
        };
        if ranges.iter().any(|&(sr, sc, er, ec)| {
            sr <= position.row()
                && position.row() <= er
                && sc <= position.col()
                && position.col() <= ec
        }) {
            crate::storage::properties::StoredCellProperties::rebase_format(
                &mut self.old,
                &storage.metadata.style_palette,
                format,
            );
        }
    }
    fn swap(
        &mut self,
        storage: &mut WorkbookStorage,
        mirror: &mut CellMirror,
        effects: &mut HistoryEffects,
    ) {
        effects.metadata_events.record(
            &MetadataKey::CellProperties(self.sheet, self.cell),
            storage,
            mirror,
        );
        if let Some(meta) = storage.sheet_metadata.get_mut(&self.sheet) {
            let current = meta.cell_properties.remove(&self.cell);
            if let Some(value) = self.old.take() {
                meta.cell_properties.insert(self.cell, value);
            }
            self.old = current;
        }
        effects.sheets.insert(self.sheet);
    }
}

pub(crate) fn capture_cell_properties(storage: &WorkbookStorage, sheet: SheetId, id: CellId) {
    if !storage.history.is_active() || storage.history.owns_sheet(sheet) {
        return;
    }
    storage.history.record_once(
        HistoryKey::Metadata(MetadataKey::CellProperties(sheet, id)),
        || {
            HistoryPatch::Metadata(MetadataPatch(Box::new(CellPropertiesPatch {
                sheet,
                cell: id,
                old: storage
                    .sheet_metadata
                    .get(&sheet)
                    .and_then(|meta| meta.cell_properties.get(&id))
                    .cloned(),
            })))
        },
    );
}

pub(crate) fn capture_cell_annotation(storage: &WorkbookStorage, sheet: SheetId, id: CellId) {
    capture_value(
        storage,
        MetadataKey::CellAnnotation(sheet, id),
        |storage, key| {
            let MetadataKey::CellAnnotation(sheet, id) = key else {
                unreachable!()
            };
            storage.sheet_metadata.get(sheet)?.cell_annotations.get(id)
        },
        |storage, key, old| {
            let MetadataKey::CellAnnotation(sheet, id) = key else {
                unreachable!()
            };
            if let Some(meta) = storage.sheet_metadata.get_mut(sheet) {
                let current = meta.cell_annotations.remove(id);
                if let Some(value) = old.take() {
                    meta.cell_annotations.insert(*id, value);
                }
                *old = current;
            }
        },
        MetadataImpact::Sheet(sheet),
    );
}
