//! Native worksheet visibility, tab color, and calculation toggle.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::SheetState;

pub(crate) fn set_tab_color(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    color: Option<&str>,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, properties);

    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    if let Some(color) = color {
        let properties = meta.properties.get_or_insert_with(Default::default);
        let hex = color.strip_prefix('#').unwrap_or(color);
        let argb = if hex.len() == 6 {
            format!("FF{hex}")
        } else {
            hex.to_owned()
        };
        properties.tab_color = Some(ooxml_types::styles::ColorDef::Rgb {
            val: argb,
            tint: None,
        });
    } else if let Some(properties) = meta.properties.as_mut() {
        properties.tab_color = None;
    }
}

pub(crate) fn is_sheet_hidden(storage: &WorkbookStorage, sheet_id: &SheetId) -> bool {
    storage
        .sheet_metadata
        .get(sheet_id)
        .is_some_and(|meta| meta.visibility != SheetState::Visible)
}

pub(crate) fn set_sheet_hidden(storage: &mut WorkbookStorage, sheet_id: &SheetId, hidden: bool) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, visibility);

    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.visibility = if hidden {
            SheetState::Hidden
        } else {
            SheetState::Visible
        };
    }
}

pub(crate) fn is_sheet_calculation_enabled(storage: &WorkbookStorage, sheet_id: &SheetId) -> bool {
    storage
        .sheet_metadata
        .get(sheet_id)
        .is_none_or(|meta| meta.enable_calculation)
}

pub(crate) fn set_sheet_enable_calculation(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    enabled: bool,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        enable_calculation
    );

    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.enable_calculation = enabled;
    }
}

pub(crate) fn set_sheet_visibility(storage: &mut WorkbookStorage, sheet_id: &SheetId, state: &str) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, visibility);

    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.visibility = match state {
            "hidden" => SheetState::Hidden,
            "veryHidden" => SheetState::VeryHidden,
            _ => SheetState::Visible,
        };
    }
}

pub(crate) fn get_sheet_visibility(storage: &WorkbookStorage, sheet_id: &SheetId) -> String {
    match storage
        .sheet_metadata
        .get(sheet_id)
        .map(|meta| &meta.visibility)
    {
        Some(SheetState::Hidden) => "hidden",
        Some(SheetState::VeryHidden) => "veryHidden",
        _ => "visible",
    }
    .to_owned()
}

pub(crate) fn count_visible_sheets(storage: &WorkbookStorage) -> u32 {
    get_visible_sheets(storage).len() as u32
}

pub(crate) fn get_visible_sheets(storage: &WorkbookStorage) -> Vec<SheetId> {
    storage
        .sheet_order()
        .into_iter()
        .filter(|sid| {
            storage
                .sheet_metadata
                .get(sid)
                .is_some_and(|meta| meta.visibility == SheetState::Visible)
        })
        .collect()
}

pub(crate) fn get_hidden_sheets(storage: &WorkbookStorage) -> Vec<SheetId> {
    storage
        .sheet_order()
        .into_iter()
        .filter(|sid| is_sheet_hidden(storage, sid))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cells::CellStore;
    use crate::storage::WorkbookStorage;
    use crate::storage::sheet::properties::get_sheet_meta;
    use crate::storage::sheet::test_support::{make_sheet_id, setup};

    #[test]
    fn test_tab_color() {
        let (mut storage, _store, sid) = setup();

        set_tab_color(&mut storage, &sid, Some("#4285f4"));
        let meta = get_sheet_meta(&storage, &sid).unwrap();
        assert_eq!(meta.tab_color, Some("#4285f4".to_string()));

        set_tab_color(&mut storage, &sid, None);
        let meta = get_sheet_meta(&storage, &sid).unwrap();
        assert!(meta.tab_color.is_none());
    }

    #[test]
    fn test_sheet_hidden() {
        let (mut storage, _store, sid) = setup();
        assert!(!get_sheet_meta(&storage, &sid).unwrap().hidden);

        set_sheet_hidden(&mut storage, &sid, true);
        assert!(get_sheet_meta(&storage, &sid).unwrap().hidden);

        set_sheet_hidden(&mut storage, &sid, false);
        assert!(!get_sheet_meta(&storage, &sid).unwrap().hidden);
    }

    #[test]
    fn test_count_visible_sheets() {
        let mut storage = WorkbookStorage::new();
        let mut cell_store = CellStore::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut cell_store, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut cell_store, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut cell_store, s3, "C", 10, 5).unwrap();

        assert_eq!(count_visible_sheets(&storage), 3);

        set_sheet_hidden(&mut storage, &s2, true);
        assert_eq!(count_visible_sheets(&storage), 2);
    }

    #[test]
    fn test_visible_and_hidden_sheets() {
        let mut storage = WorkbookStorage::new();
        let mut cell_store = CellStore::new();
        let s1 = make_sheet_id(1);
        let s2 = make_sheet_id(2);
        let s3 = make_sheet_id(3);
        storage.add_sheet(&mut cell_store, s1, "A", 10, 5).unwrap();
        storage.add_sheet(&mut cell_store, s2, "B", 10, 5).unwrap();
        storage.add_sheet(&mut cell_store, s3, "C", 10, 5).unwrap();

        set_sheet_hidden(&mut storage, &s2, true);

        assert_eq!(get_visible_sheets(&storage), vec![s1, s3]);
        assert_eq!(get_hidden_sheets(&storage), vec![s2]);
    }
}
