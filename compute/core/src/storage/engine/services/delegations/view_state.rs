use crate::snapshot::{
    ChangeKind, MutationResult, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetSettingsChange, SplitConfigChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{settings, split_view, view};
use cell_types::SheetId;
use domain_types::domain::sheet::SplitViewConfig;
use value_types::ComputeError;

// -------------------------------------------------------------------
// Split view
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_split_config(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<SplitViewConfig> {
    split_view::get_split_config(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_split_config(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: Option<&SplitViewConfig>,
) -> Result<MutationResult, ComputeError> {
    let old_frozen =
        view::get_frozen_panes(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    split_view::set_split_config(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        config,
    );
    let mut result = MutationResult::empty();
    let kind = if config.is_some() {
        ChangeKind::Set
    } else {
        ChangeKind::Removed
    };
    result.split_config_changes.push(SplitConfigChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind,
        config: config.cloned(),
    });
    if config.is_some() && (old_frozen.rows != 0 || old_frozen.cols != 0) {
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_id.to_uuid_string(),
            kind: ChangeKind::Set,
            field: SheetChangeField::Frozen,
            frozen_rows: Some(0),
            old_frozen_rows: Some(old_frozen.rows),
            frozen_cols: Some(0),
            old_frozen_cols: Some(old_frozen.cols),
            name: None,
            old_name: None,
            index: None,
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            color: None,
            old_color: None,
        });
    }
    Ok(result)
}

// -------------------------------------------------------------------
// Frozen panes
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_frozen_panes(
    stores: &EngineStores,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
) -> Result<MutationResult, ComputeError> {
    let old = view::get_frozen_panes(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    view::set_frozen_panes(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        rows,
        cols,
    );
    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::Frozen,
        frozen_rows: Some(rows),
        old_frozen_rows: Some(old.rows),
        frozen_cols: Some(cols),
        old_frozen_cols: Some(old.cols),
        name: None,
        old_name: None,
        index: None,
        old_index: None,
        hidden: None,
        source_sheet_id: None,
        color: None,
        old_color: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_view_option(
    stores: &EngineStores,
    sheet_id: &SheetId,
    key: &str,
    value: bool,
) -> Result<MutationResult, ComputeError> {
    view::set_view_option(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        key,
        value,
    );
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: key.to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_scroll_position(
    stores: &EngineStores,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
) -> Result<MutationResult, ComputeError> {
    view::set_scroll_position(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        top_row,
        left_col,
    );
    let mut result = MutationResult::empty();
    result.scroll_position_changes.push(ScrollPositionChange {
        sheet_id: sheet_id.to_uuid_string(),
        top_row,
        left_col,
    });
    Ok(result)
}
