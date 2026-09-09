//! Split-view configuration, mutually exclusive with frozen panes.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::sheet::SplitViewConfig;

pub(crate) fn get_split_config(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> Option<SplitViewConfig> {
    storage.sheet_metadata.get(sheet_id)?.split_config.clone()
}

pub(crate) fn set_split_config(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    config: Option<&SplitViewConfig>,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        split_config
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, view.pane);
    if let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) {
        meta.split_config = config.cloned();
        if config.is_some() {
            meta.view.pane = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;
    use crate::storage::sheet::view::{get_frozen_panes, set_frozen_panes};
    use domain_types::domain::sheet::{FrozenPanes, SplitDirection};

    #[test]
    fn test_split_view() {
        let (mut storage, _mirror, sid) = setup();
        assert!(get_split_config(&storage, &sid).is_none());

        let config = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 5,
            vertical_position: 3,
        };
        set_split_config(&mut storage, &sid, Some(&config));
        assert_eq!(get_split_config(&storage, &sid), Some(config.clone()));

        // Remove
        set_split_config(&mut storage, &sid, None);
        assert!(get_split_config(&storage, &sid).is_none());
    }

    #[test]
    fn test_split_clears_frozen_panes() {
        let (mut storage, _mirror, sid) = setup();
        set_frozen_panes(&mut storage, &sid, 3, 2);
        assert_eq!(
            get_frozen_panes(&storage, &sid),
            FrozenPanes { rows: 3, cols: 2 }
        );

        let config = SplitViewConfig {
            direction: SplitDirection::Horizontal,
            horizontal_position: 10,
            vertical_position: 0,
        };
        set_split_config(&mut storage, &sid, Some(&config));

        // Frozen panes should be cleared
        assert_eq!(
            get_frozen_panes(&storage, &sid),
            FrozenPanes { rows: 0, cols: 0 }
        );
    }

    #[test]
    fn test_split_config_serde_roundtrip() {
        let config = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 10,
            vertical_position: 5,
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: SplitViewConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }
}
