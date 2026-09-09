//! Typed field and keyed-entry capture helpers shared by native mutators.

macro_rules! capture_sheet_field {
    ($storage:expr, $sheet:expr, $($field:ident).+) => {{
        let storage = &$storage;
        let sid = $sheet;
        $crate::storage::engine::history::metadata::capture_value(
            storage,
            $crate::storage::engine::history::metadata::MetadataKey::SheetField(sid, stringify!($($field).+)),
            |storage, key| {
                let $crate::storage::engine::history::metadata::MetadataKey::SheetField(sid, _) = key else { unreachable!() };
                Some(&storage.sheet_metadata.get(sid)?.$($field).+)
            },
            |storage, key, old| {
                let $crate::storage::engine::history::metadata::MetadataKey::SheetField(sid, _) = key else { unreachable!() };
                if let (Some(sheet), Some(value)) = (storage.sheet_metadata.get_mut(sid), old.as_mut()) {
                    std::mem::swap(&mut sheet.$($field).+, value);
                }
            },
            $crate::storage::engine::history::metadata::MetadataImpact::Sheet(sid),
        );
    }};
}
pub(crate) use capture_sheet_field;

macro_rules! capture_workbook_field {
    ($storage:expr, $($field:ident).+) => {{
        $crate::storage::engine::history::metadata::capture_value(
            &$storage,
            $crate::storage::engine::history::metadata::MetadataKey::WorkbookField(stringify!($($field).+)),
            |storage, _| Some(&storage.metadata.$($field).+),
            |storage, _, old| { std::mem::swap(&mut storage.metadata.$($field).+, old.as_mut().expect("workbook field exists")); },
            $crate::storage::engine::history::metadata::MetadataImpact::Settings,
        );
    }};
}
pub(crate) use capture_workbook_field;

macro_rules! capture_sheet_entry {
    ($storage:expr, $sheet:expr, $($field:ident).+, $id:expr) => {{
        let storage = &$storage;
        if storage.history.is_active() {
            let sid = $sheet;
            $crate::storage::engine::history::metadata::capture_value(
                storage,
                $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(sid, stringify!($($field).+), $id.to_string()),
                |storage, key| {
                    let $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(sid, _, id) = key else { unreachable!() };
                    storage.sheet_metadata.get(sid)?.$($field).+.get(id)
                },
                |storage, key, old| {
                    let $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(sid, _, id) = key else { unreachable!() };
                    if let Some(sheet) = storage.sheet_metadata.get_mut(sid) {
                        let current = sheet.$($field).+.remove(id);
                        if let Some(value) = old.take() { sheet.$($field).+.insert(id.clone(), value); }
                        *old = current;
                    }
                },
                $crate::storage::engine::history::metadata::MetadataImpact::SheetCalculation(sid),
            );
        }
    }};
}
pub(crate) use capture_sheet_entry;

macro_rules! capture_workbook_entry {
    ($storage:expr, $($field:ident).+, $id:expr) => {
        $crate::storage::engine::history::metadata::capture_workbook_entry!($storage, $($field).+, $id, $crate::storage::engine::history::metadata::MetadataImpact::Settings)
    };
    ($storage:expr, $($field:ident).+, $id:expr, $impact:expr) => {{
        let storage = &$storage;
        if storage.history.is_active() {
            $crate::storage::engine::history::metadata::capture_value(
                storage,
                $crate::storage::engine::history::metadata::MetadataKey::WorkbookEntry(stringify!($($field).+), $id.to_string()),
                |storage, key| {
                    let $crate::storage::engine::history::metadata::MetadataKey::WorkbookEntry(_, id) = key else { unreachable!() };
                    storage.metadata.$($field).+.get(id)
                },
                |storage, key, old| {
                    let $crate::storage::engine::history::metadata::MetadataKey::WorkbookEntry(_, id) = key else { unreachable!() };
                    let current = storage.metadata.$($field).+.remove(id);
                    if let Some(value) = old.take() { storage.metadata.$($field).+.insert(id.clone(), value); }
                    *old = current;
                },
                $impact,
            );
        }
    }};
}
pub(crate) use capture_workbook_entry;

