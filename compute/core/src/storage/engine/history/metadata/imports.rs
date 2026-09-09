//! Imported workbook additions retain only the newly appended native values.

use domain_types::CellFormat;

use super::*;

#[derive(Debug)]
struct StylePaletteAppend {
    start: usize,
    removed: Option<Vec<CellFormat>>,
}

impl MetadataSwap for StylePaletteAppend {
    fn is_changed(&self, storage: &WorkbookStorage, _: &CellStore) -> bool {
        storage.metadata.style_palette.len() != self.start
    }

    fn swap(
        &mut self,
        storage: &mut WorkbookStorage,
        cell_store: &mut CellStore,
        effects: &mut HistoryEffects,
    ) {
        if let Some(mut values) = self.removed.take() {
            storage.metadata.style_palette.append(&mut values);
        } else {
            self.removed = Some(storage.metadata.style_palette.split_off(self.start));
        }
        effects.format_rects.extend(
            cell_store
                .sheet_ids()
                .map(|sheet| (*sheet, 0, 0, u32::MAX, u32::MAX)),
        );
        MetadataImpact::Settings.mark(cell_store, effects);
    }
}

/// Called before merging a selected workbook's palette. Existing style IDs and
/// values are unchanged by this append-only operation.
pub(crate) fn capture_style_palette_append(storage: &WorkbookStorage) {
    if !storage.history.is_active() {
        return;
    }
    storage.history.record_once(
        HistoryKey::Metadata(MetadataKey::WorkbookField("style_palette")),
        || {
            HistoryPatch::Metadata(MetadataPatch(Box::new(StylePaletteAppend {
                start: storage.metadata.style_palette.len(),
                removed: None,
            })))
        },
    );
}

/// Record a custom style that the import merge has just created. The caller
/// establishes absence before the merge, which may assign a collision-free name.
pub(crate) fn capture_created_custom_table_style(storage: &WorkbookStorage, id: &str) {
    if !storage.history.is_active() {
        return;
    }
    let key = MetadataKey::WorkbookEntry("custom_table_styles", id.to_owned());
    storage
        .history
        .record_once(HistoryKey::Metadata(key.clone()), || {
            HistoryPatch::Metadata(MetadataPatch(Box::new(StoredValue {
                old: None,
                key,
                read: |storage, key| {
                    let MetadataKey::WorkbookEntry(_, id) = key else {
                        unreachable!()
                    };
                    storage.metadata.custom_table_styles.get(id)
                },
                swap_value: |storage, key, old| {
                    let MetadataKey::WorkbookEntry(_, id) = key else {
                        unreachable!()
                    };
                    let current = storage.metadata.custom_table_styles.remove(id);
                    if let Some(value) = old.take() {
                        storage
                            .metadata
                            .custom_table_styles
                            .insert(id.clone(), value);
                    }
                    *old = current;
                },
                impact: MetadataImpact::Settings,
            })))
        });
}
