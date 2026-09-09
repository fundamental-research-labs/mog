use crate::snapshot::{
    ChangeKind, MutationResult, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint, SheetSettingsChange,
};
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::mutation;
use crate::storage::sheet::{order, properties, settings, view, visibility};
use cell_types::SheetId;
use value_types::ComputeError;

pub(in crate::storage::engine) fn create_sheet(
    engine: &mut ComputeEngine,
    name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    create_sheet_with_default_col_width(engine, name, None)
}

pub(in crate::storage::engine) fn create_sheet_with_default_col_width(
    engine: &mut ComputeEngine,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::CreateSheet {
        name: name.to_string(),
        default_col_width_px,
    })? {
        mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
        _ => Err(ComputeError::Eval {
            message: "Unexpected output from CreateSheet".to_string(),
        }),
    }
}

pub(in crate::storage::engine) fn create_default_sheet(
    engine: &mut ComputeEngine,
    name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    create_default_sheet_with_default_col_width(engine, name, None)
}

pub(in crate::storage::engine) fn create_default_sheet_with_default_col_width(
    engine: &mut ComputeEngine,
    name: &str,
    default_col_width_px: Option<f64>,
) -> Result<(String, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::CreateDefaultSheet {
        name: name.to_string(),
        default_col_width_px,
    })? {
        mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
        _ => Err(ComputeError::Eval {
            message: "Unexpected output from CreateDefaultSheet".to_string(),
        }),
    }
}

pub(in crate::storage::engine) fn delete_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::DeleteSheet {
        sheet_id: *sheet_id,
    })? {
        mutation::MutationOutput::Recalc(result) | mutation::MutationOutput::Plain(result) => {
            Ok(result)
        }
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn reorder_sheets(
    engine: &mut ComputeEngine,
    new_order: Vec<String>,
) -> Result<MutationResult, ComputeError> {
    let ids: Vec<SheetId> = new_order
        .iter()
        .map(|s| {
            SheetId::from_uuid_str(s).map_err(|e| ComputeError::Eval {
                message: format!("Invalid SheetId in reorder: {}", e),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    order::reorder_sheets(&mut engine.stores.storage, &ids)?;
    engine.security.bump_structure_version();
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

pub(in crate::storage::engine) fn copy_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    new_name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::CopySheet {
        source_sheet_id: *sheet_id,
        new_name: new_name.to_string(),
    })? {
        mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
        _ => Err(ComputeError::Eval {
            message: "Unexpected output from CopySheet".to_string(),
        }),
    }
}

pub(in crate::storage::engine) fn set_frozen_panes(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
) -> Result<MutationResult, ComputeError> {
    let old = view::get_frozen_panes(&engine.stores.storage, sheet_id);

    view::set_frozen_panes(&mut engine.stores.storage, sheet_id, rows, cols);

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
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    key: &str,
    value: bool,
) -> Result<MutationResult, ComputeError> {
    view::set_view_option(&mut engine.stores.storage, sheet_id, key, value);
    let settings = settings::get_sheet_settings_with_layout_metrics(
        &engine.stores.storage,
        sheet_id,
        engine.stores.layout_metrics,
    );
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
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
) -> Result<MutationResult, ComputeError> {
    view::set_scroll_position(&mut engine.stores.storage, sheet_id, top_row, left_col);
    let mut result = MutationResult::empty();
    result.scroll_position_changes.push(ScrollPositionChange {
        sheet_id: sheet_id.to_uuid_string(),
        top_row,
        left_col,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn move_sheet(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    new_index: u32,
) -> Result<MutationResult, ComputeError> {
    let old_index = {
        let order = engine.stores.storage.sheet_order();
        order
            .iter()
            .position(|id| id == sheet_id)
            .map(|i| i as i32)
            .unwrap_or(-1)
    };

    order::move_sheet(&mut engine.stores.storage, sheet_id, new_index);

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
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    color: Option<String>,
) -> Result<MutationResult, ComputeError> {
    let old_color =
        properties::get_sheet_meta(&engine.stores.storage, sheet_id).and_then(|m| m.tab_color);
    visibility::set_tab_color(&mut engine.stores.storage, sheet_id, color.as_deref());
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
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    hidden: bool,
) -> Result<MutationResult, ComputeError> {
    visibility::set_sheet_hidden(&mut engine.stores.storage, sheet_id, hidden);

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
    let hint = if hidden {
        SheetLifecycleRuntimeHint::reconcile()
    } else {
        SheetLifecycleRuntimeHint::focus(*sheet_id)
    };
    result.sheet_lifecycle_runtime_hint = Some(hint);

    Ok(result)
}

pub(in crate::storage::engine) fn set_sheet_enable_calculation(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    enabled: bool,
) -> Result<MutationResult, ComputeError> {
    visibility::set_sheet_enable_calculation(&mut engine.stores.storage, sheet_id, enabled);

    engine.cell_store.set_enable_calculation(sheet_id, enabled);

    let mut result = MutationResult::empty();
    result.sheet_changes.push(SheetChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        field: SheetChangeField::EnableCalculation,
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

pub(in crate::storage::engine) fn set_sheet_visibility(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    state: &str,
) -> Result<MutationResult, ComputeError> {
    visibility::set_sheet_visibility(&mut engine.stores.storage, sheet_id, state);

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
    let hint = if hidden {
        SheetLifecycleRuntimeHint::reconcile()
    } else {
        SheetLifecycleRuntimeHint::focus(*sheet_id)
    };
    result.sheet_lifecycle_runtime_hint = Some(hint);

    Ok(result)
}

pub(in crate::storage::engine) fn get_sheet_visibility(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Result<String, ComputeError> {
    Ok(visibility::get_sheet_visibility(
        &engine.stores.storage,
        sheet_id,
    ))
}
