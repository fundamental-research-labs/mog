use crate::snapshot::{
    ChangeKind, MutationResult, SheetChange, SheetChangeField, SplitConfigChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{split_view, view};
use cell_types::SheetId;
use domain_types::domain::sheet::SplitViewConfig;
use value_types::ComputeError;

pub(in crate::storage::engine) fn set_split_config(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    config: Option<&SplitViewConfig>,
) -> Result<MutationResult, ComputeError> {
    let old_frozen = view::get_frozen_panes(&stores.storage, sheet_id);
    split_view::set_split_config(&mut stores.storage, sheet_id, config);
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
