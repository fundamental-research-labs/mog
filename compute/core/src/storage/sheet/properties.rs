//! Native worksheet identity and default dimensions.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::domain::sheet::SheetMeta;

pub(crate) fn rename_sheet(storage: &mut WorkbookStorage, sheet_id: &SheetId, name: &str) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, name);
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.name = name.to_owned();
    }
}

pub(crate) fn get_sheet_meta(storage: &WorkbookStorage, sheet_id: &SheetId) -> Option<SheetMeta> {
    let meta = storage.sheet_metadata.get(sheet_id)?;
    let frozen = super::view::get_frozen_panes(storage, sheet_id);
    let indexed_colors = storage
        .metadata
        .stylesheet
        .as_ref()
        .and_then(|stylesheet| stylesheet.indexed_colors.as_ref());
    let tab_color = meta
        .properties
        .as_ref()
        .and_then(|properties| properties.tab_color.as_ref())
        .and_then(|color| {
            super::color::sheet_color_to_hex(color, storage.metadata.theme.as_ref(), indexed_colors)
        });
    Some(SheetMeta {
        id: id_to_hex(sheet_id.as_u128()).to_string(),
        name: meta.name.clone(),
        default_row_height: meta.format.default_row_height.unwrap_or(15.0),
        default_col_width: meta.format.default_col_width.unwrap_or(8.43),
        frozen_rows: frozen.rows,
        frozen_cols: frozen.cols,
        tab_color,
        hidden: meta.visibility != domain_types::SheetState::Visible,
    })
}

pub(crate) fn get_first_sheet_id(storage: &WorkbookStorage) -> Option<SheetId> {
    storage.sheet_order().first().copied()
}

pub(crate) fn get_sheet_name(storage: &WorkbookStorage, sheet_id: &SheetId) -> Option<String> {
    Some(storage.sheet_metadata.get(sheet_id)?.name.clone())
}

pub(crate) fn next_unique_sheet_name(storage: &WorkbookStorage, order: &[SheetId]) -> String {
    let existing: std::collections::HashSet<String> = order
        .iter()
        .filter_map(|sid| get_sheet_name(storage, sid).map(|name| name.to_lowercase()))
        .collect();
    let mut n = 1u32;
    loop {
        if !existing.contains(&format!("sheet{n}")) {
            return format!("Sheet{n}");
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::WorkbookStorage;
    use crate::storage::sheet::print::get_print_area;
    use crate::storage::sheet::protection::is_sheet_protected;
    use crate::storage::sheet::split_view::get_split_config;
    use crate::storage::sheet::test_support::{make_sheet_id, setup};
    use crate::storage::sheet::view::get_frozen_panes;
    use domain_types::domain::sheet::FrozenPanes;

    #[test]
    fn test_rename_sheet() {
        let (mut storage, _mirror, sid) = setup();
        assert_eq!(get_sheet_name(&storage, &sid), Some("Sheet1".to_string()));
        rename_sheet(&mut storage, &sid, "Renamed");
        assert_eq!(get_sheet_name(&storage, &sid), Some("Renamed".to_string()));
    }

    #[test]
    fn test_get_sheet_meta() {
        let (storage, _mirror, sid) = setup();
        let meta = get_sheet_meta(&storage, &sid).unwrap();
        assert_eq!(meta.name, "Sheet1");
        assert!(!meta.hidden);
        assert_eq!(meta.frozen_rows, 0);
        assert_eq!(meta.frozen_cols, 0);
        assert!(meta.tab_color.is_none());
    }

    #[test]
    fn test_get_first_sheet_id() {
        let (storage, _mirror, sid) = setup();
        assert_eq!(get_first_sheet_id(&storage), Some(sid));

        let empty = WorkbookStorage::new();
        assert_eq!(get_first_sheet_id(&empty), None);
    }

    #[test]
    fn test_get_sheet_name_nonexistent() {
        let storage = WorkbookStorage::new();
        assert!(get_sheet_name(&storage, &make_sheet_id(999)).is_none());
    }

    /// Spans multiple modules — exercises the default-state path for all
    /// public getters that may be called on a nonexistent SheetId.
    #[test]
    fn test_nonexistent_sheet_defaults() {
        let storage = WorkbookStorage::new();
        let sid = make_sheet_id(999);

        assert!(get_sheet_meta(&storage, &sid).is_none());
        assert!(get_sheet_name(&storage, &sid).is_none());
        assert_eq!(
            get_frozen_panes(&storage, &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );
        assert!(!is_sheet_protected(&storage, &sid));
        assert!(get_split_config(&storage, &sid).is_none());
        assert!(get_print_area(&storage, &sid).is_none());
    }
}
