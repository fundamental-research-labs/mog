#![allow(unused_imports, unused_variables)]
use crate::identity::GridIndex;
use crate::snapshot::{
    CellEdit, ChangeKind, MutationResult, NamedRangeChange, PageBreakChange, PrintAreaChange,
    PrintSettingsChange, PrintTitlesChange, RecalcResult, Scenario, ScenarioCreateInput,
    ScenarioUpdateInput, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint, SheetSettingsChange, SheetSnapshot,
};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::mutation::{EngineMutation, MutationOutput};
use crate::storage::engine::mutation_coordinator::SheetLifecycleHistoryHint;
use crate::storage::engine::{mutation, services};
use crate::storage::sheet::bindings;
use crate::storage::sheet::{
    order, print, properties, protection, settings, split_view, view, visibility,
};
use crate::storage::workbook::named_ranges;
use crate::what_if::scenarios;
use cell_types::{CellId, SheetId};
use compute_collab as sync;
use compute_document::hex::id_to_hex;
use compute_formats;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{
    PrintRange, PrintTitles, SheetProtectionOptions, SheetSettings, SplitViewConfig,
};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

pub(in crate::storage::engine) fn create_sheet(
    engine: &mut YrsComputeEngine,
    name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::CreateSheet {
        name: name.to_string(),
    })? {
        mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
        _ => Err(ComputeError::Eval {
            message: "Unexpected output from CreateSheet".to_string(),
        }),
    }
}

pub(in crate::storage::engine) fn create_default_sheet(
    engine: &mut YrsComputeEngine,
    name: &str,
) -> Result<(String, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::CreateDefaultSheet {
        name: name.to_string(),
    })? {
        mutation::MutationOutput::SheetId(hex, result) => Ok((hex, result)),
        _ => Err(ComputeError::Eval {
            message: "Unexpected output from CreateDefaultSheet".to_string(),
        }),
    }
}

pub(in crate::storage::engine) fn delete_sheet(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::DeleteSheet {
        sheet_id: *sheet_id,
    })? {
        mutation::MutationOutput::Recalc(result) | mutation::MutationOutput::Plain(result) => {
            Ok((serialize_multi_viewport_patches(&[]), result))
        }
        _ => Ok((
            serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(in crate::storage::engine) fn reorder_sheets(
    engine: &mut YrsComputeEngine,
    new_order: Vec<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let ids: Vec<SheetId> = new_order
        .iter()
        .map(|s| {
            SheetId::from_uuid_str(s).map_err(|e| ComputeError::Eval {
                message: format!("Invalid SheetId in reorder: {}", e),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    order::reorder_sheets(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
        &ids,
    )?;
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
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn copy_sheet(
    engine: &mut YrsComputeEngine,
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
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    rows: u32,
    cols: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let old = view::get_frozen_panes(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );

    view::set_frozen_panes(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
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
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_view_option(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    key: &str,
    value: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    view::set_view_option(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        key,
        value,
    );
    let settings = settings::get_sheet_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: key.to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_scroll_position(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    top_row: u32,
    left_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    view::set_scroll_position(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
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
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn move_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    new_index: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let old_index = {
        let order = engine.stores.storage.sheet_order();
        order
            .iter()
            .position(|id| id == sheet_id)
            .map(|i| i as i32)
            .unwrap_or(-1)
    };

    order::move_sheet(
        engine.stores.storage.doc(),
        engine.stores.storage.workbook_map(),
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
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_tab_color(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    color: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let old_color = properties::get_sheet_meta(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    )
    .and_then(|m| m.tab_color);
    visibility::set_tab_color(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        color.as_deref(),
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
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_sheet_hidden(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    hidden: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    visibility::set_sheet_hidden(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
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
    let hint = if hidden {
        SheetLifecycleRuntimeHint::reconcile()
    } else {
        SheetLifecycleRuntimeHint::focus(*sheet_id)
    };
    result.sheet_lifecycle_runtime_hint = Some(hint.clone());
    engine.record_sheet_lifecycle_history_hint(
        engine.mutation.undo_manager.undo_depth(),
        SheetLifecycleHistoryHint {
            undo: Some(SheetLifecycleRuntimeHint::reconcile()),
            redo: Some(hint),
        },
    );
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_sheet_enable_calculation(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    enabled: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    visibility::set_sheet_enable_calculation(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        enabled,
    );

    engine.mirror.set_enable_calculation(sheet_id, enabled);

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

    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_sheet_visibility(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    state: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    visibility::set_sheet_visibility(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
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
    let hint = if hidden {
        SheetLifecycleRuntimeHint::reconcile()
    } else {
        SheetLifecycleRuntimeHint::focus(*sheet_id)
    };
    result.sheet_lifecycle_runtime_hint = Some(hint.clone());
    engine.record_sheet_lifecycle_history_hint(
        engine.mutation.undo_manager.undo_depth(),
        SheetLifecycleHistoryHint {
            undo: Some(SheetLifecycleRuntimeHint::reconcile()),
            redo: Some(hint),
        },
    );
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn get_sheet_visibility(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<String, ComputeError> {
    Ok(visibility::get_sheet_visibility(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    ))
}
