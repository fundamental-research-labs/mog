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

pub(in crate::storage::engine) fn get_sheet_settings(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> SheetSettings {
    settings::get_sheet_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn set_sheet_setting(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    key: &str,
    value: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    settings::set_sheet_setting(
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

pub(in crate::storage::engine) fn protect_sheet(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    password_hash: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    protection::protect_sheet(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        password_hash.as_deref(),
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
        changed_key: "isProtected".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn protect_sheet_with_options(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    password_hash: Option<String>,
    options: SheetProtectionOptions,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    protection::protect_sheet_with_options(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        password_hash.as_deref(),
        &options,
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
        changed_key: "protectionDetails".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn set_sheet_protection_options(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    options: SheetProtectionOptions,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    protection::set_sheet_protection_options(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        &options,
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
        changed_key: "protectionDetails".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn unprotect_sheet(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    password_hash: Option<String>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let success = protection::unprotect_sheet(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        password_hash.as_deref(),
    );
    if !success {
        return Err(ComputeError::InvalidInput {
            message: "Incorrect password".to_string(),
        });
    }
    let settings = settings::get_sheet_settings(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.settings_changes.push(SheetSettingsChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        changed_key: "isProtected".to_string(),
        settings: serde_json::to_value(&settings).expect("SheetSettings must serialize"),
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn get_page_breaks(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> PageBreaks {
    print::get_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn add_horizontal_page_break(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::add_horizontal_page_break(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        row,
    );
    let breaks = print::get_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn remove_horizontal_page_break(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::remove_horizontal_page_break(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        row,
    );
    let breaks = print::get_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn add_vertical_page_break(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::add_vertical_page_break(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        col,
    );
    let breaks = print::get_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn remove_vertical_page_break(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::remove_vertical_page_break(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        col,
    );
    let breaks = print::get_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn clear_all_page_breaks(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::clear_all_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let breaks = print::get_page_breaks(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    );
    let mut result = MutationResult::empty();
    result.page_break_changes.push(PageBreakChange {
        sheet_id: sheet_id.to_uuid_string(),
        breaks,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn get_print_area(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<PrintRange> {
    print::get_print_area(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn set_print_area(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    area: Option<PrintRange>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::set_print_area(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        area.as_ref(),
    );
    let kind = if area.is_some() {
        ChangeKind::Set
    } else {
        ChangeKind::Removed
    };
    let mut result = MutationResult::empty();
    result.print_area_changes.push(PrintAreaChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind,
        area,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn get_print_titles(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> PrintTitles {
    print::get_print_titles(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn set_print_titles(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    titles: PrintTitles,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    print::set_print_titles(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
        &titles,
    );
    let mut result = MutationResult::empty();
    result.print_titles_changes.push(PrintTitlesChange {
        sheet_id: sheet_id.to_uuid_string(),
        titles,
    });
    Ok((serialize_multi_viewport_patches(&[]), result))
}

pub(in crate::storage::engine) fn get_split_config(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Option<SplitViewConfig> {
    split_view::get_split_config(
        engine.stores.storage.doc(),
        engine.stores.storage.sheets(),
        sheet_id,
    )
}

pub(in crate::storage::engine) fn set_split_config(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    config: Option<SplitViewConfig>,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result =
        services::delegations::set_split_config(&mut engine.stores, sheet_id, config.as_ref())?;
    Ok((serialize_multi_viewport_patches(&[]), result))
}
