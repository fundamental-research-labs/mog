//! Extracted delegation service functions (scenarios, bindings, sheet management,
//! compute-core reach-throughs).
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! instead of `&self`.  The original bridge methods in `delegations.rs` delegate
//! to these with one-line calls.

#![allow(dead_code)]

use crate::mirror::CellMirror;
use crate::snapshot::{
    ChangeKind, MutationResult, NamedRangeChange, PageBreakChange, PrintAreaChange,
    PrintSettingsChange, PrintTitlesChange, Scenario, ScenarioActiveState, ScenarioCreateInput,
    ScenarioUpdateInput, ScrollPositionChange, SheetChange, SheetChangeField,
    SheetLifecycleRuntimeHint, SheetSettingsChange, SplitConfigChange,
};
use crate::storage::sheet::bindings;
use crate::storage::sheet::{
    order, print, properties, protection, settings, split_view, view, visibility,
};
use crate::storage::workbook::named_ranges;
use crate::what_if::scenarios;
use cell_types::SheetId;
use compute_collab as sync;
use compute_document::hex::id_to_hex;
use domain_types::domain::print::PageBreaks;
use domain_types::domain::sheet::{PrintRange, PrintTitles, SheetSettings, SplitViewConfig};
use formula_types::{IdentityFormula, NamedRangeDef};
use value_types::ComputeError;

use crate::storage::engine::stores::EngineStores;

