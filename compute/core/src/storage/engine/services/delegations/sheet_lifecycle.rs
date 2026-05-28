use crate::snapshot::{
    ChangeKind, MutationResult, SheetChange, SheetChangeField, SheetLifecycleRuntimeHint,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{order, properties, visibility};
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn move_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
    new_index: u32,
) -> Result<MutationResult, ComputeError> {
    let old_index = {
        let order = stores.storage.sheet_order();
        order
            .iter()
            .position(|id| id == sheet_id)
            .map(|i| i as i32)
            .unwrap_or(-1)
    };

    order::move_sheet(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        sheet_id,
        new_index,
    );

    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::Order,
        name: None,
        old_name: None,
        index: Some(new_index as i32),
        old_index: Some(old_index),
        hidden: None,
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_tab_color(
    stores: &EngineStores,
    sheet_id: &SheetId,
    color: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    // Read old color before mutation
    let old_color =
        properties::get_sheet_meta(stores.storage.doc(), stores.storage.sheets(), sheet_id)
            .and_then(|m| m.tab_color);
    visibility::set_tab_color(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        color,
    );
    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::TabColor,
        name: None,
        old_name: None,
        index: None,
        old_index: None,
        hidden: None,
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: color.map(|c| c.to_string()),
        old_color,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_sheet_hidden(
    stores: &EngineStores,
    sheet_id: &SheetId,
    hidden: bool,
) -> Result<MutationResult, ComputeError> {
    visibility::set_sheet_hidden(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        hidden,
    );
    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::Hidden,
        name: None,
        old_name: None,
        index: None,
        old_index: None,
        hidden: Some(hidden),
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    });
    result.sheet_lifecycle_runtime_hint = Some(if hidden {
        SheetLifecycleRuntimeHint::reconcile()
    } else {
        SheetLifecycleRuntimeHint::focus(*sheet_id)
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_sheet_visibility(
    stores: &EngineStores,
    sheet_id: &SheetId,
    state: &str,
) -> Result<MutationResult, ComputeError> {
    visibility::set_sheet_visibility(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        state,
    );
    let hidden = state == "hidden" || state == "veryHidden";
    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::Visibility,
        name: None,
        old_name: None,
        index: None,
        old_index: None,
        hidden: Some(hidden),
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    });
    result.sheet_lifecycle_runtime_hint = Some(if hidden {
        SheetLifecycleRuntimeHint::reconcile()
    } else {
        SheetLifecycleRuntimeHint::focus(*sheet_id)
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_sheet_visibility(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> String {
    visibility::get_sheet_visibility(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn reorder_sheets(
    stores: &mut EngineStores,
    new_order: &[String],
) -> Result<MutationResult, ComputeError> {
    let ids: Vec<SheetId> = new_order
        .iter()
        .map(|s| {
            SheetId::from_uuid_str(s).map_err(|e| ComputeError::Eval {
                message: format!("Invalid SheetId in reorder: {}", e),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    order::reorder_sheets(stores.storage.doc(), stores.storage.workbook_map(), &ids)?;
    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: String::new(),
        kind: ChangeKind::Set,
        field: SheetChangeField::Order,
        name: None,
        old_name: None,
        index: None,
        old_index: None,
        hidden: None,
        source_sheet_id: None,
        frozen_rows: None,
        old_frozen_rows: None,
        frozen_cols: None,
        old_frozen_cols: None,
        color: None,
        old_color: None,
    });
    Ok(result)
}
