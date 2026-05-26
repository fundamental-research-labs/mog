//! Split-view configuration — mutually exclusive with frozen panes.

use std::sync::Arc;

use yrs::{Any, Doc, Map, MapRef, Origin, Transact};

use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::sheet::SplitViewConfig;

use super::yrs_helpers::{
    KEY_FROZEN_COLS, KEY_FROZEN_ROWS, KEY_SPLIT_CONFIG, get_meta_map, meta_string,
};

/// Get split view configuration for a sheet.
pub(crate) fn get_split_config(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Option<SplitViewConfig> {
    let txn = doc.transact();
    let meta = get_meta_map(&txn, sheets, sheet_id)?;
    let s = meta_string(&txn, &meta, KEY_SPLIT_CONFIG)?;
    serde_json::from_str(&s).ok()
}

/// Set split view configuration. Clears frozen panes when setting a split
/// (split and freeze are mutually exclusive).
pub(crate) fn set_split_config(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: Option<&SplitViewConfig>,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(meta) = get_meta_map(&txn, sheets, sheet_id) {
        match config {
            Some(cfg) => {
                // SAFETY: serializing a struct with #[derive(Serialize)]; no map keys or non-finite floats.
                let json = serde_json::to_string(cfg).expect("serialize split config");
                meta.insert(
                    &mut txn,
                    KEY_SPLIT_CONFIG,
                    Any::String(Arc::from(json.as_str())),
                );
                // Clear frozen panes for mutual exclusivity
                meta.insert(&mut txn, KEY_FROZEN_ROWS, Any::Number(0.0));
                meta.insert(&mut txn, KEY_FROZEN_COLS, Any::Number(0.0));
            }
            None => {
                meta.remove(&mut txn, KEY_SPLIT_CONFIG);
            }
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;
    use crate::storage::sheet::view::{get_frozen_panes, set_frozen_panes};
    use domain_types::domain::sheet::{FrozenPanes, SplitDirection};

    #[test]
    fn test_split_view() {
        let (storage, _mirror, sid) = setup();
        assert!(get_split_config(storage.doc(), storage.sheets(), &sid).is_none());

        let config = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 5,
            vertical_position: 3,
        };
        set_split_config(storage.doc(), storage.sheets(), &sid, Some(&config));
        assert_eq!(
            get_split_config(storage.doc(), storage.sheets(), &sid),
            Some(config.clone())
        );

        // Remove
        set_split_config(storage.doc(), storage.sheets(), &sid, None);
        assert!(get_split_config(storage.doc(), storage.sheets(), &sid).is_none());
    }

    #[test]
    fn test_split_clears_frozen_panes() {
        let (storage, _mirror, sid) = setup();
        set_frozen_panes(storage.doc(), storage.sheets(), &sid, 3, 2);
        assert_eq!(
            get_frozen_panes(storage.doc(), storage.sheets(), &sid),
            FrozenPanes { rows: 3, cols: 2 }
        );

        let config = SplitViewConfig {
            direction: SplitDirection::Horizontal,
            horizontal_position: 10,
            vertical_position: 0,
        };
        set_split_config(storage.doc(), storage.sheets(), &sid, Some(&config));

        // Frozen panes should be cleared
        assert_eq!(
            get_frozen_panes(storage.doc(), storage.sheets(), &sid),
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