// -------------------------------------------------------------------
// Scenarios
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_scenario(
    stores: &EngineStores,
    input: ScenarioCreateInput,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::create(&stores.storage, input, &stores.id_alloc);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn update_scenario(
    stores: &EngineStores,
    scenario_id: &str,
    input: ScenarioUpdateInput,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::update(&stores.storage, scenario_id, input);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn remove_scenario(
    stores: &EngineStores,
    scenario_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result = scenarios::remove(&stores.storage, scenario_id);
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn get_all_scenarios(stores: &EngineStores) -> Vec<Scenario> {
    scenarios::get_all(&stores.storage)
}

pub(in crate::storage::engine) fn get_active_scenario_state(
    stores: &EngineStores,
    session: &scenarios::ScenarioSessionState,
) -> Option<ScenarioActiveState> {
    scenarios::active_state(&stores.storage, session)
}

pub(in crate::storage::engine) fn set_active_scenario(
    stores: &EngineStores,
    scenario_id: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    scenarios::set_active_scenario_id(&stores.storage, scenario_id)?;
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Bindings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn create_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding: bindings::CreateBindingInput,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    let options = bindings::CreateBindingOptions {
        auto_generate_rows: binding.auto_generate_rows,
        header_row: binding.header_row,
        data_start_row: binding.data_start_row,
        preserve_header_formatting: binding.preserve_header_formatting,
    };
    let result = bindings::create_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        &binding.connection_id,
        binding.column_mappings,
        options,
        &stores.id_alloc,
    )?;
    Ok(MutationResult::empty().with_data(&result)?)
}

pub(in crate::storage::engine) fn update_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
    updates: bindings::UpdateBindingFields,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
        updates,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::remove_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_bindings(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_all_bindings(stores.storage.doc(), stores.storage.sheets(), &sheet_id)
}

pub(in crate::storage::engine) fn get_binding(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
) -> Option<bindings::SheetDataBinding> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::get_binding(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
    )
}

pub(in crate::storage::engine) fn get_bindings_for_connection(
    stores: &EngineStores,
    connection_id: &str,
) -> Vec<bindings::SheetDataBinding> {
    bindings::get_bindings_for_connection(
        stores.storage.doc(),
        stores.storage.sheets(),
        connection_id,
    )
}

pub(in crate::storage::engine) fn update_refresh_metadata(
    stores: &EngineStores,
    sheet_id: &SheetId,
    binding_id: &str,
    last_refresh: i64,
    last_row_count: u32,
) -> Result<MutationResult, ComputeError> {
    let sheet_id = id_to_hex(sheet_id.as_u128());
    bindings::update_refresh_metadata(
        stores.storage.doc(),
        stores.storage.sheets(),
        &sheet_id,
        binding_id,
        last_refresh,
        last_row_count,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn remove_bindings_for_connection(
    stores: &EngineStores,
    connection_id: &str,
) -> Result<MutationResult, ComputeError> {
    let count = bindings::remove_bindings_for_connection(
        stores.storage.doc(),
        stores.storage.sheets(),
        connection_id,
    );
    Ok(MutationResult::empty().with_data(&count)?)
}

// -------------------------------------------------------------------
// ComputeCore delegations
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn eval_cf(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    rules: Vec<crate::cf::types::CFRuleWire>,
) -> Vec<crate::cf::types::CellCFResult> {
    let rules: Vec<crate::cf::types::CFRule> = rules
        .into_iter()
        .filter_map(|w| crate::cf::types::CFRule::try_from(w).ok())
        .collect();
    stores.compute.eval_cf(mirror, sheet_id, &rules)
}

pub(in crate::storage::engine) fn to_identity_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    formula_a1: &str,
) -> Result<IdentityFormula, ComputeError> {
    stores
        .compute
        .to_identity_formula(mirror, sheet_id, formula_a1)
}

pub(in crate::storage::engine) fn to_a1_display(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    formula: &IdentityFormula,
) -> String {
    stores.compute.to_a1_display(mirror, sheet_id, formula)
}

pub(in crate::storage::engine) fn set_named_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: String,
    def: NamedRangeDef,
) -> Result<MutationResult, ComputeError> {
    stores.compute.set_named_range(mirror, name.clone(), def);
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_named_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: &str,
) -> Result<MutationResult, ComputeError> {
    stores.compute.remove_named_range(mirror, name);
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: name.to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

// -------------------------------------------------------------------
// What-If Analysis
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn solve(
    stores: &EngineStores,
    mirror: &CellMirror,
    params: &crate::solver::SolverParams,
) -> crate::solver::SolverResult {
    stores
        .compute
        .solve(mirror, params)
        .unwrap_or_else(|_e| crate::solver::SolverResult {
            converged: false,
            solution: vec![],
            objective_value: f64::NAN,
            evaluations: 0,
            iterations: 0,
            elapsed_ms: 0,
            termination: crate::solver::TerminationReason::NumericalError,
            message: "Compute error".to_string(),
            dual_values: None,
        })
}

pub(in crate::storage::engine) fn goal_seek(
    stores: &EngineStores,
    mirror: &CellMirror,
    params: &crate::solver::GoalSeekParams,
) -> crate::solver::GoalSeekResult {
    stores
        .compute
        .goal_seek(mirror, params)
        .unwrap_or_else(|_e| crate::solver::GoalSeekResult {
            found: false,
            solution_value: None,
            achieved_value: None,
            iterations: 0,
            error: Some(crate::solver::GoalSeekError::NonNumeric),
            error_message: Some("Compute error".to_string()),
        })
}

pub(in crate::storage::engine) fn data_table(
    stores: &EngineStores,
    mirror: &CellMirror,
    params: &crate::data_table::DataTableParams,
) -> crate::data_table::DataTableResult {
    stores
        .compute
        .data_table(mirror, params)
        .unwrap_or_else(|_e| crate::data_table::DataTableResult {
            results: vec![],
            cell_count: 0,
            cancelled: false,
        })
}

pub(in crate::storage::engine) fn sync_full_state(stores: &EngineStores) -> Vec<u8> {
    sync::encode_full_state(stores.storage.doc())
}

// -------------------------------------------------------------------
// Sheet settings
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_sheet_settings(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> SheetSettings {
    settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_sheet_setting(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    key: &str,
    value: &str,
) -> Result<MutationResult, ComputeError> {
    settings::set_sheet_setting(
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

// -------------------------------------------------------------------
// Sheet protection
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn protect_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    protection::protect_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        password_hash,
    );
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: "isProtected".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn unprotect_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    password_hash: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    let success = protection::unprotect_sheet(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        password_hash,
    );
    if !success {
        return Err(ComputeError::InvalidInput {
            message: "Incorrect password".to_string(),
        });
    }
    let settings =
        settings::get_sheet_settings(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: "isProtected".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok(result)
}

// -------------------------------------------------------------------
// Page breaks
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_page_breaks(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> PageBreaks {
    print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn add_horizontal_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> Result<MutationResult, ComputeError> {
    print::add_horizontal_page_break(stores.storage.doc(), stores.storage.sheets(), sheet_id, row);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_horizontal_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
) -> Result<MutationResult, ComputeError> {
    print::remove_horizontal_page_break(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
    );
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn add_vertical_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    print::add_vertical_page_break(stores.storage.doc(), stores.storage.sheets(), sheet_id, col);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_vertical_page_break(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    print::remove_vertical_page_break(stores.storage.doc(), stores.storage.sheets(), sheet_id, col);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn clear_all_page_breaks(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    print::clear_all_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let breaks = print::get_page_breaks(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok(result)
}

// -------------------------------------------------------------------
// Print area & titles
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_print_area(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Option<PrintRange> {
    print::get_print_area(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_print_area(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    area: Option<&PrintRange>,
) -> Result<MutationResult, ComputeError> {
    print::set_print_area(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        area,
    );
    let mut result = MutationResult::empty();
    let kind = if area.is_some() {
        ChangeKind::Set
    } else {
        ChangeKind::Removed
    };
    result.print_area_changes.push(PrintAreaChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind,
        area: area.cloned(),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn get_print_titles(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> PrintTitles {
    print::get_print_titles(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_print_titles(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    titles: &PrintTitles,
) -> Result<MutationResult, ComputeError> {
    print::set_print_titles(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        titles,
    );
    let mut result = MutationResult::empty();
    result.print_titles_changes.push(PrintTitlesChange {
        sheet_id: sheet_id.to_uuid_string(),
        titles: titles.clone(),
    });
    Ok(result)
}

pub(in crate::storage::engine) fn set_print_settings(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    settings: &domain_types::domain::print::PrintSettings,
) -> Result<MutationResult, ComputeError> {
    print::set_print_settings(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        settings,
    );
    let mut result = MutationResult::empty();
    result.print_settings_changes.push(PrintSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        settings: settings.clone(),
    });
    Ok(result)
}

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

// -------------------------------------------------------------------
// Named range write helpers
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn remove_named_range_by_id(
    stores: &mut EngineStores,
    id: &str,
) -> Result<MutationResult, ComputeError> {
    named_ranges::remove_named_range_by_id(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        id,
    )?;
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: id.to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

pub(in crate::storage::engine) fn remove_named_ranges_by_scope(
    stores: &mut EngineStores,
    scope: Option<&str>,
) -> Result<MutationResult, ComputeError> {
    named_ranges::remove_named_ranges_by_scope(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        scope,
    );
    let mut result = MutationResult::empty();
    result.named_range_changes.push(NamedRangeChange {
        name: scope.unwrap_or_default().to_string(),
        kind: ChangeKind::Removed,
    });
    Ok(result)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// One regression test per services-layer mirror-backed local-write that
// previously returned an empty `MutationResult` and was populated by
// direct-state returners (10 functions in this file). Each test asserts the exact
// `*_changes` family + payload now ride the channel so the kernel TS
// mirror can apply the result without a second IPC round-trip.
#[cfg(test)]
mod mirror_coverage_tests {
    use super::*;
    use crate::snapshot::ChangeKind as SnapChangeKind;
    use crate::storage::engine::YrsComputeEngine;
    use domain_types::domain::print::PrintSettings as DomainPrintSettings;
    use domain_types::domain::sheet::{PrintRange, PrintTitles, SplitDirection, SplitViewConfig};
    use snapshot_types::{SheetSnapshot, WorkbookSnapshot};

    const SHEET_UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn build_engine() -> YrsComputeEngine {
        let snap = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: SHEET_UUID.to_string(),
                name: "Sheet1".to_string(),
                rows: 50,
                cols: 26,
                cells: vec![],
                ranges: vec![],
            }],
            ..Default::default()
        };
        let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("from_snapshot");
        engine
    }

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str(SHEET_UUID).unwrap()
    }

    // -- Page breaks (5 functions) --------------------------------------

    #[test]
    fn add_horizontal_page_break_returns_page_break_changes() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let result = engine
            .with_internals_for_test(|stores, _, _| add_horizontal_page_break(stores, &sid, 5));
        let result = result.expect("add_horizontal_page_break");
        assert_eq!(result.page_break_changes.len(), 1);
        assert_eq!(result.page_break_changes[0].sheet_id, sid.to_uuid_string());
        assert!(
            result.page_break_changes[0]
                .breaks
                .row_breaks
                .iter()
                .any(|b| b.id == 5),
            "row_breaks must reflect the post-mutation snapshot"
        );
    }

    #[test]
    fn add_vertical_page_break_returns_page_break_changes() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let result =
            engine.with_internals_for_test(|stores, _, _| add_vertical_page_break(stores, &sid, 7));
        let result = result.expect("add_vertical_page_break");
        assert_eq!(result.page_break_changes.len(), 1);
        assert!(
            result.page_break_changes[0]
                .breaks
                .col_breaks
                .iter()
                .any(|b| b.id == 7)
        );
    }

    #[test]
    fn remove_horizontal_page_break_returns_page_break_changes() {
        let mut engine = build_engine();
        let sid = sheet_id();
        // Seed a break first so the removal path observes a transition.
        engine
            .with_internals_for_test(|stores, _, _| add_horizontal_page_break(stores, &sid, 3))
            .expect("seed");

        let result = engine
            .with_internals_for_test(|stores, _, _| remove_horizontal_page_break(stores, &sid, 3))
            .expect("remove_horizontal_page_break");
        assert_eq!(result.page_break_changes.len(), 1);
        assert!(
            !result.page_break_changes[0]
                .breaks
                .row_breaks
                .iter()
                .any(|b| b.id == 3),
            "post-removal snapshot must not contain the removed row break"
        );
    }

    #[test]
    fn remove_vertical_page_break_returns_page_break_changes() {
        let mut engine = build_engine();
        let sid = sheet_id();
        engine
            .with_internals_for_test(|stores, _, _| add_vertical_page_break(stores, &sid, 4))
            .expect("seed");

        let result = engine
            .with_internals_for_test(|stores, _, _| remove_vertical_page_break(stores, &sid, 4))
            .expect("remove_vertical_page_break");
        assert_eq!(result.page_break_changes.len(), 1);
        assert!(
            !result.page_break_changes[0]
                .breaks
                .col_breaks
                .iter()
                .any(|b| b.id == 4),
            "post-removal snapshot must not contain the removed col break"
        );
    }

    #[test]
    fn clear_all_page_breaks_returns_page_break_changes() {
        let mut engine = build_engine();
        let sid = sheet_id();
        engine
            .with_internals_for_test(|stores, _, _| add_horizontal_page_break(stores, &sid, 1))
            .expect("seed h");
        engine
            .with_internals_for_test(|stores, _, _| add_vertical_page_break(stores, &sid, 2))
            .expect("seed v");

        let result = engine
            .with_internals_for_test(|stores, _, _| clear_all_page_breaks(stores, &sid))
            .expect("clear_all_page_breaks");
        assert_eq!(result.page_break_changes.len(), 1);
        let breaks = &result.page_break_changes[0].breaks;
        assert!(breaks.row_breaks.is_empty());
        assert!(breaks.col_breaks.is_empty());
    }

    // -- Print area / titles / settings (3 functions) -------------------

    #[test]
    fn set_print_area_returns_print_area_change() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let area = PrintRange {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 5,
        };
        let result = engine
            .with_internals_for_test(|stores, _, _| set_print_area(stores, &sid, Some(&area)))
            .expect("set_print_area");
        assert_eq!(result.print_area_changes.len(), 1);
        let change = &result.print_area_changes[0];
        assert_eq!(change.kind, SnapChangeKind::Set);
        assert_eq!(change.area.as_ref().map(|a| a.end_row), Some(10));

        // Removal path → kind must be Removed.
        let result = engine
            .with_internals_for_test(|stores, _, _| set_print_area(stores, &sid, None))
            .expect("set_print_area(None)");
        assert_eq!(result.print_area_changes.len(), 1);
        assert_eq!(result.print_area_changes[0].kind, SnapChangeKind::Removed);
        assert!(result.print_area_changes[0].area.is_none());
    }

    #[test]
    fn set_print_titles_returns_print_titles_change() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let titles = PrintTitles {
            repeat_rows: Some((0, 1)),
            repeat_cols: None,
        };
        let result = engine
            .with_internals_for_test(|stores, _, _| set_print_titles(stores, &sid, &titles))
            .expect("set_print_titles");
        assert_eq!(result.print_titles_changes.len(), 1);
        assert_eq!(
            result.print_titles_changes[0].titles.repeat_rows,
            Some((0, 1))
        );
    }

    #[test]
    fn set_print_settings_returns_print_settings_change() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let mut settings = DomainPrintSettings::default();
        settings.orientation = Some("landscape".to_string());
        let result = engine
            .with_internals_for_test(|stores, _, _| set_print_settings(stores, &sid, &settings))
            .expect("set_print_settings");
        assert_eq!(result.print_settings_changes.len(), 1);
        assert_eq!(
            result.print_settings_changes[0].settings.orientation,
            Some("landscape".to_string())
        );
    }

    // -- Split config (1 function) --------------------------------------

    #[test]
    fn set_split_config_returns_split_config_change() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let config = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 100,
            vertical_position: 200,
        };
        let result = engine
            .with_internals_for_test(|stores, _, _| set_split_config(stores, &sid, Some(&config)))
            .expect("set_split_config");
        assert_eq!(result.split_config_changes.len(), 1);
        let change = &result.split_config_changes[0];
        assert_eq!(change.kind, SnapChangeKind::Set);
        assert_eq!(
            change.config.as_ref().map(|c| c.horizontal_position),
            Some(100)
        );

        // Removal path → kind == Removed.
        let result = engine
            .with_internals_for_test(|stores, _, _| set_split_config(stores, &sid, None))
            .expect("set_split_config(None)");
        assert_eq!(result.split_config_changes.len(), 1);
        assert_eq!(result.split_config_changes[0].kind, SnapChangeKind::Removed);
    }

    #[test]
    fn set_split_config_reports_frozen_panes_cleared() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let config = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 100,
            vertical_position: 200,
        };
        engine
            .with_internals_for_test(|stores, _, _| set_frozen_panes(stores, &sid, 3, 2))
            .expect("set_frozen_panes");

        let result = engine
            .with_internals_for_test(|stores, _, _| set_split_config(stores, &sid, Some(&config)))
            .expect("set_split_config");

        assert_eq!(result.split_config_changes.len(), 1);
        let frozen_change = result
            .sheet_changes
            .iter()
            .find(|change| change.field == SheetChangeField::Frozen)
            .expect("split should report frozen panes cleared");
        assert_eq!(frozen_change.frozen_rows, Some(0));
        assert_eq!(frozen_change.old_frozen_rows, Some(3));
        assert_eq!(frozen_change.frozen_cols, Some(0));
        assert_eq!(frozen_change.old_frozen_cols, Some(2));
    }

    #[test]
    fn yrs_bridge_set_split_config_returns_split_config_change() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let config = SplitViewConfig {
            direction: SplitDirection::Both,
            horizontal_position: 1,
            vertical_position: 1,
        };

        let (_patches, result) = engine
            .set_split_config(&sid, Some(config))
            .expect("bridge set_split_config");

        assert_eq!(result.split_config_changes.len(), 1);
        let change = &result.split_config_changes[0];
        assert_eq!(change.kind, SnapChangeKind::Set);
        assert_eq!(change.config.as_ref().map(|c| c.vertical_position), Some(1));
    }

    // -- Scroll position (1 function) -----------------------------------

    #[test]
    fn set_scroll_position_returns_scroll_position_change() {
        let mut engine = build_engine();
        let sid = sheet_id();
        let result = engine
            .with_internals_for_test(|stores, _, _| set_scroll_position(stores, &sid, 12, 7))
            .expect("set_scroll_position");
        assert_eq!(result.scroll_position_changes.len(), 1);
        let change = &result.scroll_position_changes[0];
        assert_eq!(change.sheet_id, sid.to_uuid_string());
        assert_eq!(change.top_row, 12);
        assert_eq!(change.left_col, 7);
    }
}