/// Capture authored settings independently so UI selection/custom values survive replay.
pub(crate) fn capture_workbook_settings(storage: &crate::storage::WorkbookStorage) {
    if !storage.history.is_active() {
        return;
    }
    capture_workbook_field!(storage, properties);
    capture_workbook_field!(storage, protection);
    capture_workbook_field!(storage, settings.show_horizontal_scrollbar);
    capture_workbook_field!(storage, settings.show_vertical_scrollbar);
    capture_workbook_field!(storage, settings.auto_hide_scroll_bars);
    capture_workbook_field!(storage, settings.show_tab_strip);
    capture_workbook_field!(storage, settings.show_formula_bar);
    capture_workbook_field!(storage, settings.allow_sheet_reorder);
    capture_workbook_field!(storage, settings.auto_fit_on_double_click);
    capture_workbook_field!(storage, settings.show_cut_copy_indicator);
    capture_workbook_field!(storage, settings.allow_drag_fill);
    capture_workbook_field!(storage, settings.enter_key_direction);
    capture_workbook_field!(storage, settings.allow_cell_drag_drop);
    capture_workbook_field!(storage, settings.theme_id);
    capture_workbook_field!(storage, settings.theme_fonts_id);
    capture_workbook_field!(storage, settings.culture);
    capture_workbook_field!(storage, settings.is_workbook_protected);
    capture_workbook_field!(storage, settings.workbook_protection_password_hash);
    capture_workbook_field!(storage, settings.workbook_protection_options);
    capture_workbook_field!(storage, settings.calculation_settings);
    capture_workbook_field!(storage, settings.date1904);
    capture_workbook_field!(storage, settings.default_table_style_id);
    capture_workbook_field!(storage, settings.automatic_conversion_policy);
}

macro_rules! capture_sheet_vector_entry {
    ($storage:expr, $sheet:expr, $($field:ident).+, $id:expr, $value:ident => $identity:expr) => {{
        let storage = &$storage;
        if storage.history.is_active() {
            let sid = $sheet;
            $crate::storage::engine::history::metadata::capture_vector_entry(
                storage,
                $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(sid, stringify!($($field).+), $id.to_string()),
                |storage,key| {
                    let $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(sid,_,_) = key else { unreachable!() };
                    Some(&storage.sheet_metadata.get(sid)?.$($field).+)
                },
                |storage,key| {
                    let $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(sid,_,_) = key else { unreachable!() };
                    Some(&mut storage.sheet_metadata.get_mut(sid)?.$($field).+)
                },
                |$value,key| {
                    let $crate::storage::engine::history::metadata::MetadataKey::SheetEntry(_,_,id) = key else { unreachable!() };
                    $identity == *id
                },
                |$value| ($identity).to_string(),
                $crate::storage::engine::history::metadata::MetadataImpact::Sheet(sid),
            );
        }
    }};
}
pub(crate) use capture_sheet_vector_entry;

pub(crate) fn capture_sparkline(
    storage: &crate::storage::WorkbookStorage,
    sheet: cell_types::SheetId,
    id: &str,
) {
    use super::*;
    if !storage.history.is_active() {
        return;
    }
    capture_value(
        storage,
        MetadataKey::SheetEntry(sheet, "sparklines.items", id.to_owned()),
        |storage, key| {
            let MetadataKey::SheetEntry(sheet, _, id) = key else {
                unreachable!()
            };
            storage.sheet_metadata.get(sheet)?.sparklines.items.get(id)
        },
        |storage, key, old| {
            let MetadataKey::SheetEntry(sheet, _, id) = key else {
                unreachable!()
            };
            if let Some(meta) = storage.sheet_metadata.get_mut(sheet) {
                let current = meta.sparklines.items.remove(id);
                if let Some(value) = old.take() {
                    meta.sparklines.items.insert(id.clone(), value);
                }
                *old = current;
            }
        },
        MetadataImpact::Sheet(sheet),
    );
}

pub(crate) fn capture_validation_replacement(
    storage: &crate::storage::WorkbookStorage,
    sheet: cell_types::SheetId,
    next: &[crate::storage::sheet::schemas::StoredValidation],
) {
    if !storage.history.is_active() {
        return;
    }
    let Some(meta) = storage.sheet_metadata.get(&sheet) else {
        return;
    };
    let new: rustc_hash::FxHashMap<_, _> = next.iter().map(|entry| (&entry.id, entry)).collect();
    for entry in &meta.validations.rules {
        if new.get(&entry.id).is_none_or(|value| **value != *entry) {
            capture_sheet_vector_entry!(storage,sheet,validations.rules,entry.id,value=>value.id);
        }
    }
    let old: rustc_hash::FxHashSet<_> = meta
        .validations
        .rules
        .iter()
        .map(|entry| &entry.id)
        .collect();
    for entry in next {
        if !old.contains(&entry.id) {
            capture_sheet_vector_entry!(storage,sheet,validations.rules,entry.id,value=>value.id);
        }
    }
    capture_sheet_field!(storage, sheet, validations.declared_count);
}
